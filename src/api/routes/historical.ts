import { Router } from 'express';
import { CoverageInventoryManager } from '../../data/inventory/coverageInventoryManager.ts';
import { ResumableBackfillManager } from '../../data/backfill/resumableBackfillManager.ts';
import { MatchReconciler } from '../../data/reconciliation/matchReconciler.ts';
import { requireAdminOrService } from '../../middleware/auth.ts';

export const historicalRouter = Router();

/**
 * GET /api/historical/coverage
 * Worldwide historical coverage summary calculated from genuine PostgreSQL records.
 */
historicalRouter.get('/coverage', async (_req, res) => {
  try {
    const summary = await CoverageInventoryManager.getGlobalCoverageSummary();
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      summary,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to compute coverage summary' });
  }
});

/**
 * GET /api/historical/inventory
 * Provider-by-provider and competition-by-season inventory breakdown.
 */
historicalRouter.get('/inventory', async (req, res) => {
  try {
    const items = await CoverageInventoryManager.getInventoryList({
      provider: req.query.provider as string,
      country: req.query.country as string,
      competition: req.query.competition as string,
      season: req.query.season as string,
    });
    res.json({
      success: true,
      count: items.length,
      inventory: items,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to list inventory' });
  }
});

/**
 * POST /api/historical/inventory/refresh
 * Triggers aggregation refresh of coverage inventory.
 */
historicalRouter.post('/inventory/refresh', requireAdminOrService, async (_req, res) => {
  try {
    const upserted = await CoverageInventoryManager.refreshCoverageInventory();
    res.json({
      success: true,
      message: `Refreshed ${upserted} coverage inventory records.`,
      recordsUpserted: upserted,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to refresh coverage inventory' });
  }
});

/**
 * GET /api/historical/backfill/jobs
 * List recent backfill jobs.
 */
historicalRouter.get('/backfill/jobs', async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const jobs = await ResumableBackfillManager.listJobs(limit);
    res.json({
      success: true,
      count: jobs.length,
      jobs,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to list backfill jobs' });
  }
});

/**
 * GET /api/historical/backfill/jobs/:id
 * Retrieve details and checkpoint state for a specific job.
 */
historicalRouter.get('/backfill/jobs/:id', async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    const job = await ResumableBackfillManager.getJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `Job ${jobId} not found` });
    }
    res.json({ success: true, job });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to retrieve job' });
  }
});

/**
 * POST /api/historical/backfill/start
 * Initiate a new historical backfill or season import.
 */
historicalRouter.post('/backfill/start', requireAdminOrService, async (req, res) => {
  try {
    const { providerSource = 'open-football', competitionCode, seasonCode, dryRun = false } = req.body;

    const jobId = await ResumableBackfillManager.createJob({
      jobType: dryRun ? 'DRY_RUN' : 'HISTORICAL_BACKFILL',
      providerSource,
      competitionCode,
      seasonCode,
      dryRun,
    });

    // Run execution asynchronously so client receives immediate tracking response
    ResumableBackfillManager.executeJob(jobId).catch((e) => {
      console.error(`[Backfill] Async execution error for job ${jobId}:`, e?.message || e);
    });

    res.json({
      success: true,
      message: `Historical backfill job ${jobId} initiated.`,
      jobId,
      trackingUrl: `/api/historical/backfill/jobs/${jobId}`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to initiate backfill job' });
  }
});

/**
 * POST /api/historical/backfill/:id/pause
 * Pause an active backfill job and persist checkpoint.
 */
historicalRouter.post('/backfill/:id/pause', requireAdminOrService, async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    const paused = ResumableBackfillManager.pauseJob(jobId);
    res.json({
      success: true,
      jobId,
      message: paused ? `Job ${jobId} pause signal dispatched.` : `Job ${jobId} not actively running in memory.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to pause job' });
  }
});

/**
 * POST /api/historical/backfill/:id/resume
 * Resume a paused or failed job from its last durable checkpoint.
 */
historicalRouter.post('/backfill/:id/resume', requireAdminOrService, async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    const job = await ResumableBackfillManager.getJob(jobId);
    if (!job) {
      return res.status(404).json({ success: false, error: `Job ${jobId} not found` });
    }

    ResumableBackfillManager.executeJob(jobId).catch((e) => {
      console.error(`[Backfill] Async resume error for job ${jobId}:`, e?.message || e);
    });

    res.json({
      success: true,
      jobId,
      message: `Job ${jobId} resumed from checkpoint index ${(job.checkpointData as any)?.currentCatalogIndex || 0}.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to resume job' });
  }
});

/**
 * POST /api/historical/backfill/:id/cancel
 * Cancel an active backfill job.
 */
historicalRouter.post('/backfill/:id/cancel', requireAdminOrService, async (req, res) => {
  try {
    const jobId = Number(req.params.id);
    const cancelled = ResumableBackfillManager.cancelJob(jobId);
    res.json({
      success: true,
      jobId,
      message: cancelled ? `Job ${jobId} cancel signal dispatched.` : `Job ${jobId} was not running.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to cancel job' });
  }
});

/**
 * GET /api/historical/integrity
 * Run database-wide integrity audit.
 */
historicalRouter.get('/integrity', async (_req, res) => {
  try {
    const audit = await MatchReconciler.runDatabaseIntegrityAudit();
    res.json({
      success: true,
      audit,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to run integrity audit' });
  }
});

/**
 * POST /api/historical/reconcile
 * Trigger automated multi-provider deduplication and conflict reconciliation.
 */
historicalRouter.post('/reconcile', requireAdminOrService, async (_req, res) => {
  try {
    const result = await MatchReconciler.reconcileExistingDuplicates();
    await CoverageInventoryManager.refreshCoverageInventory();
    res.json({
      success: true,
      result,
      message: `Reconciled ${result.recordsMerged} duplicate records across ${result.groupsEvaluated} fixture groups.`,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Reconciliation failed' });
  }
});
