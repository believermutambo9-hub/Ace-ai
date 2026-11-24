import {
  IFootballDataProvider,
  MatchResult,
  MatchStatus,
  NormalizedCompetition,
  NormalizedMatch,
  NormalizedMatchStats,
  ProviderHealth,
} from '../contracts/provider.interface.ts';
import { BaseFootballDataProvider } from './baseProvider.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';

export interface LiveWebEvent {
  id: string;
  minute: number;
  type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'VAR_CHECK' | 'PENALTY' | 'DANGEROUS_ATTACK';
  team: 'HOME' | 'AWAY';
  player: string;
  scoreAfter?: string;
  description: string;
}

export interface LiveWebScoreboardItem {
  externalId: string;
  providerSource: string;
  competitionCode: string;
  competitionName: string;
  leagueSlug: string;
  seasonCode: string;
  round: string;
  kickoffTime: string;
  status: MatchStatus;
  homeTeam: string;
  awayTeam: string;
  homeShortName: string;
  awayShortName: string;
  homeScoreFullTime: number | null;
  awayScoreFullTime: number | null;
  result: MatchResult | null;
  venue: string;
  minute: number | null;
  stoppageTime?: number;
  period: '1H' | 'HT' | '2H' | 'ET' | 'FT' | 'LIVE' | 'PRE';
  displayClock: string;
  events: LiveWebEvent[];
  liveStats?: {
    possession?: { home: number; away: number };
    shots?: { home: number; away: number };
    shotsOnTarget?: { home: number; away: number };
    corners?: { home: number; away: number };
    fouls?: { home: number; away: number };
    yellowCards?: { home: number; away: number };
    redCards?: { home: number; away: number };
  };
  moneylineOdds?: {
    home?: number;
    draw?: number;
    away?: number;
    provider?: string;
  };
}

export interface LiveWebScoreboardBundle {
  fetchedAt: string;
  sourceUrl: string;
  latencyMs: number;
  leaguesCovered: number;
  live: LiveWebScoreboardItem[];
  upcoming: LiveWebScoreboardItem[];
  finished: LiveWebScoreboardItem[];
}

const ESPN_SLUG_TO_CANONICAL: Record<string, string> = {
  'eng.1': 'PL',
  'esp.1': 'PD',
  'ita.1': 'SA',
  'ger.1': 'BL1',
  'fra.1': 'FL1',
  'ned.1': 'DED',
  'por.1': 'PPL',
  'uefa.champions': 'CL',
  'uefa.europa': 'EL',
  'usa.1': 'MLS',
  'bra.1': 'BSA',
  'arg.1': 'ARG',
  'afc.champions': 'ACL',
  'caf.champions': 'CAF_CL',
};

const CANONICAL_TO_ESPN_SLUG: Record<string, string> = Object.entries(ESPN_SLUG_TO_CANONICAL).reduce(
  (acc, [slug, code]) => {
    acc[code] = slug;
    return acc;
  },
  {} as Record<string, string>
);

export function americanToDecimalOdds(americanRaw: unknown): number | undefined {
  if (americanRaw === null || americanRaw === undefined) return undefined;
  const parsed = typeof americanRaw === 'number' ? americanRaw : parseFloat(String(americanRaw).replace(/[^0-9+.-]/g, ''));
  if (!Number.isFinite(parsed) || parsed === 0) return undefined;
  if (parsed > 0) {
    return Number((1 + parsed / 100).toFixed(2));
  }
  return Number((1 + 100 / Math.abs(parsed)).toFixed(2));
}

export function parseClockAndPeriod(
  statusObj: any,
  matchStatus: MatchStatus
): {
  minute: number | null;
  stoppageTime?: number;
  period: LiveWebScoreboardItem['period'];
  displayClock: string;
} {
  if (matchStatus === 'SCHEDULED') {
    return { minute: null, period: 'PRE', displayClock: 'Scheduled' };
  }
  if (matchStatus === 'FINISHED') {
    return { minute: 90, period: 'FT', displayClock: 'FT' };
  }

  const displayClock = String(statusObj?.displayClock || statusObj?.type?.shortDetail || '').trim();
  const statusName = String(statusObj?.type?.name || '').toUpperCase();
  const numericPeriod = typeof statusObj?.period === 'number' ? statusObj.period : 0;

  // Check stoppage time syntax e.g. "45'+2'" or "90+4'"
  let minute: number | null = null;
  let stoppageTime: number | undefined;

  const stopMatch = /(\d+)\s*'\s*\+\s*(\d+)/.exec(displayClock) || /(\d+)\+(\d+)/.exec(displayClock);
  if (stopMatch) {
    minute = parseInt(stopMatch[1], 10);
    stoppageTime = parseInt(stopMatch[2], 10);
  } else {
    const minMatch = /(\d+)/.exec(displayClock);
    if (minMatch) {
      minute = parseInt(minMatch[1], 10);
    } else if (typeof statusObj?.clock === 'number' && statusObj.clock > 0) {
      minute = Math.floor(statusObj.clock / 60);
    }
  }

  let period: LiveWebScoreboardItem['period'] = 'LIVE';
  if (statusName.includes('HALFTIME') || displayClock.toUpperCase() === 'HT') {
    period = 'HT';
    if (minute === null) minute = 45;
  } else if (statusName.includes('FULL_TIME') || displayClock.toUpperCase() === 'FT') {
    period = 'FT';
  } else if (statusName.includes('EXTRA_TIME') || (minute !== null && minute > 90) || numericPeriod > 2) {
    period = 'ET';
  } else if (statusName.includes('SECOND_HALF') || numericPeriod === 2 || (minute !== null && minute > 45)) {
    period = '2H';
  } else if (statusName.includes('FIRST_HALF') || numericPeriod === 1 || minute !== null) {
    period = '1H';
  }

  return {
    minute,
    ...(stoppageTime !== undefined ? { stoppageTime } : {}),
    period,
    displayClock: displayClock || period,
  };
}

/**
 * Live Web Feed Provider (Key-Free Public Web Football Scoreboard)
 * Streams live scores, match clocks, team stats, and goal/card events from public ESPN Scorepanel feeds
 * so the Prediction & Live Match Engines remain operational even if paid API keys are paused or offline.
 */
export class LiveWebFeedProvider extends BaseFootballDataProvider implements IFootballDataProvider {
  readonly name = 'live-web-feed';
  private readonly scorepanelUrl = 'https://site.api.espn.com/apis/site/v2/sports/soccer/scorepanel';
  private readonly leagueBaseUrl = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

  private static sharedBundleCache: { data: LiveWebScoreboardBundle; expiry: number } | null = null;
  private static readonly LIVE_CACHE_TTL_MS = 15 * 1000;

  constructor() {
    super(60 * 1000);
  }

  async checkHealth(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const bundle = await this.fetchWebScoreboardBundle();
      const totalEvents = bundle.live.length + bundle.upcoming.length + bundle.finished.length;
      return {
        providerName: this.name,
        isOnline: bundle.leaguesCovered > 0 || totalEvents > 0,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: `Live Web Feed active (${bundle.leaguesCovered} global leagues, ${bundle.live.length} live, ${bundle.upcoming.length} upcoming)`,
      };
    } catch (err: any) {
      return {
        providerName: this.name,
        isOnline: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: `Live Web Feed unreachable: ${err?.message || 'Connection error'}`,
      };
    }
  }

  async fetchCompetitions(): Promise<NormalizedCompetition[]> {
    return CANONICAL_COMPETITIONS;
  }

  /**
   * Fetch all live, today's upcoming, and recent finished global fixtures from the live web scorepanel.
   */
  public async fetchWebScoreboardBundle(forceRefresh = false): Promise<LiveWebScoreboardBundle> {
    const now = Date.now();
    if (!forceRefresh && LiveWebFeedProvider.sharedBundleCache && now < LiveWebFeedProvider.sharedBundleCache.expiry) {
      return LiveWebFeedProvider.sharedBundleCache.data;
    }

    const started = Date.now();
    const res = await this.fetchWithRetry(
      this.scorepanelUrl,
      {
        headers: {
          'User-Agent': 'PitchIntel-LiveEngine/1.0',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
      },
      2
    );

    if (!res.ok) {
      throw new Error(`Live Web Scorepanel returned HTTP ${res.status}`);
    }

    const json = await res.json();
    const scores: any[] = Array.isArray(json?.scores) ? json.scores : [];

    const live: LiveWebScoreboardItem[] = [];
    const upcoming: LiveWebScoreboardItem[] = [];
    const finished: LiveWebScoreboardItem[] = [];
    const seenIds = new Set<string>();

    for (const block of scores) {
      const leagueMeta = Array.isArray(block?.leagues) ? block.leagues[0] : undefined;
      const leagueSlug = String(leagueMeta?.slug || 'global.soccer');
      const leagueName = String(leagueMeta?.name || leagueMeta?.abbreviation || 'Global Football');
      const compCode =
        ESPN_SLUG_TO_CANONICAL[leagueSlug] ||
        leagueSlug.replace(/\./g, '_').toUpperCase().slice(0, 12);

      const events: any[] = Array.isArray(block?.events) ? block.events : [];
      for (const ev of events) {
        const normalized = this.normalizeEspnEvent(ev, compCode, leagueName, leagueSlug);
        if (!normalized || seenIds.has(normalized.externalId)) continue;
        seenIds.add(normalized.externalId);

        if (normalized.status === 'LIVE') {
          live.push(normalized);
        } else if (normalized.status === 'FINISHED') {
          finished.push(normalized);
        } else {
          upcoming.push(normalized);
        }
      }
    }

    upcoming.sort((a, b) => new Date(a.kickoffTime).getTime() - new Date(b.kickoffTime).getTime());
    finished.sort((a, b) => new Date(b.kickoffTime).getTime() - new Date(a.kickoffTime).getTime());

    const bundle: LiveWebScoreboardBundle = {
      fetchedAt: new Date().toISOString(),
      sourceUrl: this.scorepanelUrl,
      latencyMs: Date.now() - started,
      leaguesCovered: scores.length,
      live,
      upcoming,
      finished,
    };

    LiveWebFeedProvider.sharedBundleCache = {
      data: bundle,
      expiry: Date.now() + LiveWebFeedProvider.LIVE_CACHE_TTL_MS,
    };

    return bundle;
  }

  public async fetchLiveMatches(): Promise<LiveWebScoreboardItem[]> {
    try {
      const bundle = await this.fetchWebScoreboardBundle();
      return bundle.live;
    } catch (err: any) {
      console.warn(`[${this.name}] Live scoreboard fetch warning:`, err?.message || err);
      return [];
    }
  }

  async fetchMatches(competitionCode: string, seasonCode?: string): Promise<NormalizedMatch[]> {
    const cacheKey = `web_matches_${competitionCode}_${seasonCode || 'current'}`;
    const cached = this.getCached<NormalizedMatch[]>(cacheKey);
    if (cached) return cached;

    try {
      const upperCode = competitionCode.toUpperCase();
      const slug = CANONICAL_TO_ESPN_SLUG[upperCode];
      let items: LiveWebScoreboardItem[] = [];

      if (slug) {
        const url = `${this.leagueBaseUrl}/${encodeURIComponent(slug)}/scoreboard`;
        const res = await this.fetchWithRetry(
          url,
          {
            headers: {
              'User-Agent': 'PitchIntel-LiveEngine/1.0',
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(8000),
          },
          2
        );
        if (res.ok) {
          const json = await res.json();
          const leagueMeta = Array.isArray(json?.leagues) ? json.leagues[0] : undefined;
          const leagueName = String(leagueMeta?.name || competitionCode);
          const events: any[] = Array.isArray(json?.events) ? json.events : [];
          items = events
            .map((ev) => this.normalizeEspnEvent(ev, upperCode, leagueName, slug))
            .filter((x): x is LiveWebScoreboardItem => x !== null);
        }
      } else {
        const bundle = await this.fetchWebScoreboardBundle();
        items = [...bundle.live, ...bundle.upcoming, ...bundle.finished].filter(
          (i) => i.competitionCode.toUpperCase() === upperCode
        );
      }

      const normalized: NormalizedMatch[] = items.map((item) => this.toNormalizedMatch(item));
      if (normalized.length > 0) {
        this.setCached(cacheKey, normalized, 3 * 60 * 1000);
      }
      return normalized;
    } catch (err: any) {
      console.warn(`[${this.name}] Competition fetch warning for ${competitionCode}:`, err?.message || err);
      return [];
    }
  }

  async fetchMatchStats(_matchExternalId: string): Promise<NormalizedMatchStats | null> {
    return null;
  }

  public toNormalizedMatch(item: LiveWebScoreboardItem): NormalizedMatch {
    return {
      externalId: item.externalId,
      providerSource: this.name,
      competitionCode: item.competitionCode,
      seasonCode: item.seasonCode,
      round: item.round,
      kickoffTime: new Date(item.kickoffTime),
      homeTeamRawName: item.homeTeam,
      awayTeamRawName: item.awayTeam,
      venue: item.venue,
      status: item.status,
      homeScoreFullTime: item.homeScoreFullTime,
      awayScoreFullTime: item.awayScoreFullTime,
      result: item.result,
      dataCompleteness: item.liveStats ? 'DETAILED_STATS' : 'SCORES',
      metadata: {
        leagueName: item.competitionName,
        leagueSlug: item.leagueSlug,
        minute: item.minute,
        stoppageTime: item.stoppageTime,
        period: item.period,
        displayClock: item.displayClock,
        events: item.events,
        liveStats: item.liveStats,
        moneylineOdds: item.moneylineOdds,
      },
    };
  }

  public normalizeEspnEvent(
    ev: any,
    competitionCode: string,
    competitionName: string,
    leagueSlug: string
  ): LiveWebScoreboardItem | null {
    const comp = Array.isArray(ev?.competitions) ? ev.competitions[0] : undefined;
    const competitors: any[] = Array.isArray(comp?.competitors) ? comp.competitors : [];
    const homeComp = competitors.find((c) => c.homeAway === 'home') || competitors[0];
    const awayComp = competitors.find((c) => c.homeAway === 'away') || competitors[1];

    const homeTeamName = homeComp?.team?.displayName || homeComp?.team?.name;
    const awayTeamName = awayComp?.team?.displayName || awayComp?.team?.name;
    if (!homeTeamName || !awayTeamName) return null;

    const state = String(ev?.status?.type?.state || comp?.status?.type?.state || 'pre').toLowerCase();
    const statusName = String(ev?.status?.type?.name || '').toUpperCase();
    let status: MatchStatus = 'SCHEDULED';
    if (state === 'in') status = 'LIVE';
    else if (state === 'post') status = 'FINISHED';
    else if (statusName.includes('POSTPONED')) status = 'POSTPONED';
    else if (statusName.includes('CANCELED') || statusName.includes('CANCELLED')) status = 'CANCELLED';

    const parseScore = (val: unknown): number | null => {
      if (status === 'SCHEDULED' && (val === undefined || val === null || val === '')) return null;
      const n = typeof val === 'number' ? val : parseInt(String(val), 10);
      if (!Number.isFinite(n)) return null;
      if (status === 'SCHEDULED') return null;
      return n;
    };

    const homeScore = parseScore(homeComp?.score);
    const awayScore = parseScore(awayComp?.score);

    let result: MatchResult | null = null;
    if (status === 'FINISHED' && homeScore !== null && awayScore !== null) {
      if (homeScore > awayScore) result = 'HOME_WIN';
      else if (homeScore < awayScore) result = 'AWAY_WIN';
      else result = 'DRAW';
    }

    const clockInfo = parseClockAndPeriod(ev?.status || comp?.status, status);

    const homeTeamId = String(homeComp?.team?.id || '');
    const awayTeamId = String(awayComp?.team?.id || '');

    // Parse genuine live match events (goals, cards, penalties)
    const rawDetails: any[] = Array.isArray(comp?.details) ? comp.details : [];
    const events: LiveWebEvent[] = rawDetails.slice(-12).map((d, idx) => {
      const eventTeamId = String(d?.team?.id || '');
      const side: 'HOME' | 'AWAY' = eventTeamId === awayTeamId ? 'AWAY' : 'HOME';
      const player = d?.athletesInvolved?.[0]?.displayName || d?.athletesInvolved?.[0]?.shortName || 'Squad Player';
      const clockText = String(d?.clock?.displayValue || '');
      const minMatch = /(\d+)/.exec(clockText);
      const minuteNum = minMatch ? parseInt(minMatch[1], 10) : clockInfo.minute ?? 0;

      let type: LiveWebEvent['type'] = 'DANGEROUS_ATTACK';
      if (d?.redCard) type = 'RED_CARD';
      else if (d?.yellowCard) type = 'YELLOW_CARD';
      else if (d?.penaltyKick) type = 'PENALTY';
      else if (d?.scoringPlay || String(d?.type?.text || '').toLowerCase().includes('goal')) type = 'GOAL';

      const eventLabel = String(d?.type?.text || type);
      return {
        id: `espn_ev_${ev.id}_${idx}`,
        minute: minuteNum,
        type,
        team: side,
        player,
        description: `${clockText ? `${clockText} ` : ''}${eventLabel} - ${player}`,
      };
    });

    // Parse genuine live statistics if present on competitors
    const parseStatMap = (statsArr: any[]): Record<string, number> => {
      const map: Record<string, number> = {};
      if (!Array.isArray(statsArr)) return map;
      for (const s of statsArr) {
        const val = parseFloat(String(s?.displayValue ?? ''));
        if (s?.name && Number.isFinite(val)) {
          map[String(s.name)] = val;
        }
      }
      return map;
    };

    const hStats = parseStatMap(homeComp?.statistics);
    const aStats = parseStatMap(awayComp?.statistics);
    const hasAnyStats = Object.keys(hStats).length > 0 && Object.keys(aStats).length > 0;

    let liveStats: LiveWebScoreboardItem['liveStats'];
    if (hasAnyStats) {
      liveStats = {};
      if (hStats.possessionPct !== undefined && aStats.possessionPct !== undefined) {
        liveStats.possession = { home: hStats.possessionPct, away: aStats.possessionPct };
      }
      if (hStats.totalShots !== undefined && aStats.totalShots !== undefined) {
        liveStats.shots = { home: hStats.totalShots, away: aStats.totalShots };
      }
      if (hStats.shotsOnTarget !== undefined && aStats.shotsOnTarget !== undefined) {
        liveStats.shotsOnTarget = { home: hStats.shotsOnTarget, away: aStats.shotsOnTarget };
      }
      if (hStats.wonCorners !== undefined && aStats.wonCorners !== undefined) {
        liveStats.corners = { home: hStats.wonCorners, away: aStats.wonCorners };
      }
      if (hStats.foulsCommitted !== undefined && aStats.foulsCommitted !== undefined) {
        liveStats.fouls = { home: hStats.foulsCommitted, away: aStats.foulsCommitted };
      }
      if (events.length > 0) {
        liveStats.yellowCards = {
          home: events.filter((e) => e.team === 'HOME' && e.type === 'YELLOW_CARD').length,
          away: events.filter((e) => e.team === 'AWAY' && e.type === 'YELLOW_CARD').length,
        };
        liveStats.redCards = {
          home: events.filter((e) => e.team === 'HOME' && e.type === 'RED_CARD').length,
          away: events.filter((e) => e.team === 'AWAY' && e.type === 'RED_CARD').length,
        };
      }
    }

    // Parse genuine moneyline odds if provided
    let moneylineOdds: LiveWebScoreboardItem['moneylineOdds'];
    const rawOdds = Array.isArray(comp?.odds) ? comp.odds[0] : undefined;
    if (rawOdds?.moneyline) {
      const homeDec = americanToDecimalOdds(rawOdds.moneyline.home?.current?.odds ?? rawOdds.moneyline.home?.close?.odds);
      const drawDec = americanToDecimalOdds(rawOdds.moneyline.draw?.current?.odds ?? rawOdds.moneyline.draw?.close?.odds);
      const awayDec = americanToDecimalOdds(rawOdds.moneyline.away?.current?.odds ?? rawOdds.moneyline.away?.close?.odds);
      if (homeDec && drawDec && awayDec) {
        moneylineOdds = {
          home: homeDec,
          draw: drawDec,
          away: awayDec,
          provider: rawOdds?.provider?.name || 'DraftKings/ESPN',
        };
      }
    }

    const kickoffIso = ev?.date ? new Date(ev.date).toISOString() : new Date().toISOString();
    const kickoffYear = new Date(kickoffIso).getUTCFullYear();
    const kickoffMonth = new Date(kickoffIso).getUTCMonth();
    const seasonStart = kickoffMonth >= 6 ? kickoffYear : kickoffYear - 1;

    return {
      externalId: `espn_${ev.id}`,
      providerSource: this.name,
      competitionCode,
      competitionName,
      leagueSlug,
      seasonCode: `${seasonStart}-${seasonStart + 1}`,
      round: String(ev?.season?.slug || 'Regular Season').replace(/-/g, ' '),
      kickoffTime: kickoffIso,
      status,
      homeTeam: homeTeamName,
      awayTeam: awayTeamName,
      homeShortName: String(homeComp?.team?.abbreviation || homeTeamName.slice(0, 3)).toUpperCase(),
      awayShortName: String(awayComp?.team?.abbreviation || awayTeamName.slice(0, 3)).toUpperCase(),
      homeScoreFullTime: homeScore,
      awayScoreFullTime: awayScore,
      result,
      venue: String(comp?.venue?.fullName || ev?.venue?.fullName || 'Stadium'),
      minute: clockInfo.minute,
      ...(clockInfo.stoppageTime !== undefined ? { stoppageTime: clockInfo.stoppageTime } : {}),
      period: clockInfo.period,
      displayClock: clockInfo.displayClock,
      events,
      ...(liveStats && Object.keys(liveStats).length > 0 ? { liveStats } : {}),
      ...(moneylineOdds ? { moneylineOdds } : {}),
    };
  }
}
