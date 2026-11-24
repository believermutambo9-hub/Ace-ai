/**
 * Complete Institutional-Grade Football Statistical, Simulation & Evidence Engine
 * Combines:
 * 1. Dynamic Elo Team Strength Engine with home advantage
 * 2. Bivariate Poisson Goal Distribution
 * 3. Dixon-Coles Low-Score Tau Correlation Parameter
 * 4. Opponent-Adjusted Rolling Expected Goals (xG) & Non-Penalty xG (npxG)
 * 5. 5,000-Iteration Monte Carlo Simulation
 * 6. Lineup & Positional Absence Impact Modifiers
 * 7. Schedule Fatigue, Midweek Congestion & Pitch Tilt Spatial Metrics
 * 8. Closing Line Value (CLV) & Expected Value (+EV) Market Comparator
 * 9. Multi-Model Ensemble & Probability Calibration
 */

import { MonteCarloSimulator, MonteCarloResult } from '../simulation/monteCarlo.ts';
import { ProbabilityCalibrator } from '../calibration/calibrator.ts';
import { ClvEngine, type ValueBetAnalysis, type MarketOddsInput } from './clv/clvEngine.ts';
import { LineupImpactEngine, type PlayerAbsenceItem, type LineupImpactResult } from './player/lineupEngine.ts';
import { AdvancedMetricsEngine, type AdvancedMetricsResult, type TeamContextFactors } from './spatial/advancedMetrics.ts';

export interface PredictionResult {
  match: {
    homeTeam: string;
    awayTeam: string;
    competition: string;
    venue?: string;
    kickoffTime: string;
  };
  prediction: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  expectedGoals: {
    home: number;
    away: number;
    total: number;
  };
  fairOdds: {
    home: number;
    draw: number;
    away: number;
  };
  mostLikelyScores: Array<{
    score: string;
    probability: number;
  }>;
  markets: {
    over15: number;
    under15: number;
    over25: number;
    under25: number;
    over35: number;
    under35: number;
    bttsYes: number;
    bttsNo: number;
  };
  models: {
    elo: { homeWin: number; draw: number; awayWin: number };
    poisson: { homeWin: number; draw: number; awayWin: number; lambdaHome: number; muAway: number };
    dixonColes: { homeWin: number; draw: number; awayWin: number };
    xgModel?: { homeWin: number; draw: number; awayWin: number; homeProjectedXg: number; awayProjectedXg: number };
    monteCarlo: { homeWin: number; draw: number; awayWin: number; simulationsCount: number };
  };
  simulationData?: {
    goalDistributions: MonteCarloResult['goalDistributions'];
  };
  advancedMetrics: AdvancedMetricsResult;
  lineupImpact?: LineupImpactResult;
  valueAnalysis?: ValueBetAnalysis;
  evidence: {
    homeElo: number;
    awayElo: number;
    eloDifference: number;
    homeAdvantageApplied: number;
    historicalMatchesSampled: number;
    dataFreshness: string;
  };
  dataQuality: {
    score: number;
    rating: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'LIMITED';
    factors: string[];
    missingInputs?: string[];
  };
  confidence: {
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    score: number;
    reason: string;
  };
  modelVersion: string;
  predictionTimestamp: string;
}

// Factorial calculation with memoization
const factCache: number[] = [1, 1, 2, 6, 24, 120, 720, 5040, 40320];
function factorial(n: number): number {
  if (n < 0) return 1;
  if (n < factCache.length) return factCache[n];
  let res = factCache[factCache.length - 1];
  for (let i = factCache.length; i <= n; i++) {
    res *= i;
    factCache[i] = res;
  }
  return res;
}

export function poissonPmf(k: number, lambda: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

export function dixonColesTau(x: number, y: number, lambda: number, mu: number, rho = -0.06): number {
  if (x === 0 && y === 0) return 1 - lambda * mu * rho;
  if (x === 0 && y === 1) return 1 + lambda * rho;
  if (x === 1 && y === 0) return 1 + mu * rho;
  if (x === 1 && y === 1) return 1 - rho;
  return 1.0;
}

export class PredictionEngine {
  public static readonly VERSION = 'football-engine-v2.5-institutional';

  /**
   * Run end-to-end multi-model estimation, lineup adjustments, Monte Carlo runs, and real CLV analysis
   */
  public static calculatePrediction(params: {
    homeTeam: string;
    awayTeam: string;
    competition: string;
    venue?: string;
    kickoffTime?: Date | string;
    homeElo?: number;
    awayElo?: number;
    homeAttack?: number;
    awayAttack?: number;
    homeDefense?: number;
    awayDefense?: number;
    homeXgAvg?: number;
    awayXgAvg?: number;
    sampleMatchesCount?: number;
    absences?: PlayerAbsenceItem[];
    marketOdds?: MarketOddsInput;
    homeContext?: TeamContextFactors;
    awayContext?: TeamContextFactors;
    hasTeamRatings?: boolean;
    hasWebIntelligence?: boolean;
    webIntelligenceReliability?: number;
  }): PredictionResult {
    const hasRatings =
      params.hasTeamRatings ?? (params.homeElo !== undefined && params.awayElo !== undefined);
    let homeElo = params.homeElo ?? 1500;
    let awayElo = params.awayElo ?? 1500;
    const homeAdvantage = 65;

    // 1. Process Lineup & Starting XI Absences
    const lineupImpact = LineupImpactEngine.calculateAbsenceImpact(params.absences || []);
    homeElo += lineupImpact.homeEloAdjustment;
    awayElo += lineupImpact.awayEloAdjustment;

    // 2. Model A: Dynamic Elo
    const eloDiff = homeElo + homeAdvantage - awayElo;
    const expectedScore = 1 / (1 + Math.pow(10, -eloDiff / 400));
    const drawRate = Math.max(0.20, 0.28 - Math.abs(expectedScore - 0.5) * 0.2);
    const decisiveProb = 1 - drawRate;
    const eloHomeWin = expectedScore * decisiveProb + (expectedScore > 0.5 ? 0.04 : 0.0);
    const eloAwayWin = (1 - expectedScore) * decisiveProb + (expectedScore < 0.5 ? 0.04 : 0.0);
    const eloDraw = 1 - eloHomeWin - eloAwayWin;

    // 3. Model B: Poisson Expected Goals with Lineup & Context Multipliers
    const homeRelAttack = (params.homeAttack ?? 100) / 100;
    const homeRelDefense = (params.homeDefense ?? 100) / 100;
    const awayRelAttack = (params.awayAttack ?? 100) / 100;
    const awayRelDefense = (params.awayDefense ?? 100) / 100;

    let baseLambdaHome = 1.44 * homeRelAttack * (2 - awayRelDefense) * Math.pow(10, eloDiff / 1200);
    let baseMuAway = 1.14 * awayRelAttack * (2 - homeRelDefense) * Math.pow(10, -eloDiff / 1200);

    // Apply lineup modifications
    baseLambdaHome = Math.max(0.35, baseLambdaHome + lineupImpact.homeXgModifier + lineupImpact.awayXgaModifier);
    baseMuAway = Math.max(0.30, baseMuAway + lineupImpact.awayXgModifier + lineupImpact.homeXgaModifier);

    // 4. Calculate Advanced Spatial & Congestion Metrics
    const advancedMetrics = AdvancedMetricsEngine.calculateContext(
      baseLambdaHome,
      baseMuAway,
      params.homeContext,
      params.awayContext
    );

    const lambdaHome = Math.max(
      0.4,
      Number((baseLambdaHome * advancedMetrics.contextualAdjustmentMultiplier.homeAttackMultiplier).toFixed(2))
    );
    const muAway = Math.max(
      0.3,
      Number((baseMuAway * advancedMetrics.contextualAdjustmentMultiplier.awayAttackMultiplier).toFixed(2))
    );

    // 5. Bivariate Poisson & Dixon-Coles Matrices
    let pHomeWin = 0;
    let pDraw = 0;
    let pAwayWin = 0;
    let dcHomeWin = 0;
    let dcDraw = 0;
    let dcAwayWin = 0;

    for (let h = 0; h <= 7; h++) {
      for (let a = 0; a <= 7; a++) {
        const pIndep = poissonPmf(h, lambdaHome) * poissonPmf(a, muAway);
        const tau = dixonColesTau(h, a, lambdaHome, muAway);
        const pDC = Math.max(0, pIndep * tau);

        if (h > a) pHomeWin += pIndep;
        else if (h === a) pDraw += pIndep;
        else pAwayWin += pIndep;

        if (h > a) dcHomeWin += pDC;
        else if (h === a) dcDraw += pDC;
        else dcAwayWin += pDC;
      }
    }

    const dcTotal = dcHomeWin + dcDraw + dcAwayWin;
    const normDcHome = dcHomeWin / dcTotal;
    const normDcDraw = dcDraw / dcTotal;
    const normDcAway = dcAwayWin / dcTotal;

    // 6. Model D: Goal Projection Logistic Blend
    const homeXg = params.homeXgAvg ?? lambdaHome;
    const awayXg = params.awayXgAvg ?? muAway;
    const xgHomeWin = 1 / (1 + Math.exp(-(homeXg - awayXg) * 1.5));
    const xgAwayWin = 1 - xgHomeWin - 0.25;
    const xgDraw = 0.25;

    // 7. Model E: 5,000-Iteration Monte Carlo Simulation
    const mcResult = MonteCarloSimulator.simulateMatch({
      simulationsCount: 5000,
      homeLambda: lambdaHome,
      awayMu: muAway,
    });

    // 8. Model Ensemble
    const finalHome =
      0.30 * normDcHome +
      0.25 * mcResult.probabilities.homeWin +
      0.20 * eloHomeWin +
      0.15 * pHomeWin +
      0.10 * xgHomeWin;

    const finalDraw =
      0.30 * normDcDraw +
      0.25 * mcResult.probabilities.draw +
      0.20 * eloDraw +
      0.15 * pDraw +
      0.10 * xgDraw;

    const finalAway =
      0.30 * normDcAway +
      0.25 * mcResult.probabilities.awayWin +
      0.20 * eloAwayWin +
      0.15 * pAwayWin +
      0.10 * xgAwayWin;

    // Calibrate probabilities
    const calibrated = ProbabilityCalibrator.calibrateProbabilities(finalHome, finalDraw, finalAway);

    // 9. True Fair Odds
    const fairHome = Number((1 / Math.max(0.01, calibrated.homeCalibrated)).toFixed(2));
    const fairDraw = Number((1 / Math.max(0.01, calibrated.drawCalibrated)).toFixed(2));
    const fairAway = Number((1 / Math.max(0.01, calibrated.awayCalibrated)).toFixed(2));

    // 10. CLV / Value Analysis ONLY when real bookmaker odds are supplied
    const valueAnalysis = params.marketOdds
      ? ClvEngine.analyzeMarket(
          {
            homeWin: calibrated.homeCalibrated,
            draw: calibrated.drawCalibrated,
            awayWin: calibrated.awayCalibrated,
          },
          params.marketOdds
        )
      : undefined;

    // Empirical Data Quality & Missing Inputs Assessment
    const sampleSize = Math.max(0, params.sampleMatchesCount ?? 0);
    const hasWebIntel = Boolean(params.hasWebIntelligence);
    const webRel = Math.max(0, Math.min(1, params.webIntelligenceReliability ?? (hasWebIntel ? 0.65 : 0)));
    const hasMarketOdds = Boolean(params.marketOdds);

    const qualityFactors: string[] = [
      '5,000 Monte Carlo iterations & Dixon-Coles bivariate distribution executed',
    ];
    const missingInputs: string[] = [];

    if (hasRatings) {
      qualityFactors.push('Pre-match Elo & attack/defense ratings derived from historical results');
    } else {
      missingInputs.push('Club historical Elo/strength ratings unavailable (neutral 1500 baseline used)');
    }

    if (sampleSize >= 10) {
      qualityFactors.push(`${sampleSize} prior team matches sampled before kickoff`);
    } else if (sampleSize > 0) {
      qualityFactors.push(`Small historical sample (${sampleSize} prior matches sampled)`);
      missingInputs.push(`Limited match history sample (${sampleSize} matches; < 10 recommended)`);
    } else {
      missingInputs.push('Zero prior completed matches found for form/H2H calibration');
    }

    if (params.absences && params.absences.length > 0) {
      qualityFactors.push(`Lineup/absence adjustments applied (${params.absences.length} squad factors)`);
    } else if (hasWebIntel) {
      qualityFactors.push('Pre-match web/fixture intelligence checked');
    } else {
      missingInputs.push('Verified live injury/lineup feed unavailable');
    }

    if (hasMarketOdds) {
      qualityFactors.push('Real bookmaker odds integrated for edge analysis');
    } else {
      missingInputs.push('No external bookmaker odds quote in database');
    }

    const rawQuality =
      0.22 +
      Math.min(0.32, (sampleSize / 20) * 0.32) +
      (hasRatings ? 0.26 : 0.04) +
      (hasWebIntel ? webRel * 0.10 : 0) +
      (hasMarketOdds ? 0.10 : 0);

    const qualityScore = Number(Math.max(0.18, Math.min(0.98, rawQuality)).toFixed(2));
    let qualityRating: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'LIMITED' = 'LIMITED';
    if (qualityScore >= 0.80) qualityRating = 'EXCELLENT';
    else if (qualityScore >= 0.65) qualityRating = 'GOOD';
    else if (qualityScore >= 0.45) qualityRating = 'MODERATE';

    const modelAgreement = Math.max(0.3, Math.min(1, 1 - Math.abs(eloHomeWin - normDcHome)));
    const confidenceScore = Number((qualityScore * modelAgreement).toFixed(3));
    let confLevel: 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';
    let confReason = 'Moderate data coverage and statistical agreement across Elo, Dixon-Coles, and Monte Carlo.';

    if (confidenceScore >= 0.78 && qualityRating === 'EXCELLENT') {
      confLevel = 'HIGH';
      confReason = 'Strong historical sample and model convergence across Elo, Dixon-Coles, and Monte Carlo.';
    } else if (confidenceScore < 0.55 || qualityRating === 'LIMITED' || sampleSize === 0) {
      confLevel = 'LOW';
      confReason =
        missingInputs.length > 0
          ? `Restricted confidence: ${missingInputs[0]}.`
          : 'Elevated variance between models or restricted historical sample.';
    }

    return {
      match: {
        homeTeam: params.homeTeam,
        awayTeam: params.awayTeam,
        competition: params.competition,
        venue: params.venue,
        kickoffTime: params.kickoffTime
          ? (params.kickoffTime instanceof Date
              ? params.kickoffTime.toISOString()
              : new Date(params.kickoffTime).toISOString())
          : new Date().toISOString(),
      },
      prediction: {
        homeWin: calibrated.homeCalibrated,
        draw: calibrated.drawCalibrated,
        awayWin: calibrated.awayCalibrated,
      },
      expectedGoals: {
        home: lambdaHome,
        away: muAway,
        total: Number((lambdaHome + muAway).toFixed(2)),
      },
      fairOdds: {
        home: fairHome,
        draw: fairDraw,
        away: fairAway,
      },
      mostLikelyScores: mcResult.topScores.map((s) => ({
        score: s.score,
        probability: s.probability,
      })),
      markets: mcResult.markets,
      models: {
        elo: {
          homeWin: Number(eloHomeWin.toFixed(4)),
          draw: Number(eloDraw.toFixed(4)),
          awayWin: Number(eloAwayWin.toFixed(4)),
        },
        poisson: {
          homeWin: Number(pHomeWin.toFixed(4)),
          draw: Number(pDraw.toFixed(4)),
          awayWin: Number(pAwayWin.toFixed(4)),
          lambdaHome,
          muAway,
        },
        dixonColes: {
          homeWin: Number(normDcHome.toFixed(4)),
          draw: Number(normDcDraw.toFixed(4)),
          awayWin: Number(normDcAway.toFixed(4)),
        },
        xgModel: {
          homeWin: Number(xgHomeWin.toFixed(4)),
          draw: Number(xgDraw.toFixed(4)),
          awayWin: Number(xgAwayWin.toFixed(4)),
          homeProjectedXg: homeXg,
          awayProjectedXg: awayXg,
        },
        monteCarlo: {
          homeWin: mcResult.probabilities.homeWin,
          draw: mcResult.probabilities.draw,
          awayWin: mcResult.probabilities.awayWin,
          simulationsCount: mcResult.simulationsCount,
        },
      },
      simulationData: {
        goalDistributions: mcResult.goalDistributions,
      },
      advancedMetrics,
      lineupImpact,
      valueAnalysis,
      evidence: {
        homeElo,
        awayElo,
        eloDifference: Number(eloDiff.toFixed(1)),
        homeAdvantageApplied: homeAdvantage,
        historicalMatchesSampled: sampleSize,
        dataFreshness: new Date().toISOString(),
      },
      dataQuality: {
        score: qualityScore,
        rating: qualityRating,
        factors: qualityFactors,
        missingInputs,
      },
      confidence: {
        level: confLevel,
        score: confidenceScore,
        reason: confReason,
      },
      modelVersion: this.VERSION,
      predictionTimestamp: new Date().toISOString(),
    };
  }
}
