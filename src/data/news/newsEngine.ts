export interface FootballNewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  category: string;
  publishedAt: string;
  retrievedAt: string;
  url: string;
  imageUrl?: string;
}

export class NewsEngine {
  private static cache: {
    timestamp: number;
    articles: FootballNewsArticle[];
    activeSources: string[];
    failedSources: Array<{ source: string; reason: string }>;
  } | null = null;

  private static readonly CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

  public static async checkHealth(): Promise<{
    status: 'OPERATIONAL' | 'DEGRADED' | 'OFFLINE';
    activeSources: string[];
    failedSources: Array<{ source: string; reason: string }>;
    articlesCached: number;
  }> {
    const res = await this.getFootballNews('ALL');
    const activeCount = res.activeSources.length;
    const status =
      activeCount === 0 ? 'OFFLINE' : res.failedSources.length > 0 ? 'DEGRADED' : 'OPERATIONAL';
    return {
      status,
      activeSources: res.activeSources,
      failedSources: res.failedSources,
      articlesCached: res.articles.length,
    };
  }

  /**
   * Fetch verified real-time football news from official football feeds
   */
  public static async getFootballNews(category?: string): Promise<{
    articles: FootballNewsArticle[];
    sourceCount: number;
    activeSources: string[];
    failedSources: Array<{ source: string; reason: string }>;
    lastRetrieved: string;
    isFresh: boolean;
  }> {
    const now = Date.now();
    if (this.cache && now - this.cache.timestamp < this.CACHE_TTL_MS) {
      let filtered = this.cache.articles;
      if (category && category !== 'ALL') {
        filtered = filtered.filter(
          (a) => a.category.toLowerCase() === category.toLowerCase()
        );
      }
      return {
        articles: filtered,
        sourceCount: this.cache.activeSources.length,
        activeSources: this.cache.activeSources,
        failedSources: this.cache.failedSources,
        lastRetrieved: new Date(this.cache.timestamp).toISOString(),
        isFresh: this.cache.activeSources.length > 0,
      };
    }

    const retrievedAt = new Date().toISOString();
    const articles: FootballNewsArticle[] = [];
    const activeSources: string[] = [];
    const failedSources: Array<{ source: string; reason: string }> = [];

    // Real RSS feeds that return XML
    const feedConfigs = [
      {
        source: 'BBC Sport Football',
        url: 'https://feeds.bbci.co.uk/sport/football/rss.xml',
        category: 'Global & Premier League',
      },
      {
        source: 'Sky Sports Football',
        url: 'https://www.skysports.com/rss/12040',
        category: 'European Leagues',
      },
      {
        source: 'The Guardian Football',
        url: 'https://www.theguardian.com/football/rss',
        category: 'Analysis & Tactical',
      },
    ];

    for (const feed of feedConfigs) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4000);
        const res = await fetch(feed.url, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'PitchIntel-Football-Intelligence/1.0',
            Accept: 'application/rss+xml, application/xml, text/xml',
          },
        });
        clearTimeout(timeout);

        if (res.ok) {
          activeSources.push(feed.source);
          const xmlText = await res.text();
          // Extract items using regex to avoid external xml parser dependency
          const itemRegex = /<item>([\s\S]*?)<\/item>/g;
          let match: RegExpExecArray | null;
          let count = 0;

          while ((match = itemRegex.exec(xmlText)) !== null && count < 8) {
            const itemContent = match[1];
            const titleMatch = /<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/.exec(itemContent);
            const linkMatch = /<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/.exec(itemContent);
            const descMatch = /<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/.exec(itemContent);
            const dateMatch = /<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/.exec(itemContent);

            if (titleMatch && linkMatch) {
              const cleanTitle = titleMatch[1]
                .replace(/<[^>]+>/g, '')
                .replace(/&amp;/g, '&')
                .replace(/&quot;/g, '"')
                .replace(/&#39;/g, "'")
                .trim();
              const cleanLink = linkMatch[1].trim();
              const cleanDesc = descMatch
                ? descMatch[1]
                    .replace(/<[^>]+>/g, '')
                    .replace(/&amp;/g, '&')
                    .replace(/&quot;/g, '"')
                    .replace(/&#39;/g, "'")
                    .trim()
                : 'Latest verified football intelligence update.';

              let pubDate = retrievedAt;
              if (dateMatch && dateMatch[1]) {
                try {
                  const d = new Date(dateMatch[1]);
                  if (!isNaN(d.getTime())) {
                    pubDate = d.toISOString();
                  }
                } catch {
                  pubDate = retrievedAt;
                }
              }

              if (cleanTitle && cleanLink) {
                articles.push({
                  id: `news_${feed.source.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}_${count}`,
                  title: cleanTitle,
                  summary: cleanDesc,
                  source: feed.source,
                  category: feed.category,
                  publishedAt: pubDate,
                  retrievedAt,
                  url: cleanLink,
                });
                count++;
              }
            }
          }
        } else {
          failedSources.push({ source: feed.source, reason: `HTTP ${res.status}` });
        }
      } catch (err: any) {
        const msg = err?.message || 'Request failed';
        failedSources.push({ source: feed.source, reason: msg });
        console.warn(`[NewsEngine] RSS fetch failed for ${feed.source}:`, msg);
      }
    }

    // Also pull verified JSON dispatches from ESPN Global Soccer News
    try {
      const espnRes = await fetch('https://site.api.espn.com/apis/site/v2/sports/soccer/all/news', {
        signal: AbortSignal.timeout(4000),
        headers: {
          'User-Agent': 'PitchIntel-Football-Intelligence/1.0',
          Accept: 'application/json',
        },
      });
      if (espnRes.ok) {
        activeSources.push('ESPN Global Soccer');
        const json = await espnRes.json();
        const espnArticles: any[] = Array.isArray(json?.articles) ? json.articles : [];
        for (let i = 0; i < Math.min(8, espnArticles.length); i++) {
          const item = espnArticles[i];
          const headline = String(item?.headline || '').trim();
          const link = String(item?.links?.web?.href || '').trim();
          if (!headline || !link) continue;
          articles.push({
            id: `news_espn_global_${item.dataSourceIdentifier || i}_${Date.now()}`,
            title: headline,
            summary: String(item?.description || 'Latest verified global football intelligence dispatch.').trim(),
            source: 'ESPN Global Soccer',
            category: 'Global & Premier League',
            publishedAt: item?.published ? new Date(item.published).toISOString() : retrievedAt,
            retrievedAt,
            url: link,
            imageUrl: Array.isArray(item?.images) && item.images[0]?.url ? item.images[0].url : undefined,
          });
        }
      } else {
        failedSources.push({ source: 'ESPN Global Soccer', reason: `HTTP ${espnRes.status}` });
      }
    } catch (err: any) {
      failedSources.push({ source: 'ESPN Global Soccer', reason: err?.message || 'Request failed' });
    }

    // Deduplicate by title
    const seen = new Set<string>();
    const deduped = articles.filter((a) => {
      const key = a.title.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (activeSources.length > 0) {
      this.cache = {
        timestamp: now,
        articles: deduped,
        activeSources,
        failedSources,
      };
    }

    let result = deduped;
    if (category && category !== 'ALL') {
      result = result.filter(
        (a) => a.category.toLowerCase() === category.toLowerCase()
      );
    }

    return {
      articles: result,
      sourceCount: activeSources.length,
      activeSources,
      failedSources,
      lastRetrieved: retrievedAt,
      isFresh: activeSources.length > 0,
    };
  }
}
