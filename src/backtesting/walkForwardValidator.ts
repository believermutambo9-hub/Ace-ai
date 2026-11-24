import { and, asc, eq, isNotNull, isNull } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { matches, predictionLedger, teams } from '../db/schema.ts';
import { PredictionEngine } from '../models/engine.ts';
import { ProbabilityCalibrator } from '../calibration/calibrator.ts';

export interface BacktestSummary {
  totalMatchesTested: number;
  correctPredictions: number;
  overallAccuracy: number;
  avgBrierScore: number;
  avgLogLoss: number;
  homeWinAccuracy: number;
  drawAccuracy: number;
  awayWinAccuracy: number;
  naiveHomeWinBaseline: number;
  modelComparison: Array<{
    name: string;
    accuracy: number;
    brierScore: number;
  }>;
  testedTimeRange: {
    start: Date;
    end: Date;
  };
}

interface RollingTeamState {
  elo: number;
  played: number;
  recentGoalsFor: number[];
  recentGoalsAgainst: number[];
}

function topPickFromProbs(probs: { homeWin: number; draw: number; awayWin: number }): 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' {
  if (probs.draw > probs.homeWin && probs.draw > probs.awayWin) return 'DRAW';
  if (probs.awayWin > probs.homeWin && probs.awayWin > probs.draw) return 'AWAY_WIN';
  return 'HOME_WIN';
}

export class WalkForwardBacktester {
  /**
   * Run strict chronological walk-forward backtest over completed historical fixtures.
   * All team Elo, attack, and defense strengths are maintained strictly online from
   * prior matches ONLY (never reading future outcomes).
   */
  public static async runBacktest(options?: {
    competitionId?: number;
    limit?: number;
  }): Promise<BacktestSummary> {
    const limit = Math.max(1, Math.min(500, options?.limit ?? 150));

    const whereConditions = [
      eq(matches.status, 'FINISHED'),
      isNotNull(matches.result),
      isNotNull(matches.homeScoreFullTime),
      isNotNull(matches.awayScoreFullTime),
    ];

    if (options?.competitionId) {
      whereConditions.push(eq(matches.competitionId, options.competitionId));
    }

    const allFinished = await db
      .select({
        id: matches.id,
        kickoffTime: matches.kickoffTime,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        venue: matches.venue,
        homeScoreFullTime: matches.homeScoreFullTime,
        awayScoreFullTime: matches.awayScoreFullTime,
        result: matches.result,
      })
      .from(matches)
      .where(and(...whereConditions))
      .orderBy(asc(matches.kickoffTime));

    if (allFinished.length === 0) {
      return {
        totalMatchesTested: 0,
        correctPredictions: 0,
        overallAccuracy: 0,
        avgBrierScore: 0,
        avgLogLoss: 0,
        homeWinAccuracy: 0,
        drawAccuracy: 0,
        awayWinAccuracy: 0,
        naiveHomeWinBaseline: 0,
        modelComparison: [],
        testedTimeRange: { start: new Date(), end: new Date() },
      };
    }

    const allTeams = await db.select({ id: teams.id, canonicalName: teams.canonicalName }).from(teams);
    const teamMap = new Map<number, string>(allTeams.map((t) => [t.id, t.canonicalName]));

    const teamStates = new Map<number, RollingTeamState>();
    const getOrCreateState = (teamId: number): RollingTeamState => {
      let state = teamStates.get(teamId);
      if (!state) {
        state = { elo: 1500, played: 0, recentGoalsFor: [], recentGoalsAgainst: [] };
        teamStates.set(teamId, state);
      }
      return state;
    };

    const computeStrengths = (state: RollingTeamState) => {
      const n = state.recentGoalsFor.length;
      if (n === 0) {
        return { attack: 100, defense: 100 };
      }
      const avgScored = state.recentGoalsFor.reduce((a, b) => a + b, 0) / n;
      const avgConceded = state.recentGoalsAgainst.reduce((a, b) => a + b, 0) / n;
      const w = 6;
      const smoothedScored = (n * avgScored + w * 1.3) / (n + w);
      const smoothedConceded = (n * avgConceded + w * 1.3) / (n + w);
      return {
        attack: Math.max(65, Math.min(140, (smoothedScored / 1.3) * 100)),
        defense: Math.max(65, Math.min(140, 100 + ((1.3 - smoothedConceded) / 1.3) * 35)),
      };
    };

    const evalStartIndex = Math.max(0, allFinished.length - limit);
    const evaluatedMatches: typeof allFinished = [];

    let correct = 0;
    let totalBrier = 0;
    let totalLogLoss = 0;

    let homeCorrect = 0;
    let homeTotal = 0;
    let drawCorrect = 0;
    let drawTotal = 0;
    let awayCorrect = 0;
    let awayTotal = 0;

    // Independent accumulators for every individual model
    const subStats = {
      dixonColes: { correct: 0, brier: 0 },
      elo: { correct: 0, brier: 0 },
      poisson: { correct: 0, brier: 0 },
      monteCarlo: { correct: 0, brier: 0 },
    };

    for (let idx = 0; idx < allFinished.length; idx++) {
      const m = allFinished[idx];
      const homeState = getOrCreateState(m.homeTeamId);
      const awayState = getOrCreateState(m.awayTeamId);

      // 1. Predict strictly BEFORE updating with this match's actual outcome
      if (idx >= evalStartIndex && m.homeTeamId !== m.awayTeamId) {
        const actual = m.result as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
        const homeName = teamMap.get(m.homeTeamId) || 'Home Team';
        const awayName = teamMap.get(m.awayTeamId) || 'Away Team';

        const homeStr = computeStrengths(homeState);
        const awayStr = computeStrengths(awayState);
        const priorSample = homeState.played + awayState.played;

        const pred = PredictionEngine.calculatePrediction({
          homeTeam: homeName,
          awayTeam: awayName,
          competition: 'Historical League',
          venue: m.venue || 'Stadium',
          kickoffTime: m.kickoffTime,
          homeElo: Number(homeState.elo.toFixed(1)),
          awayElo: Number(awayState.elo.toFixed(1)),
          homeAttack: Number(homeStr.attack.toFixed(1)),
          awayAttack: Number(awayStr.attack.toFixed(1)),
          homeDefense: Number(homeStr.defense.toFixed(1)),
          awayDefense: Number(awayStr.defense.toFixed(1)),
          sampleMatchesCount: priorSample,
          hasTeamRatings: priorSample > 0,
        });

        const topPick = topPickFromProbs(pred.prediction);
        if (topPick === actual) correct++;

        if (actual === 'HOME_WIN') {
          homeTotal++;
          if (topPick === 'HOME_WIN') homeCorrect++;
        } else if (actual === 'DRAW') {
          drawTotal++;
          if (topPick === 'DRAW') drawCorrect++;
        } else {
          awayTotal++;
          if (topPick === 'AWAY_WIN') awayCorrect++;
        }

        totalBrier += ProbabilityCalibrator.calculateBrierScore(
          pred.prediction.homeWin,
          pred.prediction.draw,
          pred.prediction.awayWin,
          actual
        );
        totalLogLoss += ProbabilityCalibrator.calculateLogLoss(
          pred.prediction.homeWin,
          pred.prediction.draw,
          pred.prediction.awayWin,
          actual
        );

        // Grade each sub-model independently
        const gradeSubModel = (
          key: keyof typeof subStats,
          probs: { homeWin: number; draw: number; awayWin: number }
        ) => {
          if (topPickFromProbs(probs) === actual) subStats[key].correct++;
          subStats[key].brier += ProbabilityCalibrator.calculateBrierScore(
            probs.homeWin,
            probs.draw,
            probs.awayWin,
            actual
          );
        };

        gradeSubModel('dixonColes', pred.models.dixonColes);
        gradeSubModel('elo', pred.models.elo);
        gradeSubModel('poisson', pred.models.poisson);
        gradeSubModel('monteCarlo', pred.models.monteCarlo);

        evaluatedMatches.push(m);
      }

      // 2. Update rolling Elo & goal history AFTER prediction step
      const hGoals = m.homeScoreFullTime ?? 0;
      const aGoals = m.awayScoreFullTime ?? 0;
      const actualHomeOutcome = hGoals > aGoals ? 1 : hGoals === aGoals ? 0.5 : 0;
      const expectedHome = 1 / (1 + Math.pow(10, (awayState.elo - (homeState.elo + 65)) / 400));
      const gd = Math.abs(hGoals - aGoals);
      const goalMult = gd >= 3 ? 1.5 : gd === 2 ? 1.25 : 1.0;
      const eloDelta = 24 * goalMult * (actualHomeOutcome - expectedHome);

      homeState.elo += eloDelta;
      awayState.elo -= eloDelta;
      homeState.played++;
      awayState.played++;

      homeState.recentGoalsFor.push(hGoals);
      homeState.recentGoalsAgainst.push(aGoals);
      if (homeState.recentGoalsFor.length > 20) homeState.recentGoalsFor.shift();
      if (homeState.recentGoalsAgainst.length > 20) homeState.recentGoalsAgainst.shift();

      awayState.recentGoalsFor.push(aGoals);
      awayState.recentGoalsAgainst.push(hGoals);
      if (awayState.recentGoalsFor.length > 20) awayState.recentGoalsFor.shift();
      if (awayState.recentGoalsAgainst.length > 20) awayState.recentGoalsAgainst.shift();
    }

    const N = evaluatedMatches.length;
    if (N === 0) {
      return {
        totalMatchesTested: 0,
        correctPredictions: 0,
        overallAccuracy: 0,
        avgBrierScore: 0,
        avgLogLoss: 0,
        homeWinAccuracy: 0,
        drawAccuracy: 0,
        awayWinAccuracy: 0,
        naiveHomeWinBaseline: 0,
        modelComparison: [],
        testedTimeRange: { start: new Date(), end: new Date() },
      };
    }

    return {
      totalMatchesTested: N,
      correctPredictions: correct,
      overallAccuracy: Number((correct / N).toFixed(3)),
      avgBrierScore: Number((totalBrier / N).toFixed(4)),
      avgLogLoss: Number((totalLogLoss / N).toFixed(4)),
      homeWinAccuracy: homeTotal > 0 ? Number((homeCorrect / homeTotal).toFixed(3)) : 0,
      drawAccuracy: drawTotal > 0 ? Number((drawCorrect / drawTotal).toFixed(3)) : 0,
      awayWinAccuracy: awayTotal > 0 ? Number((awayCorrect / awayTotal).toFixed(3)) : 0,
      naiveHomeWinBaseline: Number((homeTotal / N).toFixed(3)),
      modelComparison: [
        {
          name: 'Ensemble (Production)',
          accuracy: Number((correct / N).toFixed(3)),
          brierScore: Number((totalBrier / N).toFixed(4)),
        },
        {
          name: 'Dixon-Coles Model',
          accuracy: Number((subStats.dixonColes.correct / N).toFixed(3)),
          brierScore: Number((subStats.dixonColes.brier / N).toFixed(4)),
        },
        {
          name: 'Dynamic Elo Model',
          accuracy: Number((subStats.elo.correct / N).toFixed(3)),
          brierScore: Number((subStats.elo.brier / N).toFixed(4)),
        },
        {
          name: 'Bivariate Poisson Model',
          accuracy: Number((subStats.poisson.correct / N).toFixed(3)),
          brierScore: Number((subStats.poisson.brier / N).toFixed(4)),
        },
        {
          name: 'Monte Carlo (5k)',
          accuracy: Number((subStats.monteCarlo.correct / N).toFixed(3)),
          brierScore: Number((subStats.monteCarlo.brier / N).toFixed(4)),
        },
      ],
      testedTimeRange: {
        start: evaluatedMatches[0].kickoffTime,
        end: evaluatedMatches[evaluatedMatches.length - 1].kickoffTime,
      },
    };
  }

  /**
   * Post-Match Audit Worker: Grades locked predictions against newly finished fixtures
   */
  public static async auditPredictionLedger(): Promise<{ auditedCount: number; correctCount: number }> {
    const pendingPredictions = await db
      .select({
        ledgerId: predictionLedger.id,
        matchId: predictionLedger.matchId,
        homeWinProb: predictionLedger.homeWinProb,
        drawProb: predictionLedger.drawProb,
        awayWinProb: predictionLedger.awayWinProb,
        matchResult: matches.result,
        homeScore: matches.homeScoreFullTime,
        awayScore: matches.awayScoreFullTime,
        matchStatus: matches.status,
      })
      .from(predictionLedger)
      .innerJoin(matches, eq(predictionLedger.matchId, matches.id))
      .where(
        and(
          isNull(predictionLedger.actualResult),
          eq(matches.status, 'FINISHED'),
          isNotNull(matches.result)
        )
      );

    let audited = 0;
    let correct = 0;

    for (const p of pendingPredictions) {
      if (!p.matchResult) continue;
      const actual = p.matchResult as 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';
      const actualScore = `${p.homeScore}-${p.awayScore}`;

      let topPick: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN' = 'HOME_WIN';
      if (p.drawProb > p.homeWinProb && p.drawProb > p.awayWinProb) topPick = 'DRAW';
      else if (p.awayWinProb > p.homeWinProb && p.awayWinProb > p.drawProb) topPick = 'AWAY_WIN';

      const wasCorrect = topPick === actual;
      if (wasCorrect) correct++;

      const brierScore = ProbabilityCalibrator.calculateBrierScore(
        p.homeWinProb,
        p.drawProb,
        p.awayWinProb,
        actual
      );
      const logLoss = ProbabilityCalibrator.calculateLogLoss(
        p.homeWinProb,
        p.drawProb,
        p.awayWinProb,
        actual
      );

      await db
        .update(predictionLedger)
        .set({
          actualResult: actual,
          actualScore,
          wasCorrect,
          brierScore,
          logLoss,
        })
        .where(eq(predictionLedger.id, p.ledgerId));

      audited++;
    }

    return {
      auditedCount: audited,
      correctCount: correct,
    };
  }
}
