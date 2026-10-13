import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  competitions,
  matches,
  seasons,
  teams,
  teamAliases,
  ingestionLogs,
} from '../../db/schema.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';
import { IdentityResolver } from '../identity/resolver.ts';
import { FootballDataProvider } from '../providers/footballDataProvider.ts';
import { ApiFootballProvider } from '../providers/apiFootballProvider.ts';

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

interface OpenFootballFeed {
  name: string;
  matches: OpenFootballRawMatch[];
}

export class ComprehensiveHistoryIngestion {
  private static readonly OPEN_FOOTBALL_BASE =
    'https://raw.githubusercontent.com/openfootball/football.json/master';

  // OpenFootball feed catalog: [compCode, country, seasonCode, fileSubpath]
  private static readonly OPEN_FOOTBALL_SOURCES: Array<{
    compCode: string;
    country: string;
    seasonCode: string;
    subpath: string;
  }> = [
    // Premier League (England)
    { compCode: 'PL', country: 'England', seasonCode: '2023-2024', subpath: '2023-24/en.1.json' },
    { compCode: 'PL', country: 'England', seasonCode: '2022-2023', subpath: '2022-23/en.1.json' },
    { compCode: 'PL', country: 'England', seasonCode: '2021-2022', subpath: '2021-22/en.1.json' },
    { compCode: 'PL', country: 'England', seasonCode: '2020-2021', subpath: '2020-21/en.1.json' },
    { compCode: 'PL', country: 'England', seasonCode: '2019-2020', subpath: '2019-20/en.1.json' },
    { compCode: 'PL', country: 'England', seasonCode: '2018-2019', subpath: '2018-19/en.1.json' },

    // La Liga (Spain)
    { compCode: 'PD', country: 'Spain', seasonCode: '2023-2024', subpath: '2023-24/es.1.json' },
    { compCode: 'PD', country: 'Spain', seasonCode: '2022-2023', subpath: '2022-23/es.1.json' },
    { compCode: 'PD', country: 'Spain', seasonCode: '2021-2022', subpath: '2021-22/es.1.json' },
    { compCode: 'PD', country: 'Spain', seasonCode: '2020-2021', subpath: '2020-21/es.1.json' },

    // Serie A (Italy)
    { compCode: 'SA', country: 'Italy', seasonCode: '2023-2024', subpath: '2023-24/it.1.json' },
    { compCode: 'SA', country: 'Italy', seasonCode: '2022-2023', subpath: '2022-23/it.1.json' },
    { compCode: 'SA', country: 'Italy', seasonCode: '2021-2022', subpath: '2021-22/it.1.json' },
    { compCode: 'SA', country: 'Italy', seasonCode: '2020-2021', subpath: '2020-21/it.1.json' },

    // Bundesliga (Germany)
    { compCode: 'BL1', country: 'Germany', seasonCode: '2023-2024', subpath: '2023-24/de.1.json' },
    { compCode: 'BL1', country: 'Germany', seasonCode: '2022-2023', subpath: '2022-23/de.1.json' },
    { compCode: 'BL1', country: 'Germany', seasonCode: '2021-2022', subpath: '2021-22/de.1.json' },
    { compCode: 'BL1', country: 'Germany', seasonCode: '2020-2021', subpath: '2020-21/de.1.json' },

    // Ligue 1 (France)
    { compCode: 'FL1', country: 'France', seasonCode: '2023-2024', subpath: '2023-24/fr.1.json' },
    { compCode: 'FL1', country: 'France', seasonCode: '2022-2023', subpath: '2022-23/fr.1.json' },
    { compCode: 'FL1', country: 'France', seasonCode: '2021-2022', subpath: '2021-22/fr.1.json' },
    { compCode: 'FL1', country: 'France', seasonCode: '2020-2021', subpath: '2020-21/fr.1.json' },

    // Eredivisie (Netherlands)
    { compCode: 'DED', country: 'Netherlands', seasonCode: '2023-2024', subpath: '2023-24/nl.1.json' },
    { compCode: 'DED', country: 'Netherlands', seasonCode: '2022-2023', subpath: '2022-23/nl.1.json' },
    { compCode: 'DED', country: 'Netherlands', seasonCode: '2021-2022', subpath: '2021-22/nl.1.json' },

    // Primeira Liga (Portugal)
    { compCode: 'PPL', country: 'Portugal', seasonCode: '2023-2024', subpath: '2023-24/pt.1.json' },
    { compCode: 'PPL', country: 'Portugal', seasonCode: '2022-2023', subpath: '2022-23/pt.1.json' },
    { compCode: 'PPL', country: 'Portugal', seasonCode: '2021-2022', subpath: '2021-22/pt.1.json' },
  ];

  /**
   * Run the complete mass match history ingestion across all leagues and historical seasons
   */
  public static async ingestAllHistoricalMatches(progressCb?: (msg: string) => void): Promise<{
    totalProcessed: number;
    totalInserted: number;
    totalUpdated: number;
    errors: string[];
  }> {
    const report = {
      totalProcessed: 0,
      totalInserted: 0,
      totalUpdated: 0,
      errors: [] as string[],
    };

    const notify = (msg: string) => {
      console.log(`[ComprehensiveHistory] ${msg}`);
      if (progressCb) progressCb(msg);
    };

    notify('Initializing base canonical entities and seeding aliases...');
    // 1. Ensure all Canonical Competitions are registered in database
    for (const comp of CANONICAL_COMPETITIONS) {
      await db
        .insert(competitions)
        .values({
          code: comp.code,
          name: comp.name,
          country: comp.country,
          tier: comp.tier,
          type: comp.type,
          emblem: comp.emblem,
        })
        .onConflictDoNothing();
    }

    await IdentityResolver.seedCanonicalEntities();

    // Cache competitions
    const allComps = await db.select().from(competitions);
    const compMap = new Map<string, typeof competitions.$inferSelect>();
    for (const c of allComps) compMap.set(c.code, c);

    // Helper to get or create season
    async function getOrCreateSeason(compDbId: number, seasonCode: string) {
      const [existing] = await db
        .select()
        .from(seasons)
        .where(and(eq(seasons.competitionId, compDbId), eq(seasons.seasonCode, seasonCode)))
        .limit(1);

      if (existing) return existing;

      const [yStart, yEnd] = seasonCode.includes('-')
        ? seasonCode.split('-').map((y) => parseInt(y, 10))
        : [parseInt(seasonCode, 10), parseInt(seasonCode, 10)];

      const isCurrent = seasonCode === '2024-2025' || seasonCode === '2026';

      const [inserted] = await db
        .insert(seasons)
        .values({
          competitionId: compDbId,
          seasonCode,
          yearStart: isNaN(yStart) ? 2024 : yStart,
          yearEnd: isNaN(yEnd) ? 2025 : yEnd,
          isCurrent,
        })
        .returning();

      return inserted;
    }

    // =========================================================================
    // STEP 1: Ingest High-Speed OpenFootball Historical Archives (2018 - 2024)
    // =========================================================================
    notify(`Beginning OpenFootball archive ingestion (${this.OPEN_FOOTBALL_SOURCES.length} feed seasons)...`);

    for (const source of this.OPEN_FOOTBALL_SOURCES) {
      const compRecord = compMap.get(source.compCode);
      if (!compRecord) continue;

      const seasonRecord = await getOrCreateSeason(compRecord.id, source.seasonCode);
      const url = `${this.OPEN_FOOTBALL_BASE}/${source.subpath}`;

      try {
        notify(`Fetching ${compRecord.name} (${source.seasonCode}) from OpenFootball CDN...`);
        const res = await fetch(url);
        if (!res.ok) {
          report.errors.push(`HTTP ${res.status} for ${source.subpath}`);
          continue;
        }

        const feed: OpenFootballFeed = await res.json();
        if (!feed.matches || !Array.isArray(feed.matches)) continue;

        let insertedForSeason = 0;
        let updatedForSeason = 0;

        for (let i = 0; i < feed.matches.length; i++) {
          const raw = feed.matches[i];
          report.totalProcessed++;

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

          // Resolve home & away clubs
          const homeTeam = await IdentityResolver.resolveTeam(raw.team1, source.country, 'open-football');
          const awayTeam = await IdentityResolver.resolveTeam(raw.team2, source.country, 'open-football');

          const externalId = `of_${source.compCode}_${source.seasonCode}_${i + 1}`;
          const kickoff = new Date(`${raw.date}T15:00:00Z`);

          // Check if match already recorded
          const [existing] = await db
            .select({ id: matches.id })
            .from(matches)
            .where(and(eq(matches.providerSource, 'open-football'), eq(matches.externalId, externalId)))
            .limit(1);

          if (existing) {
            await db
              .update(matches)
              .set({
                status,
                homeScoreFullTime: ft ? ft[0] : null,
                awayScoreFullTime: ft ? ft[1] : null,
                homeScoreHalfTime: ht ? ht[0] : null,
                awayScoreHalfTime: ht ? ht[1] : null,
                result,
                updatedAt: new Date(),
              })
              .where(eq(matches.id, existing.id));
            updatedForSeason++;
            report.totalUpdated++;
          } else {
            await db.insert(matches).values({
              externalId,
              providerSource: 'open-football',
              competitionId: compRecord.id,
              seasonId: seasonRecord.id,
              round: raw.round || 'Regular Season',
              kickoffTime: kickoff,
              homeTeamId: homeTeam.id,
              awayTeamId: awayTeam.id,
              status,
              homeScoreFullTime: ft ? ft[0] : null,
              awayScoreFullTime: ft ? ft[1] : null,
              homeScoreHalfTime: ht ? ht[0] : null,
              awayScoreHalfTime: ht ? ht[1] : null,
              result,
            });
            insertedForSeason++;
            report.totalInserted++;
          }
        }

        notify(`Ingested ${compRecord.name} ${source.seasonCode}: ${insertedForSeason} new, ${updatedForSeason} updated.`);
      } catch (err: any) {
        notify(`Error on ${source.subpath}: ${err.message}`);
        report.errors.push(`${source.subpath}: ${err.message}`);
      }
    }

    // =========================================================================
    // STEP 2: Ingest Current 2024-2025 Matches from Football-Data.org
    // =========================================================================
    if (process.env.FOOTBALL_DATA_API_KEY) {
      notify('Starting Football-Data.org API v4 direct ingestion for 2024-2025...');
      const fd = new FootballDataProvider();
      const fdLeagues = ['PL', 'PD', 'SA', 'BL1', 'FL1', 'DED', 'PPL', 'BSA', 'CL'];

      for (const code of fdLeagues) {
        const compRecord = compMap.get(code);
        if (!compRecord) continue;

        const seasonRecord = await getOrCreateSeason(compRecord.id, '2024-2025');

        try {
          notify(`Fetching live 2024-2025 matches for ${compRecord.name} (${code})...`);
          const rawMatches = await fd.fetchMatches(code, '2024-2025');
          notify(`Received ${rawMatches.length} fixtures for ${compRecord.name}`);

          for (const m of rawMatches) {
            report.totalProcessed++;

            const homeTeam = await IdentityResolver.resolveTeam(m.homeTeamRawName, compRecord.country, 'football-data-org');
            const awayTeam = await IdentityResolver.resolveTeam(m.awayTeamRawName, compRecord.country, 'football-data-org');

            const [existing] = await db
              .select({ id: matches.id })
              .from(matches)
              .where(and(eq(matches.providerSource, 'football-data-org'), eq(matches.externalId, m.externalId)))
              .limit(1);

            if (existing) {
              await db
                .update(matches)
                .set({
                  status: m.status,
                  round: m.round,
                  matchday: m.matchday,
                  kickoffTime: m.kickoffTime,
                  venue: m.venue,
                  homeScoreFullTime: m.homeScoreFullTime,
                  awayScoreFullTime: m.awayScoreFullTime,
                  homeScoreHalfTime: m.homeScoreHalfTime,
                  awayScoreHalfTime: m.awayScoreHalfTime,
                  result: m.result,
                  updatedAt: new Date(),
                })
                .where(eq(matches.id, existing.id));
              report.totalUpdated++;
            } else {
              await db.insert(matches).values({
                externalId: m.externalId,
                providerSource: 'football-data-org',
                competitionId: compRecord.id,
                seasonId: seasonRecord.id,
                round: m.round,
                matchday: m.matchday,
                kickoffTime: m.kickoffTime,
                homeTeamId: homeTeam.id,
                awayTeamId: awayTeam.id,
                venue: m.venue,
                referee: m.referee,
                status: m.status,
                homeScoreFullTime: m.homeScoreFullTime,
                awayScoreFullTime: m.awayScoreFullTime,
                homeScoreHalfTime: m.homeScoreHalfTime,
                awayScoreHalfTime: m.awayScoreHalfTime,
                result: m.result,
              });
              report.totalInserted++;
            }
          }

          // Respect free tier rate limit: wait 6.2 seconds between Football-Data.org calls
          await new Promise((resolve) => setTimeout(resolve, 6200));
        } catch (e: any) {
          notify(`Football-Data.org fetch failed for ${code}: ${e.message}`);
          report.errors.push(`FD ${code}: ${e.message}`);
        }
      }
    }

    // Log the comprehensive mass sync to ingestion_logs
    await db.insert(ingestionLogs).values({
      providerSource: 'comprehensive-mass-history',
      status: report.errors.length > 0 ? 'PARTIAL_SUCCESS' : 'SUCCESS',
      recordsProcessed: report.totalProcessed,
      recordsInserted: report.totalInserted,
      recordsUpdated: report.totalUpdated,
      errors: report.errors.length > 0 ? report.errors : null,
    });

    notify(`Comprehensive ingestion complete! Inserted: ${report.totalInserted}, Updated: ${report.totalUpdated}, Total processed: ${report.totalProcessed}`);
    return report;
  }
}
