import { and, desc, eq, ilike, sql, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { coverageInventory } from '../../db/schema.ts';

export interface GlobalCoverageSummary {
  totalMatches: number;
  completedMatches: number;
  upcomingMatches: number;
  countriesCount: number;
  competitionsCount: number;
  seasonsCount: number;
  earliestMatchDate: string | null;
  latestMatchDate: string | null;
  scoresAvailableCount: number;
  detailedStatsCount: number;
  xgAvailableCount: number;
  oddsAvailableCount: number;
  lineupsAvailableCount: number;
  scoresPercentage: number;
  detailedStatsPercentage: number;
  xgPercentage: number;
  oddsPercentage: number;
  providersBreakdown: Array<{
    providerSource: string;
    matchesCount: number;
    competitionsCount: number;
    earliest: string | null;
    latest: string | null;
  }>;
  competitionsBreakdown: Array<{
    competitionCode: string;
    competitionName: string;
    country: string;
    matchesCount: number;
    earliest: string | null;
    latest: string | null;
  }>;
}

export class CoverageInventoryManager {
  /**
   * Calculate global coverage summary directly from PostgreSQL
   */
  public static async getGlobalCoverageSummary(): Promise<GlobalCoverageSummary> {
    // 1. Overall counts and dates
    const overallQuery = await db.execute<{
      total_matches: string;
      completed_matches: string;
      upcoming_matches: string;
      countries_count: string;
      competitions_count: string;
      seasons_count: string;
      earliest_date: string;
      latest_date: string;
      scores_count: string;
    }>(sql`
      SELECT 
        COUNT(*)::text as total_matches,
        COUNT(CASE WHEN m.status = 'FINISHED' THEN 1 END)::text as completed_matches,
        COUNT(CASE WHEN m.status = 'SCHEDULED' THEN 1 END)::text as upcoming_matches,
        COUNT(DISTINCT c.country)::text as countries_count,
        COUNT(DISTINCT m.competition_id)::text as competitions_count,
        COUNT(DISTINCT m.season_id)::text as seasons_count,
        MIN(m.kickoff_time)::text as earliest_date,
        MAX(m.kickoff_time)::text as latest_date,
        COUNT(CASE WHEN m.home_score_full_time IS NOT NULL AND m.away_score_full_time IS NOT NULL THEN 1 END)::text as scores_count
      FROM matches m
      JOIN competitions c ON m.competition_id = c.id
    `);

    // 2. Detailed statistics & xG counts
    const statsQuery = await db.execute<{
      stats_count: string;
      xg_count: string;
    }>(sql`
      SELECT 
        COUNT(DISTINCT match_id)::text as stats_count,
        COUNT(DISTINCT CASE WHEN xg IS NOT NULL THEN match_id END)::text as xg_count
      FROM match_statistics
    `);

    // 3. Historical odds counts
    const oddsQuery = await db.execute<{ odds_count: string }>(sql`
      SELECT COUNT(DISTINCT match_id)::text as odds_count FROM historical_odds
    `);

    // 4. Lineups counts
    const lineupsQuery = await db.execute<{ lineups_count: string }>(sql`
      SELECT COUNT(DISTINCT match_id)::text as lineups_count FROM lineups
    `);

    // 5. Providers breakdown
    const providersQuery = await db.execute<{
      provider_source: string;
      matches_count: string;
      competitions_count: string;
      earliest: string;
      latest: string;
    }>(sql`
      SELECT 
        m.provider_source,
        COUNT(*)::text as matches_count,
        COUNT(DISTINCT m.competition_id)::text as competitions_count,
        MIN(m.kickoff_time)::text as earliest,
        MAX(m.kickoff_time)::text as latest
      FROM matches m
      GROUP BY m.provider_source
      ORDER BY COUNT(*) DESC
    `);

    // 6. Competitions breakdown
    const compsQuery = await db.execute<{
      code: string;
      name: string;
      country: string;
      matches_count: string;
      earliest: string;
      latest: string;
    }>(sql`
      SELECT 
        c.code,
        c.name,
        c.country,
        COUNT(m.id)::text as matches_count,
        MIN(m.kickoff_time)::text as earliest,
        MAX(m.kickoff_time)::text as latest
      FROM matches m
      JOIN competitions c ON m.competition_id = c.id
      GROUP BY c.code, c.name, c.country
      ORDER BY COUNT(m.id) DESC
    `);

    const row = overallQuery.rows[0] || {} as any;
    const statsRow = statsQuery.rows[0] || {} as any;
    const oddsRow = oddsQuery.rows[0] || {} as any;
    const lineupsRow = lineupsQuery.rows[0] || {} as any;

    const total = parseInt(row.total_matches || '0', 10);
    const completed = parseInt(row.completed_matches || '0', 10);
    const upcoming = parseInt(row.upcoming_matches || '0', 10);
    const scoresCount = parseInt(row.scores_count || '0', 10);
    const statsCount = parseInt(statsRow.stats_count || '0', 10);
    const xgCount = parseInt(statsRow.xg_count || '0', 10);
    const oddsCount = parseInt(oddsRow.odds_count || '0', 10);
    const lineupsCount = parseInt(lineupsRow.lineups_count || '0', 10);

    return {
      totalMatches: total,
      completedMatches: completed,
      upcomingMatches: upcoming,
      countriesCount: parseInt(row.countries_count || '0', 10),
      competitionsCount: parseInt(row.competitions_count || '0', 10),
      seasonsCount: parseInt(row.seasons_count || '0', 10),
      earliestMatchDate: row.earliest_date || null,
      latestMatchDate: row.latest_date || null,
      scoresAvailableCount: scoresCount,
      detailedStatsCount: statsCount,
      xgAvailableCount: xgCount,
      oddsAvailableCount: oddsCount,
      lineupsAvailableCount: lineupsCount,
      scoresPercentage: total > 0 ? Number(((scoresCount / total) * 100).toFixed(1)) : 0,
      detailedStatsPercentage: total > 0 ? Number(((statsCount / total) * 100).toFixed(1)) : 0,
      xgPercentage: total > 0 ? Number(((xgCount / total) * 100).toFixed(1)) : 0,
      oddsPercentage: total > 0 ? Number(((oddsCount / total) * 100).toFixed(1)) : 0,
      providersBreakdown: providersQuery.rows.map((p) => ({
        providerSource: p.provider_source,
        matchesCount: parseInt(p.matches_count || '0', 10),
        competitionsCount: parseInt(p.competitions_count || '0', 10),
        earliest: p.earliest || null,
        latest: p.latest || null,
      })),
      competitionsBreakdown: compsQuery.rows.map((c) => ({
        competitionCode: c.code,
        competitionName: c.name,
        country: c.country,
        matchesCount: parseInt(c.matches_count || '0', 10),
        earliest: c.earliest || null,
        latest: c.latest || null,
      })),
    };
  }

  /**
   * Refreshes the persistent coverage_inventory table with current database aggregations
   */
  public static async refreshCoverageInventory(): Promise<number> {
    const rawInventory = await db.execute<{
      provider_source: string;
      country: string;
      competition_code: string;
      competition_name: string;
      competition_type: string;
      season_code: string;
      earliest_date: string;
      latest_date: string;
      matches_imported: string;
      has_scores: boolean;
      has_stats: boolean;
      has_xg: boolean;
      has_odds: boolean;
      has_lineups: boolean;
    }>(sql`
      SELECT 
        m.provider_source,
        c.country,
        c.code as competition_code,
        c.name as competition_name,
        c.type as competition_type,
        s.season_code,
        MIN(m.kickoff_time)::text as earliest_date,
        MAX(m.kickoff_time)::text as latest_date,
        COUNT(m.id)::text as matches_imported,
        BOOL_OR(m.home_score_full_time IS NOT NULL) as has_scores,
        BOOL_OR(ms.id IS NOT NULL) as has_stats,
        BOOL_OR(ms.xg IS NOT NULL) as has_xg,
        BOOL_OR(ho.id IS NOT NULL) as has_odds,
        BOOL_OR(l.id IS NOT NULL) as has_lineups
      FROM matches m
      JOIN competitions c ON m.competition_id = c.id
      JOIN seasons s ON m.season_id = s.id
      LEFT JOIN match_statistics ms ON ms.match_id = m.id
      LEFT JOIN historical_odds ho ON ho.match_id = m.id
      LEFT JOIN lineups l ON l.match_id = m.id
      GROUP BY m.provider_source, c.country, c.code, c.name, c.type, s.season_code
    `);

    let upserted = 0;
    for (const row of rawInventory.rows) {
      const imported = parseInt(row.matches_imported || '0', 10);
      await db
        .insert(coverageInventory)
        .values({
          providerSource: row.provider_source,
          country: row.country,
          competitionCode: row.competition_code,
          competitionName: row.competition_name,
          competitionType: row.competition_type,
          seasonCode: row.season_code,
          earliestMatchDate: row.earliest_date ? new Date(row.earliest_date) : null,
          latestMatchDate: row.latest_date ? new Date(row.latest_date) : null,
          matchesDiscovered: imported,
          matchesImported: imported,
          matchesMissing: 0,
          hasScores: Boolean(row.has_scores),
          hasStats: Boolean(row.has_stats),
          hasXg: Boolean(row.has_xg),
          hasOdds: Boolean(row.has_odds),
          hasLineups: Boolean(row.has_lineups),
          accessRestrictions: 'NONE',
          syncStatus: 'VERIFIED',
          lastSyncAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            coverageInventory.providerSource,
            coverageInventory.competitionCode,
            coverageInventory.seasonCode,
          ],
          set: {
            earliestMatchDate: row.earliest_date ? new Date(row.earliest_date) : null,
            latestMatchDate: row.latest_date ? new Date(row.latest_date) : null,
            matchesImported: imported,
            matchesDiscovered: imported,
            hasScores: Boolean(row.has_scores),
            hasStats: Boolean(row.has_stats),
            hasXg: Boolean(row.has_xg),
            hasOdds: Boolean(row.has_odds),
            hasLineups: Boolean(row.has_lineups),
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          },
        });
      upserted++;
    }

    return upserted;
  }

  /**
   * Retrieves all coverage inventory items with optional filters
   */
  public static async getInventoryList(filters?: {
    provider?: string;
    country?: string;
    competition?: string;
    season?: string;
  }) {
    const conditions: SQL[] = [];
    if (filters?.provider && filters.provider.toUpperCase() !== 'ALL') {
      conditions.push(eq(coverageInventory.providerSource, filters.provider));
    }
    if (filters?.country && filters.country.toUpperCase() !== 'ALL') {
      conditions.push(ilike(coverageInventory.country, filters.country));
    }
    if (filters?.competition && filters.competition.toUpperCase() !== 'ALL') {
      conditions.push(ilike(coverageInventory.competitionCode, filters.competition));
    }
    if (filters?.season && filters.season.toUpperCase() !== 'ALL') {
      conditions.push(eq(coverageInventory.seasonCode, filters.season));
    }

    return await db
      .select()
      .from(coverageInventory)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(coverageInventory.seasonCode), coverageInventory.country, coverageInventory.competitionCode);
  }
}
