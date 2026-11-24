import { IFootballDataProvider, NormalizedCompetition, NormalizedMatch, NormalizedMatchStats, ProviderHealth } from '../contracts/provider.interface.ts';
import { ErrorReportingService } from '../../services/errorReporting.ts';

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
    const method = options?.method || 'GET';

    while (attempt < maxRetries) {
      try {
        const requestOptions: RequestInit = {
          ...options,
          signal: options?.signal ?? AbortSignal.timeout(10000),
        };
        const response = await fetch(url, requestOptions);
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

        if (response.status >= 400) {
          ErrorReportingService.reportApiFailure({
            source: `Provider:${this.name}`,
            endpoint: url,
            method,
            statusCode: response.status,
            error: new Error(`Upstream HTTP ${response.status} ${response.statusText || ''}`.trim()),
          }).catch(() => {});
        }

        return response;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) {
          ErrorReportingService.reportApiFailure({
            source: `Provider:${this.name}`,
            endpoint: url,
            method,
            statusCode: 0,
            error: err,
            context: `Exhausted ${maxRetries} retry attempts`,
          }).catch(() => {});
          throw err;
        }
        await new Promise((res) => setTimeout(res, delay));
        delay *= 2;
      }
    }

    const exhaustErr = new Error(`[${this.name}] Failed to fetch from ${url} after ${maxRetries} retries`);
    ErrorReportingService.reportApiFailure({
      source: `Provider:${this.name}`,
      endpoint: url,
      method,
      statusCode: 0,
      error: exhaustErr,
    }).catch(() => {});
    throw exhaustErr;
  }

  abstract checkHealth(): Promise<ProviderHealth>;
  abstract fetchCompetitions(): Promise<NormalizedCompetition[]>;
  abstract fetchMatches(competitionCode: string, seasonCode?: string): Promise<NormalizedMatch[]>;
  abstract fetchMatchStats?(matchExternalId: string): Promise<NormalizedMatchStats | null>;
}
