import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { matches, ingestionLogs } from '../../db/schema.ts';
import { NormalizedMatch } from '../contracts/provider.interface.ts';

export interface ReconciliationReport {
  matchesEvaluated: number;
  matchesLinked: number;
  conflictsDetected: number;
  recordsUpdated: number;
  details: string[];
}

export interface ReconcileCandidate {
  primaryMatchId: number;
  incomingMatch: NormalizedMatch;
  isSameMatch: boolean;
  scoreMatch: boolean;
  discrepancies: string[];
}

/**
 * PitchIntel Match Deduplication & Source Reconciliation Engine
 * Responsibilities:
 * - Resolve multi-provider match identity (e.g. Football-Data.org vs OpenFootball vs API-Football)
 * - Apply explicit source precedence: Authenticated Direct Feed (Football-Data.org / API-Football) > OpenFootball Archive
 * - Safeguard existing valid scores from being overwritten by null or empty responses
 * - Preserve secondary provider IDs and provenance in matches.secondary_provider_id and metadata
 */
export class MatchReconciler {
  /**
   * Source precedence rank (higher is more authoritative for live/detailed match telemetry)
   */
  private static readonly SOURCE_PRECEDENCE: Record<string, number> = {
    'football-data-org': 100,
    'api-football-v3': 90,
    'open-football': 50,
    'live-engine': 80,
    'UPCOMING_ENGINE': 40,
    'prediction-engine': 30,
  };

  /**
   * Check if incoming match matches an existing database match by competition, date window, and teams
   */
  public static async findExistingMatch(
    competitionId: number,
    homeTeamId: number,
    awayTeamId: number,
    kickoffTime: Date
  ): Promise<typeof matches.$inferSelect | null> {
    // 24-hour window matching around kickoff time to handle minor rescheduling/timezone variances
    const windowStart = new Date(kickoffTime.getTime() - 24 * 60 * 60 * 1000);
    const windowEnd = new Date(kickoffTime.getTime() + 24 * 60 * 60 * 1000);

    const candidates = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.competitionId, competitionId),
          eq(matches.homeTeamId, homeTeamId),
          eq(matches.awayTeamId, awayTeamId)
        )
      );

    for (const cand of candidates) {
      const candTime = new Date(cand.kickoffTime).getTime();
      if (candTime >= windowStart.getTime() && candTime <= windowEnd.getTime()) {
        return cand;
      }
    }

    return null;
  }

  /**
   * Reconcile an incoming normalized match against an existing record in the database
   */
  public static async reconcileMatchRecord(
    existing: typeof matches.$inferSelect,
    incoming: NormalizedMatch
  ): Promise<{ action: 'UPDATED' | 'LINKED_ONLY' | 'UNCHANGED'; discrepancies: string[] }> {
    const discrepancies: string[] = [];
    const existingPrec = this.SOURCE_PRECEDENCE[existing.providerSource] || 0;
    const incomingPrec = this.SOURCE_PRECEDENCE[incoming.providerSource] || 0;

    // Check score agreement if both have full-time scores
    const bothHaveScores =
      existing.homeScoreFullTime !== null &&
      incoming.homeScoreFullTime !== null &&
      incoming.homeScoreFullTime !== undefined;

    if (bothHaveScores) {
      if (
        existing.homeScoreFullTime !== incoming.homeScoreFullTime ||
        existing.awayScoreFullTime !== incoming.awayScoreFullTime
      ) {
        discrepancies.push(
          `Score discrepancy: DB has ${existing.homeScoreFullTime}-${existing.awayScoreFullTime} (${existing.providerSource}), incoming has ${incoming.homeScoreFullTime}-${incoming.awayScoreFullTime} (${incoming.providerSource})`
        );
      }
    }

    // Determine update fields based on precedence
    const updates: Partial<typeof matches.$inferInsert> = {
      updatedAt: new Date(),
    };

    // Retain secondary provider ID
    if (!existing.secondaryProviderId && incoming.externalId !== existing.externalId) {
      updates.secondaryProviderId = incoming.externalId;
      updates.secondaryProviderSource = incoming.providerSource;
    }

    // Safe score update: only overwrite if incoming has higher precedence AND non-null score,
    // or if existing was missing scores
    if (incoming.homeScoreFullTime !== null && incoming.homeScoreFullTime !== undefined) {
      if (existing.homeScoreFullTime === null || incomingPrec >= existingPrec) {
        updates.homeScoreFullTime = incoming.homeScoreFullTime;
        updates.awayScoreFullTime = incoming.awayScoreFullTime;
        updates.homeScoreHalfTime = incoming.homeScoreHalfTime ?? existing.homeScoreHalfTime;
        updates.awayScoreHalfTime = incoming.awayScoreHalfTime ?? existing.awayScoreHalfTime;
        updates.result = incoming.result ?? existing.result;
        updates.status = incoming.status;
      }
    }

    // Enhance venue and referee if available
    if (incoming.venue && !existing.venue) updates.venue = incoming.venue;
    if (incoming.referee && !existing.referee) updates.referee = incoming.referee;
    if (incoming.attendance && !existing.attendance) updates.attendance = incoming.attendance;

    // Elevate data completeness if new stats or odds are attached
    if (incoming.stats) {
      updates.dataCompleteness = 'DETAILED_STATS';
    }

    await db.update(matches).set(updates).where(eq(matches.id, existing.id));

    if (discrepancies.length > 0) {
      await db.insert(ingestionLogs).values({
        providerSource: incoming.providerSource,
        action: `RECONCILE_DISCREPANCY_MATCH_${existing.id}`,
        status: 'WARNING',
        recordsProcessed: 1,
        conflictsDetected: discrepancies.length,
        details: { discrepancies, existingMatchId: existing.id, incomingExternalId: incoming.externalId },
      });
    }

    return {
      action: Object.keys(updates).length > 1 ? 'UPDATED' : 'LINKED_ONLY',
      discrepancies,
    };
  }

  /**
   * Run database-wide integrity audit
   */
  public static async runDatabaseIntegrityAudit(): Promise<{
    healthy: boolean;
    totalMatchesChecked: number;
    duplicateSuspects: number;
    scoreMismatches: number;
    orphanedStatistics: number;
    summary: string;
  }> {
    // 1. Check duplicate suspects (same comp, same home, same away, same kickoff)
    const dupsQuery = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM (
        SELECT competition_id, home_team_id, away_team_id, kickoff_time, COUNT(*)
        FROM matches
        GROUP BY competition_id, home_team_id, away_team_id, kickoff_time
        HAVING COUNT(*) > 1
      ) dupes
    `);

    // 2. Check orphaned statistics
    const orphanedStatsQuery = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM match_statistics ms
      LEFT JOIN matches m ON ms.match_id = m.id
      WHERE m.id IS NULL
    `);

    // 3. Check negative scores or impossible values
    const invalidScoresQuery = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM matches
      WHERE home_score_full_time < 0 OR away_score_full_time < 0
    `);

    const totalMatches = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text as count FROM matches
    `);

    const dupCount = parseInt(dupsQuery.rows[0]?.count || '0', 10);
    const orphanedCount = parseInt(orphanedStatsQuery.rows[0]?.count || '0', 10);
    const invalidScores = parseInt(invalidScoresQuery.rows[0]?.count || '0', 10);
    const totalCount = parseInt(totalMatches.rows[0]?.count || '0', 10);

    const healthy = dupCount === 0 && orphanedCount === 0 && invalidScores === 0;

    return {
      healthy,
      totalMatchesChecked: totalCount,
      duplicateSuspects: dupCount,
      scoreMismatches: invalidScores,
      orphanedStatistics: orphanedCount,
      summary: healthy
        ? `Database integrity verified: 0 duplicate suspects, 0 orphaned statistics, 0 invalid scores across ${totalCount.toLocaleString()} matches.`
        : `Integrity notice: ${dupCount} duplicate candidates, ${orphanedCount} orphaned statistics detected.`,
    };
  }

  /**
   * Automatically reconcile and deduplicate existing duplicate records in the database.
   * Uses set-based CTE to merge and purge duplicates with zero foreign key violations.
   */
  public static async reconcileExistingDuplicates(): Promise<{
    groupsEvaluated: number;
    recordsMerged: number;
    details: string[];
  }> {
    const result = await db.execute<{ merged_count: string; groups_count: string }>(sql`
      WITH ranked_matches AS (
        SELECT 
          id,
          competition_id,
          home_team_id,
          away_team_id,
          kickoff_time,
          external_id,
          provider_source,
          ROW_NUMBER() OVER (
            PARTITION BY competition_id, home_team_id, away_team_id, kickoff_time
            ORDER BY 
              CASE provider_source 
                WHEN 'football-data-org' THEN 1 
                WHEN 'api-football-v3' THEN 2 
                WHEN 'open-football' THEN 3 
                ELSE 4 
              END, 
              id ASC
          ) as rn,
          FIRST_VALUE(id) OVER (
            PARTITION BY competition_id, home_team_id, away_team_id, kickoff_time
            ORDER BY 
              CASE provider_source 
                WHEN 'football-data-org' THEN 1 
                WHEN 'api-football-v3' THEN 2 
                WHEN 'open-football' THEN 3 
                ELSE 4 
              END, 
              id ASC
          ) as canonical_id,
          COUNT(*) OVER (
            PARTITION BY competition_id, home_team_id, away_team_id, kickoff_time
          ) as total_in_group
        FROM matches
      ),
      dupes AS (
        SELECT * FROM ranked_matches WHERE total_in_group > 1 AND rn > 1
      ),
      update_canonical AS (
        UPDATE matches m
        SET secondary_provider_id = d.external_id,
            secondary_provider_source = d.provider_source
        FROM dupes d
        WHERE m.id = d.canonical_id AND m.secondary_provider_id IS NULL
        RETURNING m.id
      ),
      del_stats AS (
        DELETE FROM match_statistics 
        WHERE match_id IN (SELECT id FROM dupes)
        RETURNING match_id
      ),
      del_lineups AS (
        DELETE FROM lineups 
        WHERE match_id IN (SELECT id FROM dupes)
        RETURNING match_id
      ),
      del_evidence AS (
        DELETE FROM evidence_snapshots 
        WHERE match_id IN (SELECT id FROM dupes)
        RETURNING match_id
      ),
      del_predictions AS (
        DELETE FROM prediction_ledger 
        WHERE match_id IN (SELECT id FROM dupes)
        RETURNING match_id
      ),
      del_odds AS (
        DELETE FROM historical_odds 
        WHERE match_id IN (SELECT id FROM dupes)
        RETURNING match_id
      ),
      del_matches AS (
        DELETE FROM matches 
        WHERE id IN (SELECT id FROM dupes)
        RETURNING id
      )
      SELECT 
        (SELECT COUNT(*) FROM del_matches)::text as merged_count,
        (SELECT COUNT(DISTINCT canonical_id) FROM dupes)::text as groups_count
    `);

    const merged = parseInt(result.rows[0]?.merged_count || '0', 10);
    const groups = parseInt(result.rows[0]?.groups_count || '0', 10);

    if (merged > 0) {
      await db.insert(ingestionLogs).values({
        providerSource: 'reconciliation-engine',
        action: 'BATCH_DEDUPLICATION_RECONCILIATION',
        status: 'SUCCESS',
        recordsProcessed: groups,
        recordsUpdated: merged,
        details: { mergedCount: merged, groupsEvaluated: groups },
      });
    }

    return {
      groupsEvaluated: groups,
      recordsMerged: merged,
      details: [`Successfully merged and purged ${merged} duplicate match records across ${groups} distinct fixture clusters.`],
    };
  }
}
