import { Router, Request, Response } from 'express';
import { UpcomingEngine } from '../../data/upcoming/upcomingEngine.ts';
import { ProbabilityTrendEngine } from '../../data/upcoming/trendEngine.ts';

export const upcomingRouter = Router();

// GET /api/upcoming
// Supports ?hours=1, ?hours=2, ?hours=3, ?hours=4, ?hours=5, ?competition=PL
upcomingRouter.get('/', async (req: Request, res: Response) => {
  try {
    const hoursParam = req.query.hours ? parseInt(req.query.hours as string, 10) : undefined;
    const competition = req.query.competition as string | undefined;

    const data = await UpcomingEngine.getUpcomingDashboard({
      hours: !isNaN(hoursParam as number) ? hoursParam : undefined,
      competition,
    });

    res.json(data);
  } catch (error: any) {
    console.error('Failed to get upcoming dashboard:', error);
    res.status(500).json({ error: error.message || 'Failed to get upcoming dashboard' });
  }
});

// POST /api/upcoming/predict-fixture
upcomingRouter.post('/predict-fixture', async (req: Request, res: Response) => {
  try {
    const { fixtureId, matchId } = req.body;
    const targetId = parseInt(fixtureId || matchId, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Valid fixtureId or matchId is required' });
    }

    const result = await UpcomingEngine.generatePredictionForMatch(targetId, {
      customAbsences: req.body.absences,
      marketOdds: req.body.marketOdds,
    });

    res.json({
      message: 'Prediction successfully generated and logged in ledger',
      ...result,
    });
  } catch (error: any) {
    console.error('Failed to predict fixture:', error);
    res.status(500).json({ error: error.message || 'Failed to predict fixture' });
  }
});

// GET /api/upcoming/predictions/:matchId
upcomingRouter.get('/predictions/:matchId', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    if (isNaN(matchId)) {
      return res.status(400).json({ error: 'Invalid match ID' });
    }

    const versions = await UpcomingEngine.getMatchPredictions(matchId);
    res.json({ matchId, versionsCount: versions.length, versions });
  } catch (error: any) {
    console.error('Failed to get match predictions:', error);
    res.status(500).json({ error: error.message || 'Failed to get match predictions' });
  }
});

// POST /api/upcoming/predictions/:matchId/refresh
upcomingRouter.post('/predictions/:matchId/refresh', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    if (isNaN(matchId)) {
      return res.status(400).json({ error: 'Invalid match ID' });
    }

    const result = await UpcomingEngine.generatePredictionForMatch(matchId, {
      modelVersion: `v-refreshed-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    });

    const allVersions = await UpcomingEngine.getMatchPredictions(matchId);

    res.json({
      message: 'Prediction refreshed successfully without overwriting original',
      newPrediction: result,
      versions: allVersions,
    });
  } catch (error: any) {
    console.error('Failed to refresh prediction:', error);
    res.status(500).json({ error: error.message || 'Failed to refresh prediction' });
  }
});

// GET /api/upcoming/predictions/:matchId/trend
upcomingRouter.get('/predictions/:matchId/trend', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid match ID' });

    const trend = await ProbabilityTrendEngine.getTrendForMatch(matchId);
    if (!trend) return res.status(404).json({ error: 'Trend not found for fixture' });

    res.json(trend);
  } catch (error: any) {
    console.error('Failed to get prediction trend:', error);
    res.status(500).json({ error: error.message || 'Failed to get prediction trend' });
  }
});

// POST /api/upcoming/predictions/:matchId/ingest
upcomingRouter.post('/predictions/:matchId/ingest', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid match ID' });

    const { sourceType, absencePlayer, absenceTeam, marketOddsHome, marketOddsDraw, marketOddsAway, notes } = req.body;
    const type = sourceType || 'BREAKING_ABSENCE';

    const updatedTrend = await ProbabilityTrendEngine.ingestLiveSourceUpdate(matchId, type, {
      absencePlayer,
      absenceTeam,
      marketOddsHome: marketOddsHome ? parseFloat(marketOddsHome) : undefined,
      marketOddsDraw: marketOddsDraw ? parseFloat(marketOddsDraw) : undefined,
      marketOddsAway: marketOddsAway ? parseFloat(marketOddsAway) : undefined,
      notes,
    });

    res.json({
      message: 'Updated evidence feed ingested and new ensemble version sealed',
      trend: updatedTrend,
    });
  } catch (error: any) {
    console.error('Failed to ingest source update:', error);
    res.status(500).json({ error: error.message || 'Failed to ingest source update' });
  }
});
