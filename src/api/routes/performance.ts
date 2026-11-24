import { Router, Request, Response } from 'express';
import { desc, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { matches, predictionLedger, teams } from '../../db/schema.ts';
import { WalkForwardBacktester } from '../../backtesting/walkForwardValidator.ts';

export const performanceRouter = Router();

// GET /api/model-performance
// Calculates metrics strictly from evaluated historical outcomes or walk-forward backtests
performanceRouter.get('/', async (req: Request, res: Response) => {
  try {
    const predictions = await db.select().from(predictionLedger);
    const totalPredictions = predictions.length;

    const evaluated = predictions.filter((p) => p.actualResult !== null && p.wasCorrect !== null);

    if (evaluated.length >= 10) {
      // Calculate empirical metrics from resolved prediction ledger records
      const correctCount = evaluated.filter((p) => p.wasCorrect).length;

      let brierSum = 0;
      let logLossSum = 0;
      let homeWins = 0;
      let homeCorrect = 0;
      let draws = 0;
      let drawCorrect = 0;
      let awayWins = 0;
      let awayCorrect = 0;

      evaluated.forEach((p) => {
        brierSum += p.brierScore ?? 0.25;
        logLossSum += p.logLoss ?? 0.693;

        if (p.actualResult === 'HOME_WIN') {
          homeWins++;
          if (p.homeWinProb > p.drawProb && p.homeWinProb > p.awayWinProb) homeCorrect++;
        } else if (p.actualResult === 'DRAW') {
          draws++;
          if (p.drawProb > p.homeWinProb && p.drawProb > p.awayWinProb) drawCorrect++;
        } else if (p.actualResult === 'AWAY_WIN') {
          awayWins++;
          if (p.awayWinProb > p.homeWinProb && p.awayWinProb > p.drawProb) awayCorrect++;
        }
      });

      const accuracy = Number((correctCount / evaluated.length).toFixed(3));
      const brierScore = Number((brierSum / evaluated.length).toFixed(4));
      const logLoss = Number((logLossSum / evaluated.length).toFixed(4));

      return res.json({
        status: 'VERIFIED_LEDGER_EVALUATION',
        modelVersion: 'football-engine-v2.0-full-intelligence',
        sampleSize: totalPredictions,
        evaluatedMatches: evaluated.length,
        evaluatedTimeRange: {
          earliest: evaluated[0]?.predictionTimestamp || new Date().toISOString(),
          latest: evaluated[evaluated.length - 1]?.predictionTimestamp || new Date().toISOString(),
        },
        metrics: {
          accuracy,
          brierScore,
          logLoss,
          baselineComparison: {
            naiveHomeWinBaseline: Number((homeWins / evaluated.length).toFixed(3)),
            uniformRandomBaseline: 0.333,
            edgeOverNaive: Number((accuracy - homeWins / evaluated.length).toFixed(3)),
          },
        },
        breakdownByMarket: {
          homeWinAccuracy: homeWins > 0 ? Number((homeCorrect / homeWins).toFixed(3)) : null,
          drawAccuracy: draws > 0 ? Number((drawCorrect / draws).toFixed(3)) : null,
          awayWinAccuracy: awayWins > 0 ? Number((awayCorrect / awayWins).toFixed(3)) : null,
        },
      });
    }

    // When insufficient evaluated ledger rows exist, run real historical walk-forward backtest
    const backtestLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const backtest = await WalkForwardBacktester.runBacktest({ limit: backtestLimit });

    res.json({
      status: 'VERIFIED_WALK_FORWARD_BACKTEST',
      modelVersion: 'football-engine-v2.0-full-intelligence',
      sampleSize: backtest.totalMatchesTested,
      evaluatedMatches: backtest.totalMatchesTested,
      evaluatedTimeRange: {
        earliest: backtest.testedTimeRange.start.toISOString(),
        latest: backtest.testedTimeRange.end.toISOString(),
      },
      metrics: {
        accuracy: backtest.overallAccuracy,
        brierScore: backtest.avgBrierScore,
        logLoss: backtest.avgLogLoss,
        baselineComparison: {
          naiveHomeWinBaseline: backtest.naiveHomeWinBaseline,
          uniformRandomBaseline: 0.333,
          edgeOverNaive: Number((backtest.overallAccuracy - backtest.naiveHomeWinBaseline).toFixed(3)),
        },
      },
      modelComparison: backtest.modelComparison,
      breakdownByMarket: {
        homeWinAccuracy: backtest.homeWinAccuracy,
        drawAccuracy: backtest.drawAccuracy,
        awayWinAccuracy: backtest.awayWinAccuracy,
      },
      futureDataLeakagePrevention: 'STRICT_PRE_KICKOFF_ONLY',
    });
  } catch (error: any) {
    console.error('Failed to get model performance:', error);
    res.status(500).json({ error: error.message || 'Failed to get performance' });
  }
});

// GET /api/prediction-history
export const predictionHistoryRouter = Router();

predictionHistoryRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const items = await db
      .select({
        id: predictionLedger.id,
        matchId: predictionLedger.matchId,
        modelVersion: predictionLedger.modelVersion,
        predictionTimestamp: predictionLedger.predictionTimestamp,
        kickoffTime: predictionLedger.kickoffTime,
        homeWinProb: predictionLedger.homeWinProb,
        drawProb: predictionLedger.drawProb,
        awayWinProb: predictionLedger.awayWinProb,
        expectedHomeGoals: predictionLedger.expectedHomeGoals,
        expectedAwayGoals: predictionLedger.expectedAwayGoals,
        mostLikelyScore: predictionLedger.mostLikelyScore,
        confidenceScore: predictionLedger.confidenceScore,
        actualResult: predictionLedger.actualResult,
        actualScore: predictionLedger.actualScore,
        wasCorrect: predictionLedger.wasCorrect,
        brierScore: predictionLedger.brierScore,
      })
      .from(predictionLedger)
      .orderBy(desc(predictionLedger.predictionTimestamp))
      .limit(50);

    const matchIds = Array.from(new Set(items.map((p) => p.matchId)));
    const relevantMatches = matchIds.length > 0
      ? await db.select().from(matches).where(inArray(matches.id, matchIds))
      : [];
    const matchMap = new Map(relevantMatches.map((m) => [m.id, m]));

    const teamIds = Array.from(
      new Set(relevantMatches.flatMap((m) => [m.homeTeamId, m.awayTeamId]))
    );
    const relevantTeams = teamIds.length > 0
      ? await db.select().from(teams).where(inArray(teams.id, teamIds))
      : [];
    const teamMap = new Map(relevantTeams.map((t) => [t.id, t.canonicalName]));

    const enriched = items.map((p) => {
      const match = matchMap.get(p.matchId);
      return {
        ...p,
        homeTeam: match ? teamMap.get(match.homeTeamId) : 'Unknown',
        awayTeam: match ? teamMap.get(match.awayTeamId) : 'Unknown',
        status: match?.status || 'SCHEDULED',
      };
    });

    res.json(enriched);
  } catch (error: any) {
    console.error('Failed to get prediction history:', error);
    res.status(500).json({ error: error.message || 'Failed to get prediction history' });
  }
});
