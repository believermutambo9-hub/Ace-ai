import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { competitions, matches, teams } from '../../db/schema.ts';
import { ApiFootballProvider } from '../providers/apiFootballProvider.ts';
import { FootballDataProvider } from '../providers/footballDataProvider.ts';
import { LiveWebFeedProvider, LiveWebScoreboardBundle, LiveWebScoreboardItem } from '../providers/liveWebFeedProvider.ts';
import { NewsEngine, FootballNewsArticle } from '../news/newsEngine.ts';

export interface LiveEventItem {
  id: string;
  minute: number;
  type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'VAR_CHECK' | 'PENALTY' | 'DANGEROUS_ATTACK';
  team: 'HOME' | 'AWAY';
  player: string;
  scoreAfter?: string;
  description: string;
}

export interface LiveMatchMetadata {
  minute: number | null;
  period: '1H' | 'HT' | '2H' | 'ET' | 'FT' | 'LIVE';
  stoppageTime?: number;
  displayClock?: string;
  lastUpdated: string;
  providerSource?: string;
  events: LiveEventItem[];
  lastEvent?: LiveEventItem;
  liveStats?: {
    possession?: { home: number; away: number };
    shots?: { home: number; away: number };
    shotsOnTarget?: { home: number; away: number };
    corners?: { home: number; away: number };
    fouls?: { home: number; away: number };
    yellowCards?: { home: number; away: number };
    redCards?: { home: number; away: number };
    liveXg?: { home: number; away: number };
    pitchTilt?: { home: number; away: number };
  };
  moneylineOdds?: {
    home?: number;
    draw?: number;
    away?: number;
    provider?: string;
  };
  inPlayProbabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
}

export interface LiveWebFeedSnapshot {
  status: 'OPERATIONAL' | 'DEGRADED';
  lastUpdated: string;
  latencyMs: number;
  leaguesCovered: number;
  liveMatches: any[];
  upcomingToday: LiveWebScoreboardItem[];
  recentResults: LiveWebScoreboardItem[];
  dispatches: FootballNewsArticle[];
  feedSources: Array<{
    id: string;
    name: string;
    status: 'OPERATIONAL' | 'STANDBY' | 'OFFLINE';
    detail: string;
  }>;
}

/**
 * Live Football Engine
 * Responsible for tracking, querying, and updating verified in-play fixtures across
 * Football-Data.org, API-Football (when healthy), the key-free Live Web Feed (ESPN Scorepanel),
 * and PostgreSQL persisted in-play fixtures.
 * CRITICAL RULE: Never invents scores, fake goal scorers, fake xG, or arbitrary minute stamps.
 */
export class LiveMatchEngine {
  private static cachedLiveMatches: any[] = [];
  private static lastCacheTime: number = 0;
  private static readonly CACHE_TTL_MS = 15000;

  private static normalizePairKey(home: string, away: string): string {
    const clean = (s: string) =>
      s
        .toLowerCase()
        .replace(/\b(fc|cf|sc|ac|afc|united|city)\b/g, '')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 10);
    return `${clean(home)}__${clean(away)}`;
  }

  private static estimateElapsedForProbability(kickoffTime: Date, reportedMinute: number | null): number {
    if (reportedMinute !== null && reportedMinute >= 0 && reportedMinute <= 130) {
      return reportedMinute;
    }
    const elapsedMins = Math.round((Date.now() - kickoffTime.getTime()) / 60000);
    if (elapsedMins <= 0) return 1;
    if (elapsedMins <= 45) return elapsedMins;
    if (elapsedMins <= 60) return 45;
    return Math.min(90, elapsedMins - 15);
  }

  private static mapWebScoreboardItemToLiveMatch(item: LiveWebScoreboardItem, idx: number): any {
    const homeScore = item.homeScoreFullTime ?? 0;
    const awayScore = item.awayScoreFullTime ?? 0;
    const kickoffDate = new Date(item.kickoffTime);
    const mathMinute = this.estimateElapsedForProbability(kickoffDate, item.minute);
    const inPlay = this.calculateInPlayProbabilities(homeScore, awayScore, mathMinute);
    const period: LiveMatchMetadata['period'] =
      item.period === 'PRE' ? 'LIVE' : item.period;

    return {
      id: 970000 + idx,
      isDatabaseMatch: false,
      externalId: item.externalId,
      competitionId: 0,
      competitionName: item.competitionName,
      competitionCode: item.competitionCode,
      round: item.round || 'In Play',
      kickoffTime: item.kickoffTime,
      status: 'LIVE',
      homeTeam: item.homeTeam,
      awayTeam: item.awayTeam,
      homeShortName: item.homeShortName,
      awayShortName: item.awayShortName,
      homeScoreFullTime: homeScore,
      awayScoreFullTime: awayScore,
      result: item.result,
      venue: item.venue || 'Stadium',
      metadata: {
        minute: item.minute,
        ...(item.stoppageTime !== undefined ? { stoppageTime: item.stoppageTime } : {}),
        period,
        displayClock: item.displayClock,
        lastUpdated: new Date().toISOString(),
        providerSource: item.providerSource,
        events: item.events,
        lastEvent: item.events[item.events.length - 1],
        ...(item.liveStats ? { liveStats: item.liveStats } : {}),
        ...(item.moneylineOdds ? { moneylineOdds: item.moneylineOdds } : {}),
        inPlayProbabilities: inPlay,
      },
    };
  }

  /**
   * Retrieve all currently verified LIVE matches.
   * Cascades cleanly across healthy API-Football, Football-Data.org, key-free Live Web Feed,
   * and PostgreSQL in-play fixtures without stalling on broken/suspended keys.
   */
  public static async getLiveMatches(forceRefresh = false): Promise<any[]> {
    const now = Date.now();
    if (!forceRefresh && this.cachedLiveMatches.length > 0 && now - this.lastCacheTime < this.CACHE_TTL_MS) {
      return this.cachedLiveMatches;
    }

    try {
      const liveList: any[] = [];
      const seenExternalIds = new Set<string>();
      const pairIndexMap = new Map<string, number>();

      const pushOrMergeLive = (candidate: any) => {
        if (seenExternalIds.has(candidate.externalId)) return;
        const pairKey = this.normalizePairKey(candidate.homeTeam || '', candidate.awayTeam || '');
        const existingIdx = pairIndexMap.get(pairKey);

        if (existingIdx !== undefined) {
          const existing = liveList[existingIdx];
          // Enrich missing minute, events, or liveStats from the newer source without losing DB ID
          const mergedMeta = {
            ...existing.metadata,
            minute: existing.metadata?.minute ?? candidate.metadata?.minute ?? null,
            stoppageTime: existing.metadata?.stoppageTime ?? candidate.metadata?.stoppageTime,
            displayClock: existing.metadata?.displayClock ?? candidate.metadata?.displayClock,
            period:
              existing.metadata?.period && existing.metadata.period !== 'LIVE'
                ? existing.metadata.period
                : candidate.metadata?.period || 'LIVE',
            events:
              existing.metadata?.events?.length > 0
                ? existing.metadata.events
                : candidate.metadata?.events || [],
            liveStats: existing.metadata?.liveStats || candidate.metadata?.liveStats,
            moneylineOdds: existing.metadata?.moneylineOdds || candidate.metadata?.moneylineOdds,
          };
          liveList[existingIdx] = {
            ...existing,
            metadata: mergedMeta,
          };
          return;
        }

        seenExternalIds.add(candidate.externalId);
        pairIndexMap.set(pairKey, liveList.length);
        liveList.push(candidate);
      };

      // 1. Try API-Football v3 ONLY if configured & not in suspension/cooldown
      if (process.env.API_FOOTBALL_KEY && !ApiFootballProvider.isInCircuitBreakerCooldown()) {
        try {
          const apiFootball = new ApiFootballProvider();
          const rawLive = await apiFootball.fetchLiveMatches();
          if (Array.isArray(rawLive) && rawLive.length > 0) {
            rawLive.forEach((m, idx) => {
              const homeScore = m.homeScoreFullTime ?? 0;
              const awayScore = m.awayScoreFullTime ?? 0;
              const reportedMinute = typeof m.metadata?.elapsed === 'number' ? m.metadata.elapsed : null;
              const mathMinute = this.estimateElapsedForProbability(m.kickoffTime, reportedMinute);
              const inPlay = this.calculateInPlayProbabilities(homeScore, awayScore, mathMinute);
              const statusShort = (m.metadata?.statusShort as string) || '';
              const period: LiveMatchMetadata['period'] =
                statusShort === 'HT'
                  ? 'HT'
                  : statusShort === '2H'
                  ? '2H'
                  : statusShort === '1H'
                  ? '1H'
                  : statusShort === 'ET'
                  ? 'ET'
                  : reportedMinute !== null
                  ? reportedMinute > 45
                    ? '2H'
                    : '1H'
                  : 'LIVE';

              pushOrMergeLive({
                id: (m.metadata?.apiFootballId as number) || 900000 + idx,
                isDatabaseMatch: false,
                externalId: m.externalId,
                competitionId: 0,
                competitionName: m.metadata?.leagueName || m.competitionCode || 'Live Competition',
                competitionCode: m.competitionCode || 'LIVE',
                round: m.round || 'In Play',
                kickoffTime: m.kickoffTime.toISOString(),
                status: 'LIVE',
                homeTeam: m.homeTeamRawName,
                awayTeam: m.awayTeamRawName,
                homeShortName: m.homeTeamRawName.slice(0, 3).toUpperCase(),
                awayShortName: m.awayTeamRawName.slice(0, 3).toUpperCase(),
                homeScoreFullTime: homeScore,
                awayScoreFullTime: awayScore,
                result: m.result,
                venue: m.venue || 'Stadium',
                metadata: {
                  minute: reportedMinute,
                  period,
                  lastUpdated: new Date().toISOString(),
                  providerSource: 'api-football-v3',
                  events: [],
                  inPlayProbabilities: inPlay,
                },
              });
            });
          }
        } catch (err: any) {
          console.warn('[LiveMatchEngine] API-Football live fetch notice:', err?.message);
        }
      }

      // 2. Query Football-Data.org live matches + Live Web Feed in parallel for broad zero-error coverage
      const [fdLiveResult, webLiveResult, dbLiveMatches] = await Promise.all([
        process.env.FOOTBALL_DATA_API_KEY
          ? new FootballDataProvider().fetchLiveMatches().catch(() => [])
          : Promise.resolve([]),
        new LiveWebFeedProvider().fetchLiveMatches().catch(() => []),
        db
          .select({
            id: matches.id,
            externalId: matches.externalId,
            competitionId: matches.competitionId,
            competitionName: competitions.name,
            competitionCode: competitions.code,
            round: matches.round,
            kickoffTime: matches.kickoffTime,
            status: matches.status,
            homeTeamId: matches.homeTeamId,
            awayTeamId: matches.awayTeamId,
            homeScoreFullTime: matches.homeScoreFullTime,
            awayScoreFullTime: matches.awayScoreFullTime,
            result: matches.result,
            venue: matches.venue,
            metadata: matches.metadata,
          })
          .from(matches)
          .innerJoin(competitions, eq(matches.competitionId, competitions.id))
          .where(eq(matches.status, 'LIVE'))
          .orderBy(desc(matches.kickoffTime)),
      ]);

      // Add Football-Data.org live matches
      if (Array.isArray(fdLiveResult) && fdLiveResult.length > 0) {
        fdLiveResult.forEach((m, idx) => {
          const homeScore = m.homeScoreFullTime ?? 0;
          const awayScore = m.awayScoreFullTime ?? 0;
          const mathMinute = this.estimateElapsedForProbability(m.kickoffTime, null);
          const inPlay = this.calculateInPlayProbabilities(homeScore, awayScore, mathMinute);

          pushOrMergeLive({
            id: 950000 + idx,
            isDatabaseMatch: false,
            externalId: m.externalId,
            competitionId: 0,
            competitionName: m.competitionCode || 'Live League',
            competitionCode: m.competitionCode || 'LIVE',
            round: m.round || 'In Play',
            kickoffTime: m.kickoffTime.toISOString(),
            status: 'LIVE',
            homeTeam: m.homeTeamRawName,
            awayTeam: m.awayTeamRawName,
            homeShortName: m.homeTeamRawName.slice(0, 3).toUpperCase(),
            awayShortName: m.awayTeamRawName.slice(0, 3).toUpperCase(),
            homeScoreFullTime: homeScore,
            awayScoreFullTime: awayScore,
            result: m.result,
            venue: m.venue || 'Stadium',
            metadata: {
              minute: null,
              period: 'LIVE' as const,
              lastUpdated: new Date().toISOString(),
              providerSource: 'football-data-org',
              events: [],
              inPlayProbabilities: inPlay,
            },
          });
        });
      }

      // Add / merge Live Web Feed matches (real clocks, events, and team stats)
      if (Array.isArray(webLiveResult) && webLiveResult.length > 0) {
        webLiveResult.forEach((item, idx) => {
          pushOrMergeLive(this.mapWebScoreboardItemToLiveMatch(item, idx));
        });
      }

      // Supplement / merge PostgreSQL live fixtures if any
      if (dbLiveMatches.length > 0) {
        const allTeams = await db.select().from(teams);
        const teamMap = new Map(allTeams.map((t) => [t.id, t]));

        dbLiveMatches.forEach((m) => {
          const meta = (m.metadata as any)?.liveData as LiveMatchMetadata | undefined;
          const currentHomeScore = m.homeScoreFullTime ?? 0;
          const currentAwayScore = m.awayScoreFullTime ?? 0;
          const reportedMinute = typeof meta?.minute === 'number' ? meta.minute : null;
          const mathMinute = this.estimateElapsedForProbability(new Date(m.kickoffTime), reportedMinute);
          const inPlay = this.calculateInPlayProbabilities(currentHomeScore, currentAwayScore, mathMinute);

          pushOrMergeLive({
            ...m,
            isDatabaseMatch: true,
            homeTeam: teamMap.get(m.homeTeamId)?.canonicalName || 'Home Team',
            awayTeam: teamMap.get(m.awayTeamId)?.canonicalName || 'Away Team',
            homeShortName: teamMap.get(m.homeTeamId)?.shortName || 'Home',
            awayShortName: teamMap.get(m.awayTeamId)?.shortName || 'Away',
            metadata: {
              minute: reportedMinute,
              period: meta?.period || (reportedMinute !== null ? (reportedMinute > 45 ? '2H' : '1H') : 'LIVE'),
              lastUpdated: new Date().toISOString(),
              providerSource: 'postgresql-verified',
              events: meta?.events || [],
              ...(meta?.liveStats ? { liveStats: meta.liveStats } : {}),
              inPlayProbabilities: inPlay,
            },
          });
        });
      }

      this.cachedLiveMatches = liveList;
      this.lastCacheTime = now;
      return liveList;
    } catch (err: any) {
      console.warn('[LiveMatchEngine] Query error:', err?.message || err);
      return [];
    }
  }

  /**
   * Unified Live Web Feed Snapshot for Engine & Live Dashboard
   * Aggregates verified live scores, today's global web scoreboard, news dispatches, and source health cleanly.
   */
  public static async getLiveWebFeedSnapshot(forceRefresh = false): Promise<LiveWebFeedSnapshot> {
    const start = Date.now();
    const webProvider = new LiveWebFeedProvider();

    const [bundleRes, liveMatches, newsRes] = await Promise.all([
      webProvider.fetchWebScoreboardBundle(forceRefresh).catch((): LiveWebScoreboardBundle | null => null),
      this.getLiveMatches(forceRefresh),
      NewsEngine.getFootballNews('ALL').catch(() => ({
        articles: [] as FootballNewsArticle[],
        sourceCount: 0,
        activeSources: [] as string[],
        failedSources: [] as Array<{ source: string; reason: string }>,
        lastRetrieved: new Date().toISOString(),
        isFresh: false,
      })),
    ]);

    const feedSources: LiveWebFeedSnapshot['feedSources'] = [
      {
        id: 'live-web-feed',
        name: 'Global Live Web Scoreboard',
        status: bundleRes ? 'OPERATIONAL' : 'OFFLINE',
        detail: bundleRes
          ? `${bundleRes.leaguesCovered} leagues • ${bundleRes.live.length} live • ${bundleRes.upcoming.length} upcoming`
          : 'Scoreboard feed temporarily unreachable',
      },
      {
        id: 'football-data-org',
        name: 'Football-Data.org Live Stream',
        status: process.env.FOOTBALL_DATA_API_KEY ? 'OPERATIONAL' : 'STANDBY',
        detail: process.env.FOOTBALL_DATA_API_KEY
          ? 'Authenticated API v4 stream active'
          : 'No FOOTBALL_DATA_API_KEY configured',
      },
      {
        id: 'api-football-v3',
        name: 'API-Football v3 Live Stream',
        status: !process.env.API_FOOTBALL_KEY
          ? 'STANDBY'
          : ApiFootballProvider.isInCircuitBreakerCooldown()
          ? 'STANDBY'
          : 'OPERATIONAL',
        detail: !process.env.API_FOOTBALL_KEY
          ? 'No API_FOOTBALL_KEY configured'
          : ApiFootballProvider.isInCircuitBreakerCooldown()
          ? 'Paused via circuit-breaker cooldown (fallback active)'
          : 'API-Sports live stream enabled',
      },
      {
        id: 'web-intelligence',
        name: 'Football Web & RSS Dispatches',
        status: newsRes.activeSources.length > 0 ? 'OPERATIONAL' : 'OFFLINE',
        detail:
          newsRes.activeSources.length > 0
            ? `${newsRes.activeSources.length} active feeds (${newsRes.articles.length} articles)`
            : 'No dispatch feeds reachable',
      },
    ];

    return {
      status: bundleRes || liveMatches.length > 0 || newsRes.activeSources.length > 0 ? 'OPERATIONAL' : 'DEGRADED',
      lastUpdated: new Date().toISOString(),
      latencyMs: Date.now() - start,
      leaguesCovered: bundleRes?.leaguesCovered ?? 0,
      liveMatches,
      upcomingToday: (bundleRes?.upcoming ?? []).slice(0, 18),
      recentResults: (bundleRes?.finished ?? []).slice(0, 12),
      dispatches: (newsRes.articles ?? []).slice(0, 8),
      feedSources,
    };
  }

  /**
   * Mathematical In-Play Probability Engine
   * Calculates remaining Poisson expectations conditioned on current scoreline and elapsed time.
   */
  public static calculateInPlayProbabilities(
    homeScore: number,
    awayScore: number,
    minute: number
  ): { homeWin: number; draw: number; awayWin: number } {
    const remainingFraction = Math.max(0, (90 - minute) / 90);

    // Baseline goal rates per 90 mins for typical competitive fixture (~1.45 home, ~1.15 away)
    const remainingLambdaHome = 1.45 * remainingFraction;
    const remainingLambdaAway = 1.15 * remainingFraction;

    let pHomeWin = 0;
    let pDraw = 0;
    let pAwayWin = 0;

    // Convolve bivariate Poisson for remaining goals (up to 6 additional goals each)
    const maxG = 6;
    for (let h = 0; h <= maxG; h++) {
      const pH = this.poissonPmf(remainingLambdaHome, h);
      for (let a = 0; a <= maxG; a++) {
        const pA = this.poissonPmf(remainingLambdaAway, a);
        const jointP = pH * pA;
        const finalHome = homeScore + h;
        const finalAway = awayScore + a;

        if (finalHome > finalAway) pHomeWin += jointP;
        else if (finalHome === finalAway) pDraw += jointP;
        else pAwayWin += jointP;
      }
    }

    const total = pHomeWin + pDraw + pAwayWin || 1;
    return {
      homeWin: Number((pHomeWin / total).toFixed(4)),
      draw: Number((pDraw / total).toFixed(4)),
      awayWin: Number((pAwayWin / total).toFixed(4)),
    };
  }

  private static poissonPmf(lambda: number, k: number): number {
    if (lambda <= 0) return k === 0 ? 1 : 0;
    return (Math.exp(-lambda) * Math.pow(lambda, k)) / this.factorial(k);
  }

  private static factorial(n: number): number {
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return f;
  }
}
