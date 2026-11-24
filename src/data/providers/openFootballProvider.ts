import { NormalizedCompetition, NormalizedMatch, NormalizedMatchStats, ProviderHealth } from '../contracts/provider.interface.ts';
import { BaseFootballDataProvider } from './baseProvider.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';

interface OpenFootballRawMatch {
  round?: string;
  date: string;
  team1: string;
  team2: string;
  score?: {
    ft?: [number, number];
    ht?: [number, number];
  };
}

interface OpenFootballLeagueFeed {
  name: string;
  matches: OpenFootballRawMatch[];
}

export class OpenFootballProvider extends BaseFootballDataProvider {
  readonly name = 'open-football';

  // Base raw github repositories for openfootball JSON feeds
  private readonly baseUrl = 'https://raw.githubusercontent.com/openfootball/football.json/master';

  private readonly leagueFileMap: Record<string, string> = {
    PL: 'en.1.json',
    PD: 'es.1.json',
    SA: 'it.1.json',
    BL1: 'de.1.json',
    FL1: 'fr.1.json',
    CL: 'cl.json',
    DED: 'nl.1.json',
    PPL: 'pt.1.json',
  };

  /**
   * Format seasonCode (e.g. '2023-2024' or '2023-24') to OpenFootball folder slug (e.g. '2023-24')
   */
  private formatSeasonSlug(seasonCode: string): string {
    if (seasonCode.includes('-')) {
      const parts = seasonCode.split('-');
      const startYear = parts[0];
      const endYear = parts[1].length === 4 ? parts[1].slice(2) : parts[1];
      return `${startYear}-${endYear}`;
    }
    return seasonCode;
  }

  async checkHealth(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      const res = await this.fetchWithRetry(`${this.baseUrl}/2023-24/en.1.json`, { method: 'HEAD' }, 2);
      return {
        providerName: this.name,
        isOnline: res.ok,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: res.ok
          ? 'Open Football CDN reachable (Multi-season historical archives)'
          : `Open Football CDN returned HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        providerName: this.name,
        isOnline: false,
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        message: `Open Football CDN unreachable: ${err?.message || 'Network error'}`,
      };
    }
  }

  async fetchCompetitions(): Promise<NormalizedCompetition[]> {
    return CANONICAL_COMPETITIONS;
  }

  async fetchMatches(competitionCode: string, seasonCode = '2023-2024'): Promise<NormalizedMatch[]> {
    const cacheKey = `matches_${competitionCode}_${seasonCode}`;
    const cached = this.getCached<NormalizedMatch[]>(cacheKey);
    if (cached) return cached;

    const results: NormalizedMatch[] = [];
    const fileName = this.leagueFileMap[competitionCode];
    const seasonSlug = this.formatSeasonSlug(seasonCode);
    const relativePath = fileName ? `${seasonSlug}/${fileName}` : null;

    if (!relativePath) {
      return [];
    }

    try {
      const response = await this.fetchWithRetry(`${this.baseUrl}/${relativePath}`, undefined, 2);
      if (response.ok) {
        const feed: OpenFootballLeagueFeed = await response.json();
        if (feed.matches && Array.isArray(feed.matches)) {
          for (let i = 0; i < feed.matches.length; i++) {
            const raw = feed.matches[i];
            const ft = raw.score?.ft;
            const ht = raw.score?.ht;

            let result: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' | null = null;
            let status: 'FINISHED' | 'SCHEDULED' = 'SCHEDULED';

            if (ft && ft.length === 2) {
              status = 'FINISHED';
              if (ft[0] > ft[1]) result = 'HOME_WIN';
              else if (ft[0] < ft[1]) result = 'AWAY_WIN';
              else result = 'DRAW';
            }

            results.push({
              externalId: `of_${competitionCode}_${seasonCode}_${i + 1}`,
              providerSource: this.name,
              competitionCode,
              seasonCode,
              round: raw.round || 'Regular Season',
              kickoffTime: new Date(`${raw.date}T15:00:00Z`),
              homeTeamRawName: raw.team1,
              awayTeamRawName: raw.team2,
              status,
              homeScoreHalfTime: ht ? ht[0] : null,
              awayScoreHalfTime: ht ? ht[1] : null,
              homeScoreFullTime: ft ? ft[0] : null,
              awayScoreFullTime: ft ? ft[1] : null,
              result,
              metadata: { source: 'openfootball' },
            });
          }
        }
      } else {
        console.warn(`[${this.name}] Remote feed HTTP ${response.status} for ${relativePath}; returning empty set without fallback fabrication.`);
      }
    } catch (error: any) {
      console.warn(`[${this.name}] Remote feed unavailable for ${relativePath}: ${error?.message || 'Unknown error'}`);
    }

    if (results.length > 0) {
      this.setCached(cacheKey, results);
    }
    return results;
  }

  async fetchMatchStats(_matchExternalId: string): Promise<NormalizedMatchStats | null> {
    return null;
  }
}
