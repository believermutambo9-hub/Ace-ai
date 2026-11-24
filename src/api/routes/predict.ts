import { Router, Request, Response } from 'express';
import { and, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  competitions,
  evidenceSnapshots,
  matches,
  predictionLedger,
} from '../../db/schema.ts';
import { IdentityResolver } from '../../data/identity/resolver.ts';
import { PredictionEngine } from '../../models/engine.ts';
import { HistoricalEvidenceEngine } from '../../evidence/historical/h2hEngine.ts';
import { WebIntelligenceEngine } from '../../evidence/web/webIntelligence.ts';
import { WalkForwardBacktester } from '../../backtesting/walkForwardValidator.ts';
import { MonteCarloSimulator } from '../../simulation/monteCarlo.ts';
import { UpcomingEngine } from '../../data/upcoming/upcomingEngine.ts';
import { ProbabilityTrendEngine } from '../../data/upcoming/trendEngine.ts';
import { requireAdminOrService } from '../../middleware/auth.ts';

export const predictRouter = Router();

const predictRequestSchema = z.object({
  fixtureId: z.union([z.number(), z.string()]).optional(),
  matchId: z.union([z.number(), z.string()]).optional(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  competition: z.string().optional().default('Premier League'),
  kickoff: z.string().optional(),
  absences: z
    .array(
      z.object({
        name: z.string(),
        role: z.enum([
          'PRIMARY_GOALSCORER',
          'PRIMARY_PLAYMAKER',
          'LEAD_CENTER_BACK',
          'FIRST_GOALKEEPER',
        ]),
        team: z.enum(['HOME', 'AWAY']),
        status: z.enum(['CONFIRMED_OUT', 'DOUBTFUL_75', 'BENCHED']),
      })
    )
    .optional(),
  marketOdds: z
    .object({
      homeOdds: z.number().positive(),
      drawOdds: z.number().positive(),
      awayOdds: z.number().positive(),
    })
    .optional(),
  homeContext: z
    .object({
      daysRest: z.number().default(6),
      travelDistanceKm: z.number().default(0),
      playedMidweekEuropean: z.boolean().default(false),
    })
    .optional(),
  awayContext: z
    .object({
      daysRest: z.number().default(6),
      travelDistanceKm: z.number().default(150),
      playedMidweekEuropean: z.boolean().default(false),
    })
    .optional(),
});

// POST /api/predict
predictRouter.post('/', async (req: Request, res: Response) => {
  try {
    const parseResult = predictRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({
        error: 'Invalid prediction request',
        details: parseResult.error.format(),
      });
    }

    const {
      fixtureId,
      matchId,
      homeTeam,
      awayTeam,
      competition: competitionName,
      kickoff,
      absences,
      marketOdds,
      homeContext,
      awayContext,
    } = parseResult.data;

    const targetMatchId = fixtureId || matchId;
    if (targetMatchId) {
      const parsedId = typeof targetMatchId === 'string' ? parseInt(targetMatchId, 10) : targetMatchId;
      if (isNaN(parsedId)) {
        return res.status(400).json({ error: 'Provided fixtureId must be a valid number' });
      }
      const fixturePred = await UpcomingEngine.generatePredictionForMatch(parsedId, {
        customAbsences: absences,
        marketOdds,
      });
      const trend = await ProbabilityTrendEngine.getTrendForMatch(parsedId);
      return res.json({
        ...fixturePred,
        probabilityTrend: trend,
      });
    }

    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'Either fixtureId/matchId or both homeTeam and awayTeam must be provided.' });
    }

    const resolvedHome = await IdentityResolver.resolveTeam(homeTeam);
    const resolvedAway = await IdentityResolver.resolveTeam(awayTeam);

    if (resolvedHome.id === resolvedAway.id) {
      return res.status(400).json({
        error: 'Home and away teams resolve to the same club',
        resolvedClub: resolvedHome.canonicalName,
      });
    }

    let [comp] = await db
      .select()
      .from(competitions)
      .where(or(eq(competitions.name, competitionName), eq(competitions.code, competitionName)))
      .limit(1);

    if (!comp) {
      [comp] = await db
        .select()
        .from(competitions)
        .where(eq(competitions.code, 'PL'))
        .limit(1);
    }

    const kickoffDate = kickoff ? new Date(kickoff) : new Date(Date.now() + 24 * 60 * 60 * 1000);

    const [homeRating, awayRating, h2hSummary, homeForm, awayForm, webNews] = await Promise.all([
      HistoricalEvidenceEngine.getEffectiveTeamRating(resolvedHome.id, kickoffDate),
      HistoricalEvidenceEngine.getEffectiveTeamRating(resolvedAway.id, kickoffDate),
      HistoricalEvidenceEngine.getH2HRecord(resolvedHome.id, resolvedAway.id, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(resolvedHome.id, true, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(resolvedAway.id, false, kickoffDate),
      WebIntelligenceEngine.gatherPreMatchIntelligence(
        resolvedHome.canonicalName,
        resolvedAway.canonicalName,
        kickoffDate,
        comp?.code
      ),
    ]);

    const predictionResult = PredictionEngine.calculatePrediction({
      homeTeam: resolvedHome.canonicalName,
      awayTeam: resolvedAway.canonicalName,
      competition: comp ? comp.name : competitionName,
      venue: resolvedHome.venueName || 'Home Stadium',
      kickoffTime: kickoffDate,
      homeElo: homeRating.overallElo,
      awayElo: awayRating.overallElo,
      homeAttack: homeRating.attackRating,
      awayAttack: awayRating.attackRating,
      homeDefense: homeRating.defenseRating,
      awayDefense: awayRating.defenseRating,
      sampleMatchesCount: homeForm.sampleMatches + awayForm.sampleMatches + h2hSummary.totalH2HMatches,
      absences:
        absences && absences.length > 0
          ? absences
          : webNews.verifiedAbsences.map((a) => ({
              name: a.playerName,
              role: a.impactScore >= 0.2 ? ('PRIMARY_GOALSCORER' as const) : ('PRIMARY_PLAYMAKER' as const),
              team:
                a.team.toLowerCase() === resolvedHome.canonicalName.toLowerCase()
                  ? ('HOME' as const)
                  : ('AWAY' as const),
              status: a.confirmed ? ('CONFIRMED_OUT' as const) : ('DOUBTFUL_75' as const),
            })),
      marketOdds,
      homeContext,
      awayContext,
      hasTeamRatings: !homeRating.isBaselineDefault || !awayRating.isBaselineDefault,
      hasWebIntelligence: webNews.retrievalStatus !== 'UNAVAILABLE',
      webIntelligenceReliability: webNews.overallIntelligenceReliability,
    });

    // Only link & persist snapshot/ledger if a genuine scheduled fixture already exists in PostgreSQL
    const [existingMatch] = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.homeTeamId, resolvedHome.id),
          eq(matches.awayTeamId, resolvedAway.id),
          eq(matches.status, 'SCHEDULED')
        )
      )
      .limit(1);

    if (!existingMatch) {
      return res.json({
        matchId: null,
        snapshotId: null,
        isAdHocMatchup: true,
        ...predictionResult,
        evidenceHierarchy: {
          h2h: h2hSummary,
          homeForm,
          awayForm,
          webIntelligence: webNews,
        },
        probabilityTrend: null,
      });
    }

    const [snapshot] = await db
      .insert(evidenceSnapshots)
      .values({
        matchId: existingMatch.id,
        snapshotTimestamp: new Date(),
        h2hData: {
          directH2HFound: h2hSummary.directH2HFound,
          totalH2HMatches: h2hSummary.totalH2HMatches,
          homeWins: h2hSummary.homeWins,
          draws: h2hSummary.draws,
          awayWins: h2hSummary.awayWins,
          avgHomeGoals: h2hSummary.avgHomeGoals,
          avgAwayGoals: h2hSummary.avgAwayGoals,
        },
        recentFormData: {
          homeFormString: homeForm.formString,
          homePPG: homeForm.pointsPerGame,
          awayFormString: awayForm.formString,
          awayPPG: awayForm.pointsPerGame,
        },
        webIntelligenceData: webNews,
        sourceReliabilityScore: webNews.overallIntelligenceReliability,
        dataQualityScore: predictionResult.dataQuality.score,
        missingFields: predictionResult.dataQuality.missingInputs || [],
        isImmutable: true,
      })
      .returning();

    await db
      .insert(predictionLedger)
      .values({
        matchId: existingMatch.id,
        snapshotId: snapshot.id,
        predictionTimestamp: new Date(),
        kickoffTime: kickoffDate,
        modelVersion: predictionResult.modelVersion,
        isLocked: true,
        homeWinProb: predictionResult.prediction.homeWin,
        drawProb: predictionResult.prediction.draw,
        awayWinProb: predictionResult.prediction.awayWin,
        expectedHomeGoals: predictionResult.expectedGoals.home,
        expectedAwayGoals: predictionResult.expectedGoals.away,
        totalExpectedGoals: predictionResult.expectedGoals.total,
        mostLikelyScore: predictionResult.mostLikelyScores[0]?.score || '1-1',
        scoreProbabilities: predictionResult.mostLikelyScores,
        modelBreakdown: predictionResult.models,
        ensembleWeights: { dixonColes: 0.30, monteCarlo: 0.25, elo: 0.20, poisson: 0.15, xg: 0.10 },
        confidenceScore: predictionResult.confidence.score,
        confidenceReason: predictionResult.confidence.reason,
      })
      .returning();

    const trend = await ProbabilityTrendEngine.getTrendForMatch(existingMatch.id);

    res.json({
      matchId: existingMatch.id,
      snapshotId: snapshot.id,
      isAdHocMatchup: false,
      ...predictionResult,
      evidenceHierarchy: {
        h2h: h2hSummary,
        homeForm,
        awayForm,
        webIntelligence: webNews,
      },
      probabilityTrend: trend,
    });
  } catch (error: any) {
    console.error('Prediction calculation failed:', error);
    res.status(500).json({ error: error.message || 'Prediction calculation failed' });
  }
});

// POST /api/predict/backtest
predictRouter.post('/backtest', async (req: Request, res: Response) => {
  try {
    const limit = req.body?.limit ? parseInt(req.body.limit, 10) : 100;
    const summary = await WalkForwardBacktester.runBacktest({ limit });
    res.json(summary);
  } catch (error: any) {
    console.error('Backtest error:', error);
    res.status(500).json({ error: error.message || 'Backtest failed' });
  }
});

// POST /api/predict/audit
predictRouter.post('/audit', requireAdminOrService, async (_req: Request, res: Response) => {
  try {
    const auditResult = await WalkForwardBacktester.auditPredictionLedger();
    res.json({
      message: 'Prediction ledger audited against completed fixtures',
      ...auditResult,
    });
  } catch (error: any) {
    console.error('Audit error:', error);
    res.status(500).json({ error: error.message || 'Audit failed' });
  }
});

// GET /api/predict/simulation/:matchId
predictRouter.get('/simulation/:matchId', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Invalid match ID' });

    const [match] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const cutoff = new Date(match.kickoffTime);
    const [homeRating, awayRating] = await Promise.all([
      HistoricalEvidenceEngine.getEffectiveTeamRating(match.homeTeamId, cutoff),
      HistoricalEvidenceEngine.getEffectiveTeamRating(match.awayTeamId, cutoff),
    ]);

    const prediction = PredictionEngine.calculatePrediction({
      homeTeam: String(match.homeTeamId),
      awayTeam: String(match.awayTeamId),
      competition: 'Match Simulation',
      kickoffTime: cutoff,
      homeElo: homeRating.overallElo,
      awayElo: awayRating.overallElo,
      homeAttack: homeRating.attackRating,
      awayAttack: awayRating.attackRating,
      homeDefense: homeRating.defenseRating,
      awayDefense: awayRating.defenseRating,
      sampleMatchesCount: homeRating.matchesPlayed + awayRating.matchesPlayed,
      hasTeamRatings: !homeRating.isBaselineDefault || !awayRating.isBaselineDefault,
    });

    const sim = MonteCarloSimulator.simulateMatch({
      simulationsCount: 10000,
      homeLambda: prediction.expectedGoals.home,
      awayMu: prediction.expectedGoals.away,
    });

    res.json({
      matchId,
      homeLambda: prediction.expectedGoals.home,
      awayMu: prediction.expectedGoals.away,
      ...sim,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Simulation failed' });
  }
});

// GET /api/predict/trend/:matchId
predictRouter.get('/trend/:matchId', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.matchId, 10);
    if (isNaN(matchId)) return res.status(400).json({ error: 'Valid match ID required' });

    const trend = await ProbabilityTrendEngine.getTrendForMatch(matchId);
    if (!trend) return res.status(404).json({ error: 'Match or trend not found' });

    res.json(trend);
  } catch (error: any) {
    console.error('Trend fetch error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch probability trend' });
  }
});

// POST /api/predict/ingest-source
predictRouter.post('/ingest-source', requireAdminOrService, async (req: Request, res: Response) => {
  try {
    const { matchId, sourceType, absencePlayer, absenceTeam, marketOddsHome, marketOddsDraw, marketOddsAway, notes } = req.body;
    const targetId = parseInt(matchId, 10);
    if (isNaN(targetId)) return res.status(400).json({ error: 'Valid matchId is required' });

    const validTypes = ['BREAKING_ABSENCE', 'MARKET_ODDS_SHIFT', 'LINEUP_CONFIRMED', 'WEATHER_TACTICAL'];
    const type = validTypes.includes(sourceType) ? sourceType : 'BREAKING_ABSENCE';

    const updatedTrend = await ProbabilityTrendEngine.ingestLiveSourceUpdate(targetId, type as any, {
      absencePlayer,
      absenceTeam,
      marketOddsHome: marketOddsHome ? parseFloat(marketOddsHome) : undefined,
      marketOddsDraw: marketOddsDraw ? parseFloat(marketOddsDraw) : undefined,
      marketOddsAway: marketOddsAway ? parseFloat(marketOddsAway) : undefined,
      notes,
    });

    res.json({
      message: `Successfully ingested updated source '${type}' and recorded new calibrated prediction version in ledger`,
      trend: updatedTrend,
    });
  } catch (error: any) {
    console.error('Ingest source error:', error);
    res.status(500).json({ error: error.message || 'Failed to ingest data source' });
  }
});
