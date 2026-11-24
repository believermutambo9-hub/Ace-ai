import {
  IFootballDataProvider,
  NormalizedCompetition,
  NormalizedMatch,
  NormalizedMatchStats,
  NormalizedTeamStats,
  ProviderHealth,
  MatchStatus,
  MatchResult,
} from '../contracts/provider.interface.ts';
import { BaseFootballDataProvider } from './baseProvider.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';

/**
 * Mapping of canonical competition codes to API-Football (v3) League IDs
 */
export const LEAGUE_ID_MAP: Record<string, number> = {
  PL: 39, // Premier League (England)
  CL: 2, // UEFA Champions League
  EL: 3, // UEFA Europa League
  PD: 140, // La Liga (Spain)
  SA: 135, // Serie A (Italy)
  BL1: 78, // Bundesliga (Germany)
  FL1: 61, // Ligue 1 (France)
  DED: 88, // Eredivisie (Netherlands)
  PPL: 94, // Primeira Liga (Portugal)
  MLS: 253, // Major League Soccer (USA)
  BSA: 71, // Serie A (Brazil)
  ARG: 128, // Primera División (Argentina)
  CAF_CL: 12, // CAF Champions League
  ACL: 17, // AFC Champions League
};

export const REVERSE_LEAGUE_MAP: Record<number, string> = Object.entries(LEAGUE_ID_MAP).reduce(
  (acc, [code, id]) => {
    acc[id] = code;
    return acc;
  },
  {} as Record<number, string>
);

export interface ApiFootballRateLimitInfo {
  remaining?: number;
  limit?: number;
  lastChecked?: Date;
}

/**
 * Real Football Data Provider Adapter for API-Sports (API-Football v3 Direct).
 * Connects directly to https://v3.football.api-sports.io via API_FOOTBALL_KEY or RapidAPI credentials.
 * Docs: https://www.api-football.com/documentation-v3
 */
export class ApiFootballProvider extends BaseFootballDataProvider implements IFootballDataProvider {
  readonly name = 'api-football-v3';
  private readonly apiKey: string | undefined;
  private readonly isRapidApi: boolean;
  private readonly baseUrl: string;
  private rateLimitInfo: ApiFootballRateLimitInfo = {};

  private static suspensionCooldownUntil = 0;
  private static suspensionMessage: string | null = null;
  private static readonly COOLDOWN_MS = 15 * 60 * 1000;

  constructor() {
    super(10 * 60 * 1000); // 10 minute cache TTL
    this.apiKey = process.env.API_FOOTBALL_KEY || process.env.RAPIDAPI_KEY;
    this.isRapidApi = Boolean(!process.env.API_FOOTBALL_KEY && process.env.RAPIDAPI_KEY);
    this.baseUrl = this.isRapidApi
      ? 'https://api-football-v1.p.rapidapi.com/v3'
      : 'https://v3.football.api-sports.io';
  }

  public static isInCircuitBreakerCooldown(): boolean {
    return Date.now() < this.suspensionCooldownUntil;
  }

  public static resetCircuitBreaker(): void {
    this.suspensionCooldownUntil = 0;
    this.suspensionMessage = null;
  }

  private handleApiErrorsPayload(json: any): boolean {
    const errors = json?.errors;
    const hasErrors = errors && (Array.isArray(errors) ? errors.length > 0 : Object.keys(errors).length > 0);
    if (!hasErrors) return false;
    const errorMsg = typeof errors === 'object' ? Object.values(errors).join(', ') : String(errors);
    const lower = errorMsg.toLowerCase();
    if (lower.includes('suspend') || lower.includes('blocked') || lower.includes('token') || lower.includes('key') || lower.includes('limit')) {
      ApiFootballProvider.suspensionCooldownUntil = Date.now() + ApiFootballProvider.COOLDOWN_MS;
      ApiFootballProvider.suspensionMessage = errorMsg;
    }
    return true;
  }

  private getHeaders(): Record<string, string> {
    if (!this.apiKey) return {};
    if (this.isRapidApi) {
      return {
        'x-rapidapi-key': this.apiKey,
        'x-rapidapi-host': 'api-football-v1.p.rapidapi.com',
      };
    }
    return {
      'x-apisports-key': this.apiKey,
    };
  }

  private trackRateLimits(headers: Headers): void {
    const remaining = headers.get('x-ratelimit-requests-remaining');
    const limit = headers.get('x-ratelimit-requests-limit');
    if (remaining !== null) {
      this.rateLimitInfo.remaining = parseInt(remaining, 10);
    }
    if (limit !== null) {
      this.rateLimitInfo.limit = parseInt(limit, 10);
    }
    this.rateLimitInfo.lastChecked = new Date();
  }

  public getRateLimitInfo(): ApiFootballRateLimitInfo {
    return { ...this.rateLimitInfo };
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
          'No API key configured in environment (API_FOOTBALL_KEY / RAPIDAPI_KEY). Running in STANDBY mode with Live Web Feed, Football-Data & OpenFootball.',
      };
    }

    if (ApiFootballProvider.isInCircuitBreakerCooldown()) {
      return {
        providerName: this.name,
        isOnline: false,
        latencyMs: 0,
        lastChecked: new Date(),
        message: `API-Football paused (cooldown active): ${ApiFootballProvider.suspensionMessage || 'Account unavailable'}`,
      };
    }

    try {
      const res = await this.fetchWithRetry(
        `${this.baseUrl}/status`,
        { headers: this.getHeaders() },
        2
      );
      this.trackRateLimits(res.headers);

      if (!res.ok) {
        return {
          providerName: this.name,
          isOnline: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
          message: `API-Football responded with HTTP ${res.status}: ${res.statusText}`,
        };
      }
      const data = await res.json();
      if (this.handleApiErrorsPayload(data)) {
        return {
          providerName: this.name,
          isOnline: false,
          latencyMs: Date.now() - start,
          lastChecked: new Date(),
          message: `API-Football authentication notice: ${ApiFootballProvider.suspensionMessage || 'Provider error'}`,
        };
      }

      const account = data.response?.account;
      const requests = data.response?.requests;
      const accountInfo = account?.email ? ` (${account.email})` : '';
      const quotaInfo = requests ? ` [${requests.current}/${requests.limit_day} requests used today]` : '';

      return {
        providerName: this.name,
        isOnline: true,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: `API-Football operational${accountInfo}${quotaInfo}`,
      };
    } catch (err: any) {
      return {
        providerName: this.name,
        isOnline: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: `Connection failed: ${err.message}`,
      };
    }
  }

  async fetchCompetitions(): Promise<NormalizedCompetition[]> {
    return CANONICAL_COMPETITIONS;
  }

  /**
   * Fetch fixtures for a given competition and season
   */
  async fetchMatches(competitionCode: string, seasonCode = '2024'): Promise<NormalizedMatch[]> {
    if (!this.apiKey || ApiFootballProvider.isInCircuitBreakerCooldown()) {
      return [];
    }

    const leagueId = LEAGUE_ID_MAP[competitionCode];
    if (!leagueId) {
      console.warn(`[ApiFootballProvider] No league ID mapped for competition code: ${competitionCode}`);
      return [];
    }

    // Extract numerical year for season parameter (e.g., '2024-2025' -> '2024')
    const seasonYear = seasonCode.includes('-') ? seasonCode.split('-')[0] : seasonCode;

    try {
      const url = `${this.baseUrl}/fixtures?league=${leagueId}&season=${seasonYear}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);

      if (!res.ok) {
        console.error(`[ApiFootballProvider] Failed to fetch fixtures for league ${leagueId}: HTTP ${res.status}`);
        return [];
      }

      const json = await res.json();
      if (this.handleApiErrorsPayload(json) || !json.response || !Array.isArray(json.response)) {
        return [];
      }

      return json.response.map((item: any) => this.normalizeFixture(item, competitionCode, seasonCode));
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching matches for ${competitionCode}:`, err.message);
      return [];
    }
  }

  /**
   * Fetch all worldwide matches currently LIVE (in play)
   */
  async fetchLiveMatches(): Promise<NormalizedMatch[]> {
    if (!this.apiKey || ApiFootballProvider.isInCircuitBreakerCooldown()) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/fixtures?live=all`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);

      if (!res.ok) {
        console.error(`[ApiFootballProvider] Live fixtures query failed: HTTP ${res.status}`);
        return [];
      }

      const json = await res.json();
      if (this.handleApiErrorsPayload(json) || !json.response || !Array.isArray(json.response)) {
        return [];
      }

      return json.response.map((item: any) => {
        const leagueId = item.league?.id;
        const compCode = REVERSE_LEAGUE_MAP[leagueId] || item.league?.country || 'INT';
        const seasonCode = String(item.league?.season || new Date().getFullYear());
        return this.normalizeFixture(item, compCode, seasonCode);
      });
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching live matches:`, err.message);
      return [];
    }
  }

  /**
   * Fetch upcoming fixtures for a date or date range
   */
  async fetchUpcomingFixtures(options: {
    date?: string; // YYYY-MM-DD
    from?: string; // YYYY-MM-DD
    to?: string; // YYYY-MM-DD
    leagueId?: number;
    season?: string;
  } = {}): Promise<NormalizedMatch[]> {
    if (!this.apiKey || ApiFootballProvider.isInCircuitBreakerCooldown()) {
      return [];
    }

    try {
      let queryParams = '';
      if (options.date) {
        queryParams = `date=${options.date}`;
      } else if (options.from && options.to) {
        queryParams = `from=${options.from}&to=${options.to}`;
        if (options.leagueId && options.season) {
          queryParams += `&league=${options.leagueId}&season=${options.season}`;
        }
      } else {
        const todayStr = new Date().toISOString().split('T')[0];
        queryParams = `date=${todayStr}`;
      }

      const url = `${this.baseUrl}/fixtures?${queryParams}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);

      if (!res.ok) {
        console.error(`[ApiFootballProvider] Upcoming fixtures query failed: HTTP ${res.status}`);
        return [];
      }

      const json = await res.json();
      if (this.handleApiErrorsPayload(json) || !json.response || !Array.isArray(json.response)) {
        return [];
      }

      return json.response.map((item: any) => {
        const leagueId = item.league?.id;
        const compCode = REVERSE_LEAGUE_MAP[leagueId] || item.league?.name || 'INT';
        const seasonCode = String(item.league?.season || new Date().getFullYear());
        return this.normalizeFixture(item, compCode, seasonCode);
      });
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching upcoming fixtures:`, err.message);
      return [];
    }
  }

  /**
   * Fetch Head-to-Head history between two team IDs
   */
  async fetchHeadToHead(team1Id: number, team2Id: number): Promise<any[]> {
    if (!this.apiKey) return [];
    try {
      const url = `${this.baseUrl}/fixtures/headtohead?h2h=${team1Id}-${team2Id}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);
      if (!res.ok) return [];
      const json = await res.json();
      return json.response || [];
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching H2H for ${team1Id}-${team2Id}:`, err.message);
      return [];
    }
  }

  /**
   * Fetch official starting lineups and formations for a fixture
   */
  async fetchLineups(fixtureId: number): Promise<any[]> {
    if (!this.apiKey) return [];
    try {
      const url = `${this.baseUrl}/fixtures/lineups?fixture=${fixtureId}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);
      if (!res.ok) return [];
      const json = await res.json();
      return json.response || [];
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching lineups for ${fixtureId}:`, err.message);
      return [];
    }
  }

  /**
   * Fetch verified player absences (injuries & suspensions)
   */
  async fetchInjuries(options: {
    leagueId?: number;
    season?: string;
    fixtureId?: number;
    teamId?: number;
  }): Promise<any[]> {
    if (!this.apiKey) return [];
    try {
      const params: string[] = [];
      if (options.fixtureId) params.push(`fixture=${options.fixtureId}`);
      if (options.leagueId) params.push(`league=${options.leagueId}`);
      if (options.season) params.push(`season=${options.season.split('-')[0]}`);
      if (options.teamId) params.push(`team=${options.teamId}`);

      if (params.length === 0) return [];

      const url = `${this.baseUrl}/injuries?${params.join('&')}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);
      if (!res.ok) return [];
      const json = await res.json();
      return json.response || [];
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching injuries:`, err.message);
      return [];
    }
  }

  /**
   * Fetch bookmaker odds for a fixture
   */
  async fetchOdds(fixtureId: number): Promise<any[]> {
    if (!this.apiKey) return [];
    try {
      const url = `${this.baseUrl}/odds?fixture=${fixtureId}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);
      if (!res.ok) return [];
      const json = await res.json();
      return json.response || [];
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching odds for ${fixtureId}:`, err.message);
      return [];
    }
  }

  async fetchMatchStats(matchExternalId: string): Promise<NormalizedMatchStats | null> {
    if (!this.apiKey) {
      return null;
    }

    const fixtureId = matchExternalId.replace('apifootball_', '');
    try {
      const url = `${this.baseUrl}/fixtures/statistics?fixture=${fixtureId}`;
      const res = await this.fetchWithRetry(url, { headers: this.getHeaders() }, 2);
      this.trackRateLimits(res.headers);
      if (!res.ok) return null;

      const json = await res.json();
      if (!json.response || !Array.isArray(json.response) || json.response.length < 2) {
        return null;
      }

      const homeItem = json.response[0];
      const awayItem = json.response[1];

      return {
        matchExternalId,
        homeTeamRawName: homeItem.team?.name || 'Home',
        awayTeamRawName: awayItem.team?.name || 'Away',
        home: this.parseStatsArray(homeItem.statistics || []),
        away: this.parseStatsArray(awayItem.statistics || []),
      };
    } catch (err: any) {
      console.error(`[ApiFootballProvider] Error fetching match stats for ${matchExternalId}:`, err.message);
      return null;
    }
  }

  private parseStatsArray(stats: Array<{ type: string; value: any }>): NormalizedTeamStats {
    const map: Record<string, any> = {};
    for (const s of stats) {
      map[s.type.toLowerCase()] = s.value;
    }

    const parseNum = (val: any) => {
      if (val === null || val === undefined) return undefined;
      const num = typeof val === 'string' ? parseFloat(val.replace('%', '')) : Number(val);
      return isNaN(num) ? undefined : num;
    };

    return {
      shots: parseNum(map['total shots']),
      shotsOnTarget: parseNum(map['shots on goal']),
      possession: parseNum(map['ball possession']),
      corners: parseNum(map['corner kicks']),
      fouls: parseNum(map['fouls']),
      yellowCards: parseNum(map['yellow cards']),
      redCards: parseNum(map['red cards']),
      offsides: parseNum(map['offsides']),
      xg: parseNum(map['expected_goals']),
    };
  }

  private normalizeFixture(item: any, competitionCode: string, seasonCode: string): NormalizedMatch {
    const fixture = item.fixture || {};
    const teams = item.teams || {};
    const goals = item.goals || {};
    const score = item.score || {};

    const shortStatus = (fixture.status?.short || '').toUpperCase();
    let status: MatchStatus = 'SCHEDULED';
    if (['1H', '2H', 'HT', 'ET', 'P', 'LIVE'].includes(shortStatus)) {
      status = 'LIVE';
    } else if (['FT', 'AET', 'PEN'].includes(shortStatus)) {
      status = 'FINISHED';
    } else if (['PST'].includes(shortStatus)) {
      status = 'POSTPONED';
    } else if (['CANC', 'ABD'].includes(shortStatus)) {
      status = 'CANCELLED';
    }

    let result: MatchResult | null = null;
    if (goals.home !== null && goals.away !== null) {
      if (goals.home > goals.away) result = 'HOME_WIN';
      else if (goals.home < goals.away) result = 'AWAY_WIN';
      else result = 'DRAW';
    }

    return {
      externalId: `apifootball_${fixture.id}`,
      providerSource: this.name,
      competitionCode,
      seasonCode,
      round: item.league?.round,
      kickoffTime: new Date(fixture.date),
      homeTeamRawName: teams.home?.name || 'Home Team',
      awayTeamRawName: teams.away?.name || 'Away Team',
      venue: fixture.venue?.name,
      referee: fixture.referee,
      status,
      homeScoreHalfTime: score.halftime?.home ?? null,
      awayScoreHalfTime: score.halftime?.away ?? null,
      homeScoreFullTime: goals.home ?? null,
      awayScoreFullTime: goals.away ?? null,
      result,
      metadata: {
        apiFootballId: fixture.id,
        statusShort: shortStatus,
        elapsed: fixture.status?.elapsed,
        leagueName: item.league?.name,
        leagueCountry: item.league?.country,
        homeTeamLogo: teams.home?.logo,
        awayTeamLogo: teams.away?.logo,
      },
    };
  }
}
