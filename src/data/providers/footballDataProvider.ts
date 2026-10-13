import {
  IFootballDataProvider,
  NormalizedCompetition,
  NormalizedMatch,
  NormalizedMatchStats,
  ProviderHealth,
  MatchStatus,
  MatchResult,
} from '../contracts/provider.interface.ts';
import { BaseFootballDataProvider } from './baseProvider.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';

/**
 * Football-Data.org API v4 Provider
 * Replaces RapidAPI with the direct authenticated Football-Data.org token provided by the user.
 * Docs: https://www.football-data.org/documentation/api
 */
export class FootballDataProvider extends BaseFootballDataProvider implements IFootballDataProvider {
  readonly name = 'football-data-org';
  private readonly apiKey: string | undefined;
  private readonly baseUrl = 'https://api.football-data.org/v4';

  constructor() {
    super(10 * 60 * 1000); // 10 minute cache TTL
    this.apiKey = process.env.FOOTBALL_DATA_API_KEY;
  }

  private getHeaders(): Record<string, string> {
    if (!this.apiKey) return {};
    return {
      'X-Auth-Token': this.apiKey,
    };
  }

  async checkHealth(): Promise<ProviderHealth> {
    const start = Date.now();
    if (!this.apiKey) {
      return {
        providerName: this.name,
        isOnline: false,
        latencyMs: 0,
        lastChecked: new Date(),
        message:
          'No FOOTBALL_DATA_API_KEY configured in environment. In standby mode.',
      };
    }

    try {
      const res = await this.fetchWithRetry(
        `${this.baseUrl}/competitions`,
        { headers: this.getHeaders() },
        2
      );

      if (!res.ok) {
        return {
          providerName: this.name,
          isOnline: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
          message: `Football-Data.org returned HTTP ${res.status}: ${res.statusText}`,
        };
      }

      const data = await res.json();
      const count = data.count || data.competitions?.length || 0;
      const clientName = data.filters?.client || 'Authenticated User';

      return {
        providerName: this.name,
        isOnline: true,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: `Football-Data.org v4 Active (Client: ${clientName}, ${count} competitions available)`,
      };
    } catch (err: any) {
      return {
        providerName: this.name,
        isOnline: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: err.message || 'Connection failure to Football-Data.org',
      };
    }
  }

  async fetchCompetitions(): Promise<NormalizedCompetition[]> {
    const cached = this.getCached<NormalizedCompetition[]>('competitions');
    if (cached) return cached;

    if (!this.apiKey) {
      return CANONICAL_COMPETITIONS;
    }

    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/competitions`, {
        headers: this.getHeaders(),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const rawComps = data.competitions || [];

      const normalized: NormalizedCompetition[] = rawComps.map((c: any) => ({
        code: c.code || String(c.id),
        name: c.name,
        country: c.area?.name || 'International',
        tier: c.plan === 'TIER_ONE' ? 1 : 2,
        type: c.type === 'CUP' ? 'CUP' : 'LEAGUE',
        emblem: c.emblem,
      }));

      this.setCached('competitions', normalized);
      return normalized;
    } catch (err) {
      console.warn(`[${this.name}] Failed to fetch live competitions, falling back to canonical`, err);
      return CANONICAL_COMPETITIONS;
    }
  }

  async fetchMatches(competitionCode: string, seasonCode?: string): Promise<NormalizedMatch[]> {
    const cacheKey = `matches_${competitionCode}_${seasonCode || 'current'}`;
    const cached = this.getCached<NormalizedMatch[]>(cacheKey);
    if (cached) return cached;

    if (!this.apiKey) {
      return [];
    }

    try {
      // football-data.org accepts competition code directly: e.g. /v4/competitions/PL/matches
      let url = `${this.baseUrl}/competitions/${encodeURIComponent(competitionCode)}/matches`;
      if (seasonCode) {
        const year = seasonCode.split('-')[0];
        url += `?season=${encodeURIComponent(year)}`;
      }

      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();
      const rawMatches = data.matches || [];

      const normalized: NormalizedMatch[] = rawMatches.map((m: any) => {
        let status: MatchStatus = 'SCHEDULED';
        if (m.status === 'FINISHED') status = 'FINISHED';
        else if (m.status === 'IN_PLAY' || m.status === 'PAUSED') status = 'LIVE';
        else if (m.status === 'POSTPONED') status = 'POSTPONED';
        else if (m.status === 'CANCELLED') status = 'CANCELLED';

        let result: MatchResult | null = null;
        if (m.score?.winner === 'HOME_TEAM') result = 'HOME_WIN';
        else if (m.score?.winner === 'AWAY_TEAM') result = 'AWAY_WIN';
        else if (m.score?.winner === 'DRAW') result = 'DRAW';

        return {
          externalId: `fd_${m.id}`,
          providerSource: 'football-data-org',
          competitionCode: m.competition?.code || competitionCode,
          seasonCode: m.season?.startDate
            ? `${m.season.startDate.slice(0, 4)}-${m.season.endDate?.slice(0, 4) || ''}`
            : seasonCode || '2024-2025',
          round: m.stage || (m.matchday ? `Matchday ${m.matchday}` : undefined),
          matchday: m.matchday,
          kickoffTime: new Date(m.utcDate),
          homeTeamRawName: m.homeTeam?.name || 'Home Team',
          awayTeamRawName: m.awayTeam?.name || 'Away Team',
          venue: m.venue || undefined,
          referee: m.referees?.[0]?.name,
          status,
          homeScoreHalfTime: m.score?.halfTime?.home ?? null,
          awayScoreHalfTime: m.score?.halfTime?.away ?? null,
          homeScoreFullTime: m.score?.fullTime?.home ?? null,
          awayScoreFullTime: m.score?.fullTime?.away ?? null,
          result,
          metadata: {
            homeTeamId: m.homeTeam?.id,
            awayTeamId: m.awayTeam?.id,
            homeTeamCrest: m.homeTeam?.crest,
            awayTeamCrest: m.awayTeam?.crest,
            homeTeamTla: m.homeTeam?.tla,
            awayTeamTla: m.awayTeam?.tla,
            homeTeamShortName: m.homeTeam?.shortName,
            awayTeamShortName: m.awayTeam?.shortName,
            lastUpdated: m.lastUpdated,
          },
        };
      });

      this.setCached(cacheKey, normalized, 5 * 60 * 1000); // 5 min TTL
      return normalized;
    } catch (err: any) {
      console.error(`[${this.name}] Error fetching matches for ${competitionCode}:`, err.message);
      return [];
    }
  }

  async fetchMatchStats(_matchExternalId: string): Promise<NormalizedMatchStats | null> {
    // Football-Data.org free tier does not provide detailed shot xG statistics per match
    return null;
  }
}
