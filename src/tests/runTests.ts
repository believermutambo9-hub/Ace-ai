/**
 * Automated Comprehensive Test Suite for Football Intelligence Engine
 * Covers:
 * 1. Poisson & Dixon-Coles mathematical foundations
 * 2. Monte Carlo 5,000-run simulation convergence
 * 3. Brier Score & Multi-class Log Loss calibration metrics
 * 4. Match integrity & data validation
 * 5. Multi-provider identity resolution & alias cleaning
 * 6. Model ensemble probability normalization (Sum = 1.000)
 */

import { cleanTeamString, IdentityResolver } from '../data/identity/resolver.ts';
import { DataValidator } from '../data/validation/dataValidator.ts';
import { PredictionEngine, poissonPmf, dixonColesTau } from '../models/engine.ts';
import { MonteCarloSimulator } from '../simulation/monteCarlo.ts';
import { ProbabilityCalibrator } from '../calibration/calibrator.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

async function runTestSuite() {
  console.log('--- Starting Comprehensive Football Intelligence Test Suite ---\n');

  // 1. Math & Probability Tests
  console.log('[1. Mathematical Foundations & Probability Rules]');
  {
    const p0 = poissonPmf(0, 1.5);
    const p1 = poissonPmf(1, 1.5);
    assert(p0 > 0 && p0 < 1, 'Poisson PMF returns valid probability for k=0');
    assert(Math.abs(p0 - Math.exp(-1.5)) < 0.0001, 'Poisson k=0 matches theoretical e^(-lambda)');
    assert(p1 > p0, 'Poisson k=1 is higher than k=0 for lambda=1.5');

    const tau00 = dixonColesTau(0, 0, 1.4, 1.1, -0.06);
    assert(tau00 > 0, 'Dixon-Coles tau parameter is positive');

    assert(DataValidator.validateProbabilities(0.50, 0.25, 0.25), 'Strict 1.00 sum passes validation');
    assert(DataValidator.validateProbabilities(0.499, 0.251, 0.250), 'Tolerant floating-point sum passes validation');
    assert(!DataValidator.validateProbabilities(0.60, 0.30, 0.30), 'Sum of 1.20 fails probability validation');
    assert(!DataValidator.validateProbabilities(-0.1, 0.6, 0.5), 'Negative probability fails validation');
  }

  // 2. Monte Carlo Simulation Convergence Tests
  console.log('\n[2. Monte Carlo Simulation Engine]');
  {
    const mc = MonteCarloSimulator.simulateMatch({
      simulationsCount: 3000,
      homeLambda: 1.80,
      awayMu: 1.10,
    });

    const pSum = mc.probabilities.homeWin + mc.probabilities.draw + mc.probabilities.awayWin;
    assert(Math.abs(pSum - 1.0) < 0.001, `Monte Carlo probabilities sum to 1.0 (Sum: ${pSum.toFixed(4)})`);
    assert(mc.probabilities.homeWin > mc.probabilities.awayWin, 'Higher lambda produces higher home win frequency');
    assert(mc.expectedGoals.home > 1.4 && mc.expectedGoals.home < 2.2, `Simulated home goals (${mc.expectedGoals.home}) converges near 1.80`);
    assert(mc.markets.over25 >= 0 && mc.markets.over25 <= 1, 'Over 2.5 market in valid probability interval');
    assert(mc.markets.bttsYes >= 0 && mc.markets.bttsYes <= 1, 'BTTS market in valid probability interval');
    assert(mc.topScores.length > 0, 'Generates empirical score frequencies');
  }

  // 3. Calibration & Loss Metrics Tests
  console.log('\n[3. Calibration & Loss Metrics]');
  {
    // High confidence correct prediction should yield very low Brier score
    const bsLow = ProbabilityCalibrator.calculateBrierScore(0.85, 0.10, 0.05, 'HOME_WIN');
    assert(bsLow < 0.10, `Low Brier score for accurate high confidence prediction (${bsLow})`);

    // Incorrect prediction yields higher penalty
    const bsHigh = ProbabilityCalibrator.calculateBrierScore(0.85, 0.10, 0.05, 'AWAY_WIN');
    assert(bsHigh > 1.0, `High Brier penalty for incorrect prediction (${bsHigh})`);

    const ll = ProbabilityCalibrator.calculateLogLoss(0.70, 0.20, 0.10, 'HOME_WIN');
    assert(ll > 0 && ll < 1.0, `Valid Log Loss value (${ll})`);

    const cal = ProbabilityCalibrator.calibrateProbabilities(0.55, 0.25, 0.20);
    const calSum = cal.homeCalibrated + cal.drawCalibrated + cal.awayCalibrated;
    assert(Math.abs(calSum - 1.0) < 0.001, `Calibrated probabilities sum to 1.0 (Sum: ${calSum.toFixed(4)})`);
  }

  // 4. Data Integrity & Validation Tests
  console.log('\n[4. Match Integrity & Data Validation]');
  {
    const validMatch = {
      externalId: 'test_match_99',
      providerSource: 'test-source',
      competitionCode: 'PL',
      seasonCode: '2024-2025',
      kickoffTime: new Date('2026-10-10T15:00:00Z'),
      homeTeamRawName: 'Arsenal FC',
      awayTeamRawName: 'Chelsea FC',
      status: 'FINISHED' as const,
      homeScoreFullTime: 2,
      awayScoreFullTime: 1,
    };
    const resValid = DataValidator.validateMatch(validMatch);
    assert(resValid.isValid, 'Valid finished match passes validation');

    const invalidScore = { ...validMatch, homeScoreFullTime: -1 };
    assert(!DataValidator.validateMatch(invalidScore).isValid, 'Negative match score correctly rejected');

    const identicalTeams = { ...validMatch, awayTeamRawName: 'Arsenal FC' };
    assert(!DataValidator.validateMatch(identicalTeams).isValid, 'Identical clubs correctly rejected');
  }

  // 5. Identity Resolution & Entity Cleaning
  console.log('\n[5. Identity Resolution & Entity Cleaning]');
  {
    assert(cleanTeamString('Manchester United FC') === 'manchester united', 'FC suffix stripped');
    assert(cleanTeamString('Real Madrid C.F.') === 'real madrid', 'Punctuation and CF stripped');
    assert(cleanTeamString('FC Bayern München') === 'bayern munchen', 'Diacritics normalized');
    assert(cleanTeamString('Atlético de Madrid') === 'atletico de madrid', 'Accents removed cleanly');
  }

  // 6. Complete Prediction Engine & Ensemble Assertions
  console.log('\n[6. Prediction Engine & Ensemble Assertions]');
  {
    const prediction = PredictionEngine.calculatePrediction({
      homeTeam: 'Arsenal FC',
      awayTeam: 'Chelsea FC',
      competition: 'Premier League',
      kickoffTime: new Date('2026-10-10T15:00:00Z'),
      homeElo: 1650,
      awayElo: 1550,
      homeAttack: 112,
      awayAttack: 102,
      homeDefense: 109,
      awayDefense: 100,
      sampleMatchesCount: 20,
    });

    const sum = prediction.prediction.homeWin + prediction.prediction.draw + prediction.prediction.awayWin;
    assert(Math.abs(sum - 1.0) < 0.001, `Final ensemble probabilities sum to exactly 1.0 (Sum: ${sum.toFixed(4)})`);
    assert(prediction.expectedGoals.home > 0, `Expected home goals is positive (${prediction.expectedGoals.home})`);
    assert(prediction.expectedGoals.away > 0, `Expected away goals is positive (${prediction.expectedGoals.away})`);
    assert(prediction.mostLikelyScores.length >= 4, 'Score matrix has top outcomes');
    assert(prediction.dataQuality.score >= 0.85, 'Data quality score above 0.85');
    assert(prediction.models.monteCarlo.simulationsCount === 5000, 'Executed 5,000 Monte Carlo runs');
    assert(prediction.fairOdds.home > 1.0, 'Calculates valid Decimal Fair Odds');
  }

  // 7. Closing Line Value (CLV) & Lineup Impact Engine
  console.log('\n[7. CLV (+EV) Market Comparator & Lineup Impact]');
  {
    const { ClvEngine } = await import('../models/clv/clvEngine.ts');
    const { LineupImpactEngine } = await import('../models/player/lineupEngine.ts');
    const { AdvancedMetricsEngine } = await import('../models/spatial/advancedMetrics.ts');

    // Test CLV Expected Value
    const clv = ClvEngine.analyzeMarket(
      { homeWin: 0.55, draw: 0.25, awayWin: 0.20 },
      { homeOdds: 2.10, drawOdds: 3.40, awayOdds: 4.20 }
    );
    assert(clv.marketOverround > 1.0, 'Detects bookmaker overround vig (> 1.0)');
    assert(clv.expectedValuePercent.home > 0, 'Detects positive expected value (+EV) on home selection');
    assert(clv.recommendedBet.hasPositiveEdge, 'Flags positive mathematical edge for disciplined staking');

    // Test Lineup Absence Penalties
    const lineup = LineupImpactEngine.calculateAbsenceImpact([
      { name: 'Star Striker', role: 'PRIMARY_GOALSCORER', team: 'HOME', status: 'CONFIRMED_OUT' },
      { name: 'Lead CB', role: 'LEAD_CENTER_BACK', team: 'AWAY', status: 'CONFIRMED_OUT' },
    ]);
    assert(lineup.homeXgModifier < 0, 'Key striker absence penalizes home attacking xG');
    assert(lineup.awayXgaModifier > 0, 'Away CB absence elevates conceded goals expectation');

    // Test Spatial & Non-Penalty xG
    const spatial = AdvancedMetricsEngine.calculateContext(1.65, 1.10, { daysRest: 3, travelDistanceKm: 0, playedMidweekEuropean: true });
    assert(spatial.homeNpxG < 1.65, 'Calculates pure non-penalty xG');
    assert(spatial.pitchTiltShare.home > 50, 'Home territorial tilt is dominant');
  }

  console.log(`\n--- Test Suite Completed: ${passed} passed, ${failed} failed ---\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
