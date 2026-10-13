import { IFootballDataProvider, NormalizedCompetition, NormalizedMatch, NormalizedMatchStats, ProviderHealth } from '../contracts/provider.interface.ts';

export abstract class BaseFootballDataProvider implements IFootballDataProvider {
  abstract readonly name: string;
  protected cache = new Map<string, { data: any; expiry: number }>();
  protected cacheTtlMs: number;

  constructor(cacheTtlMs: number = 5 * 60 * 1000) {
    this.cacheTtlMs = cacheTtlMs;
  }

  protected getCached<T>(key: string): T | null {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.data as T;
  }

  protected setCached<T>(key: string, data: T, customTtlMs?: number): void {
    this.cache.set(key, {
      data,
      expiry: Date.now() + (customTtlMs ?? this.cacheTtlMs),
    });
  }

  protected async fetchWithRetry(url: string, options?: RequestInit, maxRetries = 3): Promise<Response> {
    let attempt = 0;
    let delay = 500;

    while (attempt < maxRetries) {
      try {
        const response = await fetch(url, options);
        if (response.ok) return response;

        // If rate limited, wait longer
        if (response.status === 429) {
          const retryAfter = response.headers.get('Retry-After');
          const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay * 2;
          console.warn(`[${this.name}] Rate limited (429). Retrying in ${waitTime}ms...`);
          await new Promise((res) => setTimeout(res, waitTime));
          attempt++;
          continue;
        }

        if (response.status >= 500) {
          throw new Error(`Server returned ${response.status}`);
        }

        return response;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) throw err;
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }

    throw new Error(`[${this.name}] Failed to fetch from ${url} after ${maxRetries} retries`);
  }

  abstract checkHealth(): Promise<ProviderHealth>;
  abstract fetchCompetitions(): Promise<NormalizedCompetition[]>;
  abstract fetchMatches(competitionCode: string, seasonCode?: string): Promise<NormalizedMatch[]>;
  abstract fetchMatchStats?(matchExternalId: string): Promise<NormalizedMatchStats | null>;
}
