import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  backfillJobs,
  competitions,
  matches,
  matchStatistics,
  seasons,
  ingestionLogs,
} from '../../db/schema.ts';
import { CANONICAL_COMPETITIONS } from '../identity/competitionAliases.ts';
import { IdentityResolver } from '../identity/resolver.ts';
import { MatchReconciler } from '../reconciliation/matchReconciler.ts';
import { OpenFootballProvider } from '../providers/openFootballProvider.ts';
import { FootballDataProvider } from '../providers/footballDataProvider.ts';
import { ApiFootballProvider } from '../providers/apiFootballProvider.ts';
import { CoverageInventoryManager } from '../inventory/coverageInventoryManager.ts';

export interface BackfillTaskConfig {
  jobType: 'HISTORICAL_BACKFILL' | 'SEASON_IMPORT' | 'DELTA_SYNC' | 'DRY_RUN';
  providerSource: 'open-football' | 'football-data-org' | 'api-football-v3' | 'all';
  competitionCode?: string;
  seasonCode?: string;
  batchSize?: number;
  dryRun?: boolean;
}

export interface BackfillJobProgress {
  jobId: number;
  status: 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
  totalDiscovered: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  failedCount: number;
  checkpointData: any;
  errorLog: any[];
}

export class ResumableBackfillManager {
  private static activeJobs = new Map<number, { shouldPause: boolean; shouldCancel: boolean }>();

  /**
   * Catalog of discoverable worldwide historical seasons across providers
   */
  public static readonly HISTORICAL_CATALOG: Array<{
    provider: 'open-football' | 'football-data-org' | 'api-football-v3';
    compCode: string;
    country: string;
    seasonCode: string;
    subpath?: string;
  }> = [
    // OpenFootball multi-season archive (2018–2024)
    { provider: 'open-football', compCode: 'PL', country: 'England', seasonCode: '2023-2024', subpath: '2023-24/en.1.json' },
    { provider: 'open-football', compCode: 'PL', country: 'England', seasonCode: '2022-2023', subpath: '2022-23/en.1.json' },
    { provider: 'open-football', compCode: 'PL', country: 'England', seasonCode: '2021-2022', subpath: '2021-22/en.1.json' },
    { provider: 'open-football', compCode: 'PL', country: 'England', seasonCode: '2020-2021', subpath: '2020-21/en.1.json' },
    { provider: 'open-football', compCode: 'PL', country: 'England', seasonCode: '2019-2020', subpath: '2019-20/en.1.json' },
    { provider: 'open-football', compCode: 'PL', country: 'England', seasonCode: '2018-2019', subpath: '2018-19/en.1.json' },

    { provider: 'open-football', compCode: 'PD', country: 'Spain', seasonCode: '2023-2024', subpath: '2023-24/es.1.json' },
    { provider: 'open-football', compCode: 'PD', country: 'Spain', seasonCode: '2022-2023', subpath: '2022-23/es.1.json' },
    { provider: 'open-football', compCode: 'PD', country: 'Spain', seasonCode: '2021-2022', subpath: '2021-22/es.1.json' },
    { provider: 'open-football', compCode: 'PD', country: 'Spain', seasonCode: '2020-2021', subpath: '2020-21/es.1.json' },

    { provider: 'open-football', compCode: 'SA', country: 'Italy', seasonCode: '2023-2024', subpath: '2023-24/it.1.json' },
    { provider: 'open-football', compCode: 'SA', country: 'Italy', seasonCode: '2022-2023', subpath: '2022-23/it.1.json' },
    { provider: 'open-football', compCode: 'SA', country: 'Italy', seasonCode: '2021-2022', subpath: '2021-22/it.1.json' },
    { provider: 'open-football', compCode: 'SA', country: 'Italy', seasonCode: '2020-2021', subpath: '2020-21/it.1.json' },

    { provider: 'open-football', compCode: 'BL1', country: 'Germany', seasonCode: '2023-2024', subpath: '2023-24/de.1.json' },
    { provider: 'open-football', compCode: 'BL1', country: 'Germany', seasonCode: '2022-2023', subpath: '2022-23/de.1.json' },
    { provider: 'open-football', compCode: 'BL1', country: 'Germany', seasonCode: '2021-2022', subpath: '2021-22/de.1.json' },
    { provider: 'open-football', compCode: 'BL1', country: 'Germany', seasonCode: '2020-2021', subpath: '2020-21/de.1.json' },

    { provider: 'open-football', compCode: 'FL1', country: 'France', seasonCode: '2023-2024', subpath: '2023-24/fr.1.json' },
    { provider: 'open-football', compCode: 'FL1', country: 'France', seasonCode: '2022-2023', subpath: '2022-23/fr.1.json' },
    { provider: 'open-football', compCode: 'FL1', country: 'France', seasonCode: '2021-2022', subpath: '2021-22/fr.1.json' },
    { provider: 'open-football', compCode: 'FL1', country: 'France', seasonCode: '2020-2021', subpath: '2020-21/fr.1.json' },

    { provider: 'open-football', compCode: 'DED', country: 'Netherlands', seasonCode: '2023-2024', subpath: '2023-24/nl.1.json' },
    { provider: 'open-football', compCode: 'DED', country: 'Netherlands', seasonCode: '2022-2023', subpath: '2022-23/nl.1.json' },
    { provider: 'open-football', compCode: 'DED', country: 'Netherlands', seasonCode: '2021-2022', subpath: '2021-22/nl.1.json' },

    { provider: 'open-football', compCode: 'PPL', country: 'Portugal', seasonCode: '2023-2024', subpath: '2023-24/pt.1.json' },
    { provider: 'open-football', compCode: 'PPL', country: 'Portugal', seasonCode: '2022-2023', subpath: '2022-23/pt.1.json' },
    { provider: 'open-football', compCode: 'PPL', country: 'Portugal', seasonCode: '2021-2022', subpath: '2021-22/pt.1.json' },

    // Football-Data.org live & completed seasons
    { provider: 'football-data-org', compCode: 'PL', country: 'England', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'PD', country: 'Spain', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'SA', country: 'Italy', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'BL1', country: 'Germany', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'FL1', country: 'France', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'DED', country: 'Netherlands', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'PPL', country: 'Portugal', seasonCode: '2024-2025' },
    { provider: 'football-data-org', compCode: 'BSA', country: 'Brazil', seasonCode: '2024' },
    { provider: 'football-data-org', compCode: 'CL', country: 'Europe', seasonCode: '2024-2025' },

    // API-Football multi-tier Americas & international
    { provider: 'api-football-v3', compCode: 'MLS', country: 'USA', seasonCode: '2024' },
    { provider: 'api-football-v3', compCode: 'ARG', country: 'Argentina', seasonCode: '2024' },
  ];

  /**
   * Create a new backfill job in PostgreSQL
   */
  public static async createJob(config: BackfillTaskConfig): Promise<number> {
    const [job] = await db
      .insert(backfillJobs)
      .values({
        jobType: config.jobType,
        providerSource: config.providerSource,
        competitionCode: config.competitionCode || 'ALL',
        seasonCode: config.seasonCode || 'ALL',
        status: 'PENDING',
        checkpointData: { currentCatalogIndex: 0, itemsProcessed: 0, lastBatchTimestamp: new Date().toISOString() },
        errorLog: [],
      })
      .returning();

    return job.id;
  }

  /**
   * Execute or resume a backfill job
   */
  public static async executeJob(jobId: number): Promise<BackfillJobProgress> {
    const [job] = await db.select().from(backfillJobs).where(eq(backfillJobs.id, jobId)).limit(1);
    if (!job) throw new Error(`Backfill job ${jobId} not found`);

    this.activeJobs.set(jobId, { shouldPause: false, shouldCancel: false });

    await db
      .update(backfillJobs)
      .set({
        status: 'RUNNING',
        startedAt: job.startedAt || new Date(),
        lastHeartbeatAt: new Date(),
      })
      .where(eq(backfillJobs.id, jobId));

    // Ensure base competitions and aliases are seeded
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

    // Determine catalog tasks to run
    let catalog = [...this.HISTORICAL_CATALOG];
    if (job.providerSource !== 'all') {
      catalog = catalog.filter((c) => c.provider === job.providerSource);
    }
    if (job.competitionCode && job.competitionCode !== 'ALL') {
      catalog = catalog.filter((c) => c.compCode === job.competitionCode);
    }
    if (job.seasonCode && job.seasonCode !== 'ALL') {
      catalog = catalog.filter((c) => c.seasonCode === job.seasonCode);
    }

    const checkpoint = (job.checkpointData as any) || { currentCatalogIndex: 0 };
    let startIndex = checkpoint.currentCatalogIndex || 0;

    let processed = job.processedCount || 0;
    let inserted = job.insertedCount || 0;
    let updated = job.updatedCount || 0;
    let failed = job.failedCount || 0;
    const errors: any[] = Array.isArray(job.errorLog) ? [...job.errorLog] : [];

    const compDbMap = new Map<string, typeof competitions.$inferSelect>();
    const allComps = await db.select().from(competitions);
    for (const c of allComps) compDbMap.set(c.code, c);

    for (let i = startIndex; i < catalog.length; i++) {
      const activeState = this.activeJobs.get(jobId);
      if (activeState?.shouldCancel) {
        await db
          .update(backfillJobs)
          .set({ status: 'CANCELLED', completedAt: new Date() })
          .where(eq(backfillJobs.id, jobId));
        this.activeJobs.delete(jobId);
        return {
          jobId,
          status: 'CANCELLED',
          totalDiscovered: catalog.length,
          processedCount: processed,
          insertedCount: inserted,
          updatedCount: updated,
          failedCount: failed,
          checkpointData: { currentCatalogIndex: i },
          errorLog: errors,
        };
      }

      if (activeState?.shouldPause) {
        await db
          .update(backfillJobs)
          .set({
            status: 'PAUSED',
            processedCount: processed,
            insertedCount: inserted,
            updatedCount: updated,
            failedCount: failed,
            checkpointData: { currentCatalogIndex: i, pausedAt: new Date().toISOString() },
            lastHeartbeatAt: new Date(),
          })
          .where(eq(backfillJobs.id, jobId));
        this.activeJobs.delete(jobId);
        return {
          jobId,
          status: 'PAUSED',
          totalDiscovered: catalog.length,
          processedCount: processed,
          insertedCount: inserted,
          updatedCount: updated,
          failedCount: failed,
          checkpointData: { currentCatalogIndex: i },
          errorLog: errors,
        };
      }

      const task = catalog[i];
      const compRecord = compDbMap.get(task.compCode);
      if (!compRecord) continue;

      // Ensure season entity
      let [seasonRecord] = await db
        .select()
        .from(seasons)
        .where(and(eq(seasons.competitionId, compRecord.id), eq(seasons.seasonCode, task.seasonCode)))
        .limit(1);

      if (!seasonRecord) {
        const [yStart, yEnd] = task.seasonCode.includes('-')
          ? task.seasonCode.split('-').map((y) => parseInt(y, 10))
          : [parseInt(task.seasonCode, 10), parseInt(task.seasonCode, 10)];

        const [insertedSeason] = await db
          .insert(seasons)
          .values({
            competitionId: compRecord.id,
            seasonCode: task.seasonCode,
            yearStart: isNaN(yStart) ? 2024 : yStart,
            yearEnd: isNaN(yEnd) ? 2025 : yEnd,
            isCurrent: task.seasonCode === '2024-2025' || task.seasonCode === '2026',
          })
          .returning();
        seasonRecord = insertedSeason;
      }

      try {
        let fetchedMatches: any[] = [];
        if (task.provider === 'open-football' && task.subpath) {
          const url = `https://raw.githubusercontent.com/openfootball/football.json/master/${task.subpath}`;
          const res = await fetch(url);
          if (res.ok) {
            const feed = await res.json();
            if (feed.matches && Array.isArray(feed.matches)) {
              for (let mIdx = 0; mIdx < feed.matches.length; mIdx++) {
                const raw = feed.matches[mIdx];
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

                fetchedMatches.push({
                  externalId: `of_${task.compCode}_${task.seasonCode}_${mIdx + 1}`,
                  providerSource: 'open-football',
                  competitionCode: task.compCode,
                  seasonCode: task.seasonCode,
                  round: raw.round || 'Regular Season',
                  kickoffTime: new Date(`${raw.date}T15:00:00Z`),
                  homeTeamRawName: raw.team1,
                  awayTeamRawName: raw.team2,
                  status,
                  homeScoreFullTime: ft ? ft[0] : null,
                  awayScoreFullTime: ft ? ft[1] : null,
                  homeScoreHalfTime: ht ? ht[0] : null,
                  awayScoreHalfTime: ht ? ht[1] : null,
                  result,
                });
              }
            }
          }
        } else if (task.provider === 'football-data-org') {
          if (process.env.FOOTBALL_DATA_API_KEY) {
            const fd = new FootballDataProvider();
            fetchedMatches = await fd.fetchMatches(task.compCode, task.seasonCode);
            // Rate limit delay (6.2s)
            await new Promise((r) => setTimeout(r, 6200));
          }
        } else if (task.provider === 'api-football-v3') {
          if (process.env.API_FOOTBALL_KEY) {
            const af = new ApiFootballProvider();
            fetchedMatches = await af.fetchMatches(task.compCode, task.seasonCode);
          }
        }

        // Process batch with deduplication and reconciliation
        for (const m of fetchedMatches) {
          processed++;

          const homeTeam = await IdentityResolver.resolveTeam(m.homeTeamRawName, compRecord.country, m.providerSource);
          const awayTeam = await IdentityResolver.resolveTeam(m.awayTeamRawName, compRecord.country, m.providerSource);

          // 1. Check if exact external ID already exists
          const [existingById] = await db
            .select()
            .from(matches)
            .where(and(eq(matches.providerSource, m.providerSource), eq(matches.externalId, m.externalId)))
            .limit(1);

          if (existingById) {
            // Reconcile and update
            await MatchReconciler.reconcileMatchRecord(existingById, m);
            updated++;
          } else {
            // 2. Check if match already exists from a different provider via MatchReconciler
            const existingCrossProvider = await MatchReconciler.findExistingMatch(
              compRecord.id,
              homeTeam.id,
              awayTeam.id,
              m.kickoffTime
            );

            if (existingCrossProvider) {
              await MatchReconciler.reconcileMatchRecord(existingCrossProvider, m);
              updated++;
            } else {
              // 3. Insert fresh match
              const [insertedMatch] = await db
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
                  homeScoreFullTime: m.homeScoreFullTime,
                  awayScoreFullTime: m.awayScoreFullTime,
                  homeScoreHalfTime: m.homeScoreHalfTime,
                  awayScoreHalfTime: m.awayScoreHalfTime,
                  result: m.result,
                  dataCompleteness: m.stats ? 'DETAILED_STATS' : 'SCORES',
                })
                .returning();

              inserted++;

              if (m.stats) {
                await db
                  .insert(matchStatistics)
                  .values({
                    matchId: insertedMatch.id,
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
              }
            }
          }
        }

        // Durable checkpoint saved after every catalog season
        await db
          .update(backfillJobs)
          .set({
            processedCount: processed,
            insertedCount: inserted,
            updatedCount: updated,
            checkpointData: {
              currentCatalogIndex: i + 1,
              lastCompletedTask: `${task.provider}_${task.compCode}_${task.seasonCode}`,
              lastCheckpointTime: new Date().toISOString(),
            },
            lastHeartbeatAt: new Date(),
          })
          .where(eq(backfillJobs.id, jobId));
      } catch (err: any) {
        failed++;
        errors.push({
          task: `${task.provider}_${task.compCode}_${task.seasonCode}`,
          error: err?.message || String(err),
          timestamp: new Date().toISOString(),
        });
      }
    }

    // Refresh coverage inventory upon completion
    await CoverageInventoryManager.refreshCoverageInventory();

    const finalStatus = errors.length > 0 && inserted === 0 ? 'FAILED' : 'COMPLETED';
    await db
      .update(backfillJobs)
      .set({
        status: finalStatus,
        processedCount: processed,
        insertedCount: inserted,
        updatedCount: updated,
        failedCount: failed,
        completedAt: new Date(),
        errorLog: errors,
      })
      .where(eq(backfillJobs.id, jobId));

    this.activeJobs.delete(jobId);

    return {
      jobId,
      status: finalStatus,
      totalDiscovered: catalog.length,
      processedCount: processed,
      insertedCount: inserted,
      updatedCount: updated,
      failedCount: failed,
      checkpointData: { currentCatalogIndex: catalog.length },
      errorLog: errors,
    };
  }

  public static pauseJob(jobId: number): boolean {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.shouldPause = true;
      return true;
    }
    return false;
  }

  public static cancelJob(jobId: number): boolean {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.shouldCancel = true;
      return true;
    }
    return false;
  }

  public static async listJobs(limit = 20) {
    return await db
      .select()
      .from(backfillJobs)
      .orderBy(sql`created_at DESC`)
      .limit(limit);
  }

  public static async getJob(jobId: number) {
    const [job] = await db.select().from(backfillJobs).where(eq(backfillJobs.id, jobId)).limit(1);
    return job || null;
  }
}
