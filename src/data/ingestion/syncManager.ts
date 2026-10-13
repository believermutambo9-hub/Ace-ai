import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  competitions,
  ingestionLogs,
  matches,
  matchStatistics,
  seasons,
  teamRatings,
} from '../../db/schema.ts';
import { IFootballDataProvider } from '../contracts/provider.interface.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';
import { IdentityResolver } from '../identity/resolver.ts';
import { OpenFootballProvider } from '../providers/openFootballProvider.ts';
import { FootballDataProvider } from '../providers/footballDataProvider.ts';
import { ApiFootballProvider } from '../providers/apiFootballProvider.ts';
import { DataValidator } from '../validation/dataValidator.ts';

export interface SyncSummary {
  competitionsCount: number;
  matchesProcessed: number;
  matchesInserted: number;
  matchesUpdated: number;
  conflictsDetected: number;
  errors: string[];
}

export class SyncManager {
  private provider: IFootballDataProvider;

  constructor(provider?: IFootballDataProvider) {
    if (provider) {
      this.provider = provider;
    } else if (process.env.FOOTBALL_DATA_API_KEY) {
      this.provider = new FootballDataProvider();
    } else if (process.env.API_FOOTBALL_KEY) {
      this.provider = new ApiFootballProvider();
    } else {
      this.provider = new OpenFootballProvider();
    }
  }

  /**
   * Initialize baseline canonical entities (competitions, teams, aliases)
   */
  public async initBaseData(): Promise<void> {
    // 1. Seed Competitions
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

    // 2. Seed Teams & Aliases
    await IdentityResolver.seedCanonicalEntities();
  }

  /**
   * Ingest matches for a given competition
   */
  public async syncCompetitionMatches(competitionCode: string, seasonCode = '2024-2025'): Promise<SyncSummary> {
    const summary: SyncSummary = {
      competitionsCount: 1,
      matchesProcessed: 0,
      matchesInserted: 0,
      matchesUpdated: 0,
      conflictsDetected: 0,
      errors: [],
    };

    try {
      // 1. Ensure competition exists
      const [compRecord] = await db
        .select()
        .from(competitions)
        .where(eq(competitions.code, competitionCode))
        .limit(1);

      if (!compRecord) {
        throw new Error(`Competition code '${competitionCode}' not registered in database`);
      }

      // 2. Ensure season exists
      let [seasonRecord] = await db
        .select()
        .from(seasons)
        .where(
          and(
            eq(seasons.competitionId, compRecord.id),
            eq(seasons.seasonCode, seasonCode)
          )
        )
        .limit(1);

      if (!seasonRecord) {
        const [yearStart, yearEnd] = seasonCode.includes('-')
          ? seasonCode.split('-').map((y) => parseInt(y, 10))
          : [parseInt(seasonCode, 10), parseInt(seasonCode, 10)];

        const [insertedSeason] = await db
          .insert(seasons)
          .values({
            competitionId: compRecord.id,
            seasonCode,
            yearStart: isNaN(yearStart) ? 2024 : yearStart,
            yearEnd: isNaN(yearEnd) ? 2025 : yearEnd,
            isCurrent: true,
          })
          .returning();
        seasonRecord = insertedSeason;
      }

      // 3. Fetch matches from provider
      const rawMatches = await this.provider.fetchMatches(competitionCode, seasonCode);
      summary.matchesProcessed = rawMatches.length;

      for (const m of rawMatches) {
        // Validate match data
        const validation = DataValidator.validateMatch(m);
        if (!validation.isValid) {
          summary.conflictsDetected++;
          summary.errors.push(`Match ${m.externalId} invalid: ${validation.errors.join(', ')}`);
          continue;
        }

        // Identity Resolution for Home & Away
        const homeTeam = await IdentityResolver.resolveTeam(
          m.homeTeamRawName,
          compRecord.country,
          this.provider.name
        );
        const awayTeam = await IdentityResolver.resolveTeam(
          m.awayTeamRawName,
          compRecord.country,
          this.provider.name
        );

        // Check existing match
        const [existing] = await db
          .select()
          .from(matches)
          .where(
            and(
              eq(matches.providerSource, m.providerSource),
              eq(matches.externalId, m.externalId)
            )
          )
          .limit(1);

        let matchId: number;

        if (existing) {
          // Update existing match if score or status changed
          await db
            .update(matches)
            .set({
              status: m.status,
              homeScoreHalfTime: m.homeScoreHalfTime,
              awayScoreHalfTime: m.awayScoreHalfTime,
              homeScoreFullTime: m.homeScoreFullTime,
              awayScoreFullTime: m.awayScoreFullTime,
              result: m.result,
              venue: m.venue || existing.venue,
              updatedAt: new Date(),
            })
            .where(eq(matches.id, existing.id));

          matchId = existing.id;
          summary.matchesUpdated++;
        } else {
          // Insert new match
          const [inserted] = await db
            .insert(matches)
            .values({
              externalId: m.externalId,
              providerSource: m.providerSource,
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
              homeScoreHalfTime: m.homeScoreHalfTime,
              awayScoreHalfTime: m.awayScoreHalfTime,
              homeScoreFullTime: m.homeScoreFullTime,
              awayScoreFullTime: m.awayScoreFullTime,
              result: m.result,
              metadata: m.metadata,
            })
            .returning();

          matchId = inserted.id;
          summary.matchesInserted++;
        }

        // If match statistics are available, persist them
        if (m.stats) {
          // Home stats
          await db
            .insert(matchStatistics)
            .values({
              matchId,
              teamId: homeTeam.id,
              isHome: true,
              shots: m.stats.home.shots,
              shotsOnTarget: m.stats.home.shotsOnTarget,
              possession: m.stats.home.possession,
              corners: m.stats.home.corners,
              fouls: m.stats.home.fouls,
              xg: m.stats.home.xg,
              xga: m.stats.away.xg,
            })
            .onConflictDoNothing();

          // Away stats
          await db
            .insert(matchStatistics)
            .values({
              matchId,
              teamId: awayTeam.id,
              isHome: false,
              shots: m.stats.away.shots,
              shotsOnTarget: m.stats.away.shotsOnTarget,
              possession: m.stats.away.possession,
              corners: m.stats.away.corners,
              fouls: m.stats.away.fouls,
              xg: m.stats.away.xg,
              xga: m.stats.home.xg,
            })
            .onConflictDoNothing();
        }

        // Initialize team ratings if not present
        await this.ensureTeamRating(homeTeam.id);
        await this.ensureTeamRating(awayTeam.id);
      }

      // Record Ingestion Log
      await db.insert(ingestionLogs).values({
        providerSource: this.provider.name,
        action: `sync_${competitionCode}_${seasonCode}`,
        status: summary.errors.length > 0 ? 'WARNING' : 'SUCCESS',
        recordsProcessed: summary.matchesProcessed,
        recordsInserted: summary.matchesInserted,
        recordsUpdated: summary.matchesUpdated,
        conflictsDetected: summary.conflictsDetected,
        details: { errors: summary.errors },
      });

      return summary;
    } catch (err: any) {
      console.error(`Sync error for ${competitionCode}:`, err);
      await db.insert(ingestionLogs).values({
        providerSource: this.provider.name,
        action: `sync_${competitionCode}_${seasonCode}`,
        status: 'ERROR',
        recordsProcessed: summary.matchesProcessed,
        recordsInserted: summary.matchesInserted,
        recordsUpdated: summary.matchesUpdated,
        conflictsDetected: summary.conflictsDetected,
        details: { error: err.message },
      });
      throw err;
    }
  }

  /**
   * Sync all core global competitions
   */
  public async syncAll(): Promise<SyncSummary[]> {
    await this.initBaseData();
    const coreLeagues = ['PL', 'PD', 'SA', 'BL1', 'CL'];
    const results: SyncSummary[] = [];

    for (const league of coreLeagues) {
      try {
        const summary = await this.syncCompetitionMatches(league);
        results.push(summary);
      } catch (err: any) {
        console.warn(`[SyncManager] Non-fatal sync notice for ${league}:`, err?.message);
      }
    }

    return results;
  }

  private async ensureTeamRating(teamId: number): Promise<void> {
    const [existing] = await db
      .select()
      .from(teamRatings)
      .where(eq(teamRatings.teamId, teamId))
      .limit(1);

    if (!existing) {
      await db
        .insert(teamRatings)
        .values({
          teamId,
          overallElo: 1500.0,
          attackRating: 100.0,
          defenseRating: 100.0,
          homeAdvantage: 65.0,
          recentFormString: '',
        })
        .onConflictDoNothing();
    }
  }
}
