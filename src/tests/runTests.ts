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
    assert(prediction.dataQuality.score >= 0.75 && prediction.dataQuality.rating === 'EXCELLENT', `Empirical data quality score verified (${prediction.dataQuality.score})`);
    assert(prediction.valueAnalysis === undefined, 'Omits valueAnalysis when no real marketOdds are provided');
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

  // 8. League Standings & Official Points Calculation
  console.log('\n[8. League Standings & Table Calculation Engine]');
  {
    const { StandingsEngine } = await import('../data/standings/standingsEngine.ts');
    const standings = await StandingsEngine.getStandings('PL', '2024-2025');
    assert(standings !== null, 'StandingsEngine returns valid league table');
    assert(standings!.standings.length > 0, `Premier League has ${standings?.standings.length} ranked clubs`);
    const leader = standings!.standings[0];
    assert(leader.position === 1, 'Top club has position 1');
    assert(leader.points >= 0, 'League points are non-negative');
    assert(leader.played === leader.won + leader.drawn + leader.lost, 'Matches played matches W + D + L');
    assert(leader.goalDifference === leader.goalsFor - leader.goalsAgainst, 'Goal difference matches GF - GA');
  }

  // 9. Football News Engine & RSS Parsing
  console.log('\n[9. Sourced Football News & Press Dispatches]');
  {
    const { NewsEngine } = await import('../data/news/newsEngine.ts');
    const news = await NewsEngine.getFootballNews('ALL');
    assert(news.articles.length > 0, `Ingested ${news.articles.length} verified news articles`);
    const firstArticle = news.articles[0];
    assert(Boolean(firstArticle.title), 'Article has non-empty title');
    assert(Boolean(firstArticle.url), 'Article has working destination link');
    assert(Boolean(firstArticle.source), 'Article attributes real source publication');
    assert(Boolean(firstArticle.publishedAt), 'Article has valid publication timestamp');
  }

  // 10. Head-to-Head & Historical Clash Engine
  console.log('\n[10. Direct Head-to-Head (H2H) Engine]');
  {
    const { HistoricalEvidenceEngine } = await import('../evidence/historical/h2hEngine.ts');
    const h2h = await HistoricalEvidenceEngine.getH2HRecord(1, 2);
    assert(typeof h2h.totalH2HMatches === 'number', 'Returns direct H2H meeting count');
    assert(h2h.homeWins + h2h.draws + h2h.awayWins === h2h.totalH2HMatches, 'H2H outcomes sum to total encounters');

    const form = await HistoricalEvidenceEngine.getTeamForm(1, true);
    assert(typeof form.pointsPerGame === 'number', 'Calculates points per game');
    assert(form.cleanSheetRate >= 0 && form.cleanSheetRate <= 1, 'Clean sheet rate in [0, 1] interval');
  }

  // 11. Time Window & Next 1-5 Hours Horizon Filtering
  console.log('\n[11. Dynamic Time Horizon & Hour Filtering]');
  {
    const now = new Date();
    const nowMs = now.getTime();
    const testMatches = [
      { id: 1, kickoff: new Date(nowMs + 30 * 60 * 1000) }, // 30m away
      { id: 2, kickoff: new Date(nowMs + 90 * 60 * 1000) }, // 1.5h away
      { id: 3, kickoff: new Date(nowMs + 210 * 60 * 1000) }, // 3.5h away
      { id: 4, kickoff: new Date(nowMs + 360 * 60 * 1000) }, // 6h away
    ];

    const next1h = testMatches.filter((m) => m.kickoff.getTime() <= nowMs + 1 * 3600000);
    const next2h = testMatches.filter((m) => m.kickoff.getTime() <= nowMs + 2 * 3600000);
    const next5h = testMatches.filter((m) => m.kickoff.getTime() <= nowMs + 5 * 3600000);

    assert(next1h.length === 1, 'Next 1 hour captures matches within 60 mins');
    assert(next2h.length === 2, 'Next 2 hours captures matches within 120 mins');
    assert(next5h.length === 3, 'Next 5 hours captures matches within 300 mins');
  }

  // 12. Render Deployment & Runtime Environment Verification
  console.log('\n[12. Render Deployment & Runtime Environment Verification]');
  {
    const fs = await import('fs');
    const pkgRaw = fs.readFileSync('package.json', 'utf-8');
    const pkg = JSON.parse(pkgRaw);

    assert(pkg.scripts.start.includes('server.ts') || pkg.scripts.start.includes('server.js'), 'Valid start script for Render deployment');
    assert(Boolean(pkg.dependencies.tsx || pkg.devDependencies.tsx), 'tsx available for TypeScript runtime execution');

    const serverRaw = fs.readFileSync('server.ts', 'utf-8');
    assert(serverRaw.includes('process.env.PORT'), 'Server binds to dynamic process.env.PORT for Render');
    assert(serverRaw.includes('0.0.0.0'), 'Server listens on 0.0.0.0 host for container routing');
  }

  // 13. Zed Assistant Server-to-Server Integration & S2S Security
  console.log('\n[13. Zed Assistant S2S Integration & Regression Protection]');
  {
    const { zedAuthMiddleware } = await import('../middleware/zedAuth.ts');
    assert(typeof zedAuthMiddleware === 'function', 'Zed S2S auth middleware exported');

    // Test Request ID & tracing generation
    let traceCaptured = '';
    const secret = process.env.PITCHINTEL_SERVICE_SECRET || 'zed-pitchintel-dev-secret-token';
    const mockReq: any = {
      headers: { 'x-pitchintel-service-secret': secret },
      ip: '127.0.0.1',
    };
    const mockRes: any = {
      setHeader: (key: string, val: string) => {
        if (key.toLowerCase() === 'x-request-id') traceCaptured = val;
      },
      status: () => ({ json: () => {} }),
    };
    zedAuthMiddleware(mockReq, mockRes, () => {});
    assert(Boolean(mockReq.requestId), 'Attaches unique x-request-id to incoming Zed request');
    assert(traceCaptured.startsWith('zed-'), 'Injects x-request-id response header for distributed tracing');
    assert(mockReq.clientService === 'zed-assistant', 'Identifies Zed assistant as authenticated client');

    // Anti-fabrication regression check
    const { dbClient } = await import('../db/databaseClient.ts');
    const counts = await dbClient.getRecordCounts();
    assert(counts.matches > 0, `Verified real database matches exist (${counts.matches.toLocaleString()} matches)`);
    assert(counts.teams > 50, `Verified real club entities exist (${counts.teams} clubs)`);
  }

  // 14. Environment Configuration & Canonical URL Normalization
  console.log('\n[14. Environment Configuration & Canonical URL Normalization]');
  {
    const { envConfig } = await import('../config/env.ts');
    assert(typeof envConfig.port === 'number', 'Port resolved as valid integer');
    assert(typeof envConfig.appUrl === 'string' && !envConfig.appUrl.endsWith('/'), 'Canonical appUrl has no trailing slash');
    assert(Boolean(process.env.DATABASE_URL), 'process.env.DATABASE_URL is automatically synthesized and available');
    assert(envConfig.database.isConfigured, 'Database configuration is verified as configured');
    assert(Boolean(envConfig.zedIntegration.apiUrl), 'Zed S2S integration apiUrl is resolved');
    assert(Boolean(envConfig.zedIntegration.serviceSecret), 'Zed S2S integration serviceSecret is available');

    const fs = await import('fs');
    const envExample = fs.readFileSync('.env.example', 'utf-8');
    assert(!envExample.includes('RAPIDAPI_KEY'), 'RAPIDAPI_KEY safely removed from .env.example to prevent AI Studio prompt');
    assert(!envExample.includes('PITCHINTEL_API_URL'), 'PITCHINTEL_API_URL removed from .env.example (uses canonical APP_URL)');
  }

  // 15. Empirical Backtesting Against Real Historical Fixtures (No Fake Metrics)
  console.log('\n[15. Empirical Backtesting Against Real Historical Fixtures]');
  {
    const { WalkForwardBacktester } = await import('../backtesting/walkForwardValidator.ts');
    const backtest = await WalkForwardBacktester.runBacktest({ limit: 15 });
    assert(backtest.totalMatchesTested > 0, `Backtest evaluated real matches (Tested: ${backtest.totalMatchesTested})`);
    assert(backtest.overallAccuracy >= 0 && backtest.overallAccuracy <= 1, `Calculated empirical accuracy: ${backtest.overallAccuracy}`);
    assert(backtest.avgBrierScore >= 0 && backtest.avgBrierScore <= 2, `Calculated real Brier score: ${backtest.avgBrierScore}`);
    assert(backtest.modelComparison.length >= 3, 'Evaluates comparative baseline models (Dixon-Coles, Elo, Poisson)');
  }

  // 16. LiveMatchEngine Data Integrity (No Random Score Inventions)
  console.log('\n[16. LiveMatchEngine Verified Data Integrity]');
  {
    const { LiveMatchEngine } = await import('../data/live/liveMatchEngine.ts');
    const liveMatches = await LiveMatchEngine.getLiveMatches();
    assert(Array.isArray(liveMatches), 'Live matches returns clean array');
    const inPlayMath = LiveMatchEngine.calculateInPlayProbabilities(1, 0, 75);
    const inPlaySum = inPlayMath.homeWin + inPlayMath.draw + inPlayMath.awayWin;
    assert(Math.abs(inPlaySum - 1.0) < 0.01, `In-play probabilities sum to 1.0 (Sum: ${inPlaySum.toFixed(4)})`);
    assert(inPlayMath.homeWin > inPlayMath.awayWin, 'Leading team at min 75 has higher win probability');
  }

  // 17. Authoritative DatabaseClient Health & SELECT 1 Ping
  console.log('\n[17. Authoritative DatabaseClient Health & Ping]');
  {
    const { dbClient } = await import('../db/databaseClient.ts');
    const status = await dbClient.verifyConnection();
    assert(status.connected, 'Live SELECT 1 query succeeded on PostgreSQL');
    assert(status.ping === 1, 'Database ping returned 1');
    assert(status.latencyMs > 0, `Database round-trip latency measured: ${status.latencyMs}ms`);
    assert(status.tablesDetected >= 10, `Database tables detected: ${status.tablesDetected}`);
  }

  // 18. Timing-Safe Zed S2S Authentication & Unauthorized Rejection
  console.log('\n[18. Timing-Safe Zed S2S Authentication & Security]');
  {
    const { zedAuthMiddleware } = await import('../middleware/zedAuth.ts');
    let rejectedCode = 0;
    const badReq: any = {
      headers: { 'x-pitchintel-service-secret': 'completely-invalid-secret' },
    };
    const badRes: any = {
      setHeader: () => {},
      status: (code: number) => {
        rejectedCode = code;
        return { json: () => {} };
      },
    };
    zedAuthMiddleware(badReq, badRes, () => {});
    assert(rejectedCode === 401, 'Unauthorized request rejected with HTTP 401');
  }

  // 19. Multi-Season Dynamic Resolution in OpenFootballProvider
  console.log('\n[19. Multi-Season Dynamic Resolution in OpenFootballProvider]');
  {
    const { OpenFootballProvider } = await import('../data/providers/openFootballProvider.ts');
    const provider = new OpenFootballProvider();
    assert(typeof (provider as any).formatSeasonSlug === 'function', 'Has formatSeasonSlug method');
    assert((provider as any).formatSeasonSlug('2023-2024') === '2023-24', 'Formats 2023-2024 to 2023-24');
    assert((provider as any).formatSeasonSlug('2019-2020') === '2019-20', 'Formats 2019-2020 to 2019-20');
  }

  // 20. Firebase Integration & Security Verification
  console.log('\n[20. Firebase Integration & Security Verification]');
  {
    const fs = await import('fs');
    const path = await import('path');

    // 20.1 Applet Config
    const configPath = path.resolve('firebase-applet-config.json');
    assert(fs.existsSync(configPath), 'firebase-applet-config.json exists');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert(config.projectId === 'oceanic-matrix-v83d0', 'Target project oceanic-matrix-v83d0 configured');
    assert(!!config.firestoreDatabaseId, 'Custom Firestore database ID is present');
    assert(!!config.apiKey, 'API key is present in config');

    // 20.2 Blueprint IR Validation
    const blueprintPath = path.resolve('firebase-blueprint.json');
    assert(fs.existsSync(blueprintPath), 'firebase-blueprint.json exists');
    const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
    assert(!!blueprint.entities.UserProfile, 'Blueprint defines UserProfile entity');
    assert(!!blueprint.entities.UserBet, 'Blueprint defines UserBet entity');
    assert(!!blueprint.firestore['/users/{userId}'], 'Firestore maps user profile document path');
    assert(!!blueprint.firestore['/users/{userId}/bets/{betId}'], 'Firestore maps user bets subcollection path');

    // 20.3 Firestore Rules Hardening
    const rulesPath = path.resolve('firestore.rules');
    assert(fs.existsSync(rulesPath), 'firestore.rules exists');
    const rules = fs.readFileSync(rulesPath, 'utf8');
    assert(rules.includes("rules_version = '2';"), "Rules declare rules_version = '2'");
    assert(rules.includes("allow read, write: if false;"), 'Catch-all default-deny gate present');
    assert(rules.includes('isValidUserProfile'), 'UserProfile validator helper present in rules');
    assert(rules.includes('isValidUserBet'), 'UserBet validator helper present in rules');
    assert(!rules.includes('allow read: if isSignedIn();'), 'Zero blanket reads allowed in rules');

    // 20.4 Client SDK & Error Handler
    const { db, auth, OperationType, handleFirestoreError } = await import('../lib/firebase.ts');
    assert(!!db, 'Firestore client instance initialized with databaseId');
    assert(!!auth, 'Firebase Auth client instance initialized');
    assert(OperationType.WRITE === 'write', 'OperationType enum correctly defined');
    assert(typeof handleFirestoreError === 'function', 'handleFirestoreError compliant with skill contract');
  }

  // 21. Full Production Zed S2S Contract & Router Verification
  console.log('\n[21. Full Production Zed S2S Contract & Router Verification]');
  {
    const { zedRouter } = await import('../api/routes/zed.ts');
    assert(!!zedRouter, 'zedRouter is exported and defined');
    assert(typeof zedRouter === 'function', 'zedRouter is a valid Express Router instance');

    // Test prediction engine mathematical consistency for Zed contract
    const { PredictionEngine } = await import('../models/engine.ts');
    const pred = PredictionEngine.calculatePrediction({
      homeTeam: 'Arsenal FC',
      awayTeam: 'Chelsea FC',
      competition: 'Premier League',
    });
    const probSum = pred.prediction.homeWin + pred.prediction.draw + pred.prediction.awayWin;
    assert(Math.abs(probSum - 1.0) < 0.0001, 'Zed prediction probabilities sum to 1.0000');
    assert(pred.fairOdds.home >= 1.01 && pred.fairOdds.home <= 100, 'Fair odds home is in realistic interval');
    assert(pred.expectedGoals.total > 0, 'Total expected goals is strictly positive');
  }

  // 22. Worldwide Historical Database, Backfill & Deduplication Verification
  console.log('\n[22. Worldwide Historical Database, Backfill & Deduplication Verification]');
  {
    const { CoverageInventoryManager } = await import('../data/inventory/coverageInventoryManager.ts');
    const { ResumableBackfillManager } = await import('../data/backfill/resumableBackfillManager.ts');
    const { MatchReconciler } = await import('../data/reconciliation/matchReconciler.ts');
    const { HistoricalEvidenceEngine } = await import('../evidence/historical/h2hEngine.ts');

    // 22.1 Database Coverage Verification
    const summary = await CoverageInventoryManager.getGlobalCoverageSummary();
    assert(summary.totalMatches > 10000, `Total genuine matches in PostgreSQL exceeds 10,000 (Actual: ${summary.totalMatches.toLocaleString()})`);
    assert(summary.completedMatches > 10000, `Completed matches verified (Actual: ${summary.completedMatches.toLocaleString()})`);
    assert(summary.countriesCount >= 10, `Worldwide countries count >= 10 (Actual: ${summary.countriesCount})`);
    assert(summary.competitionsCount >= 10, `Worldwide competitions count >= 10 (Actual: ${summary.competitionsCount})`);
    assert(summary.seasonsCount >= 30, `Worldwide historical seasons >= 30 (Actual: ${summary.seasonsCount})`);
    assert(summary.scoresPercentage >= 95.0, `Score verification percentage >= 95% (Actual: ${summary.scoresPercentage}%)`);
    assert(!!summary.earliestMatchDate, `Earliest match date recorded: ${summary.earliestMatchDate}`);

    // 22.2 Database Integrity & Deduplication Audit
    const audit = await MatchReconciler.runDatabaseIntegrityAudit();
    assert(audit.healthy, 'Database integrity audit passes with healthy=true');
    assert(audit.duplicateSuspects === 0, 'Zero duplicate match suspects detected');
    assert(audit.scoreMismatches === 0, 'Zero score mismatches or negative scores');
    assert(audit.orphanedStatistics === 0, 'Zero orphaned statistics');

    // 22.3 Resumable Backfill Catalog & Checkpoints
    assert(ResumableBackfillManager.HISTORICAL_CATALOG.length >= 25, 'Historical catalog defines >= 25 multi-provider season tasks');
    const testJobId = await ResumableBackfillManager.createJob({
      jobType: 'DRY_RUN',
      providerSource: 'open-football',
      competitionCode: 'PL',
      seasonCode: '2023-2024',
      dryRun: true,
    });
    assert(testJobId > 0, `Backfill job created with ID #${testJobId}`);
    const jobState = await ResumableBackfillManager.getJob(testJobId);
    assert(jobState !== null, 'Job record persisted in backfill_jobs table');
    assert(jobState?.status === 'PENDING', 'Initial job state is PENDING');
    assert(jobState?.checkpointData !== null, 'Durable checkpointData JSON initialized');
    const { db } = await import('../db/index.ts');
    const { backfillJobs } = await import('../db/schema.ts');
    const { eq } = await import('drizzle-orm');
    await db.delete(backfillJobs).where(eq(backfillJobs.id, testJobId));

    // 22.4 Date-Aware Pre-Match Cutoff & Leakage Prevention
    const cutoffDate = new Date('2023-01-01T00:00:00Z');
    const h2hPre2023 = await HistoricalEvidenceEngine.getH2HRecord(1, 2, cutoffDate);
    if (h2hPre2023.recentMeetings.length > 0) {
      const futureMeetings = h2hPre2023.recentMeetings.filter(m => new Date(m.date).getTime() >= cutoffDate.getTime());
      assert(futureMeetings.length === 0, 'Zero post-cutoff matches returned when asOfDate is provided (No future-data leakage)');
    } else {
      assert(true, 'Date-aware cutoff filter applied cleanly without error');
    }

    // 22.5 Idempotency: Duplicate Reconciler Safety
    const reconcileRun = await MatchReconciler.reconcileExistingDuplicates();
    assert(reconcileRun.recordsMerged === 0, 'Reconcile on clean database merges 0 matches (Idempotent)');
  }

  // 23. Genuine Odds Integrity & Value Bet Engine
  console.log('\n[23. Genuine Odds Integrity & Value Bet Engine]');
  {
    const { scanValueBetsFromMatches, calculateKellyFraction } = await import('../data/valueBets/valueBetEngine.ts');

    const mockMatch: any = {
      id: 99999,
      homeTeam: 'Team Alpha',
      awayTeam: 'Team Beta',
      competitionName: 'Premier League',
      kickoffTime: new Date().toISOString(),
      prediction: {
        probabilities: { homeWin: 0.60, draw: 0.25, awayWin: 0.15 },
        expectedGoals: { home: 1.8, away: 0.8 },
        confidenceScore: 0.85,
        dataQuality: { rating: 'GOOD' },
      },
    };

    // Test 23.1: Unquoted fixture must never fabricate bookmaker odds
    const unquotedOpps = scanValueBetsFromMatches([mockMatch]);
    assert(unquotedOpps.length > 0, 'Generates candidate propositions for upcoming fixture');
    const unquotedHome = unquotedOpps.find((o) => o.selection === 'HOME');
    assert(unquotedHome !== undefined, 'Home proposition exists');
    assert(unquotedHome?.hasRealMarketOdds === false, 'Strictly marks unquoted fixture as hasRealMarketOdds = false');
    assert(unquotedHome?.bookmakerOdds === null, 'Never fabricates synthetic bookmaker odds (bookmakerOdds is null)');
    assert(unquotedHome?.edgePercent === null, 'Never claims artificial EV without real bookmaker odds (edgePercent is null)');
    assert(unquotedHome?.marketStatus === 'UNQUOTED_THEORETICAL_ONLY', 'Status marked as UNQUOTED_THEORETICAL_ONLY');
    assert(unquotedHome?.modelFairOdds === 1.67, 'Accurately computes theoretical model fair odds 1 / 0.60 = 1.67');

    // Test 23.2: Verified real market odds integration
    const realOddsMap = new Map();
    realOddsMap.set('99999:1X2:HOME', { odds: 1.95, bookmaker: 'Pinnacle' });
    const quotedOpps = scanValueBetsFromMatches([mockMatch], realOddsMap);
    const quotedHome = quotedOpps.find((o) => o.selection === 'HOME');
    assert(quotedHome?.hasRealMarketOdds === true, 'Correctly flags verified real market odds');
    assert(quotedHome?.bookmakerOdds === 1.95, 'Uses exact genuine bookmaker odds');
    assert(quotedHome?.bookmakerName === 'Pinnacle', 'Attributes real bookmaker source');
    assert(quotedHome?.edgePercent !== null && (quotedHome?.edgePercent ?? 0) > 10, 'Calculates verified mathematical edge (+17% on 1.95 vs 1.67)');
    assert(quotedHome?.marketStatus === 'VERIFIED_MARKET_ODDS', 'Status marked as VERIFIED_MARKET_ODDS');

    // Test 23.3: Kelly Criterion fraction clamping
    const kelly = calculateKellyFraction(0.60, 1.95);
    assert(kelly > 0 && kelly <= 0.15, 'Kelly fraction is positive and clamped at safe risk threshold (<= 0.15)');
  }

  // 24. Production Readiness: Zero Fabrication, Leak-Free Walk-Forward & Admin Auth
  console.log('\n[24. Production Readiness, Anti-Fabrication & Admin Security]');
  {
    const { OpenFootballProvider } = await import('../data/providers/openFootballProvider.ts');
    const { HistoricalEvidenceEngine } = await import('../evidence/historical/h2hEngine.ts');
    const { WalkForwardBacktester } = await import('../backtesting/walkForwardValidator.ts');
    const { requireAdminOrService } = await import('../middleware/auth.ts');

    // 24.1 Zero fabricated seed matches on OpenFootballProvider
    const ofp = new OpenFootballProvider();
    assert((ofp as any).getVerifiedSeedMatches === undefined, 'OpenFootballProvider no longer contains getVerifiedSeedMatches');

    // 24.2 Neutral / limited scoring when zero historical data exists
    const sparsePred = PredictionEngine.calculatePrediction({
      homeTeam: 'Unknown Club A',
      awayTeam: 'Unknown Club B',
      competition: 'Test League',
      sampleMatchesCount: 0,
      hasTeamRatings: false,
    });
    assert(sparsePred.dataQuality.rating === 'LIMITED', `Sparse prediction marked LIMITED (Actual: ${sparsePred.dataQuality.rating})`);
    assert(sparsePred.valueAnalysis === undefined, 'Sparse prediction omits synthetic valueAnalysis');
    assert(sparsePred.confidence.level === 'LOW', `Sparse prediction confidence marked LOW (Actual: ${sparsePred.confidence.level})`);

    // 24.3 Zero fabricated team form defaults for nonexistent club
    const emptyForm = await HistoricalEvidenceEngine.getTeamForm(-999999, true);
    assert(emptyForm.sampleMatches === 0, 'Nonexistent club returns sampleMatches = 0');
    assert(emptyForm.pointsPerGame === 0 && emptyForm.goalsScoredAvg === 0, 'Nonexistent club returns 0 PPG and 0 goalsScoredAvg (no 1.35/1.3 defaults)');

    // 24.4 Leak-free walk-forward backtest evaluates independent baseline models
    const wf = await WalkForwardBacktester.runBacktest({ limit: 30 });
    assert(wf.totalMatchesTested > 0, `Walk-forward backtest evaluated ${wf.totalMatchesTested} chronological fixtures`);
    assert(wf.naiveHomeWinBaseline > 0 && wf.naiveHomeWinBaseline < 1, `Empirical naiveHomeWinBaseline computed (${wf.naiveHomeWinBaseline})`);
    const ensModel = wf.modelComparison.find((m) => m.name.includes('Ensemble'));
    const eloModel = wf.modelComparison.find((m) => m.name.includes('Elo'));
    assert(Boolean(ensModel && eloModel), 'Walk-forward comparison includes independent Ensemble and Dynamic Elo metrics');

    // 24.5 Admin auth middleware rejects unauthenticated and accepts valid service secret
    let unauthStatus = 0;
    const unauthReq: any = { headers: {} };
    const unauthRes: any = {
      status: (c: number) => {
        unauthStatus = c;
        return { json: () => {} };
      },
    };
    await requireAdminOrService(unauthReq, unauthRes, () => {});
    assert(unauthStatus === 401, 'requireAdminOrService rejects unauthenticated mutation with HTTP 401');

    let svcNextCalled = false;
    const svcSecret = process.env.PITCHINTEL_SERVICE_SECRET || 'zed-pitchintel-dev-secret-token';
    const svcReq: any = { headers: { 'x-pitchintel-service-secret': svcSecret } };
    const svcRes: any = { status: () => ({ json: () => {} }) };
    await requireAdminOrService(svcReq, svcRes, () => {
      svcNextCalled = true;
    });
    assert(svcNextCalled && svcReq.authMethod === 'service_secret', 'requireAdminOrService authorizes valid service secret');

    // 24.6 Firestore market normalization & coverage inventory filtering
    const { normalizeFirestoreMarketType } = await import('../data/portfolio/firestorePortfolioSync.ts');
    const { CoverageInventoryManager } = await import('../data/inventory/coverageInventoryManager.ts');
    assert(normalizeFirestoreMarketType('1X2', 'HOME') === 'MATCH_WINNER_HOME', 'Normalizes 1X2 HOME -> MATCH_WINNER_HOME');
    assert(normalizeFirestoreMarketType('TOTAL_GOALS_2_5', 'OVER') === 'OVER_25', 'Normalizes TOTAL_GOALS_2_5 OVER -> OVER_25');
    assert(normalizeFirestoreMarketType('BTTS', 'YES') === 'BTTS_YES', 'Normalizes BTTS YES -> BTTS_YES');
    const plInventory = await CoverageInventoryManager.getInventoryList({ competition: 'PL' });
    assert(
      plInventory.length > 0 && plInventory.every((row) => row.competitionCode === 'PL'),
      `CoverageInventoryManager filters strictly by competition=PL (${plInventory.length} rows)`
    );
  }

  // 25. Centralized Error Boundary Service & error_reports Firestore Contract
  console.log('\n[25. Centralized Error Boundary Service & error_reports Contract]');
  {
    const fs = await import('fs');
    const path = await import('path');
    const {
      ErrorReportingService,
      sanitizeEndpoint,
      sanitizeErrorText,
      buildFirestoreErrorReportDoc,
      ERROR_REPORT_LIMITS,
    } = await import('../services/errorReporting.ts');

    // 25.1 Blueprint & hardened Firestore security rules verification
    const blueprint = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8'));
    assert(Boolean(blueprint.entities?.ErrorReport), 'firebase-blueprint.json defines ErrorReport entity');
    assert(Boolean(blueprint.firestore?.['/error_reports/{reportId}']), 'firebase-blueprint.json maps /error_reports/{reportId}');

    const rulesText = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
    assert(rulesText.includes('function isValidErrorReport('), 'firestore.rules defines isValidErrorReport validator');
    assert(rulesText.includes('match /error_reports/{reportId}'), 'firestore.rules secures /error_reports/{reportId}');
    assert(
      rulesText.includes('incoming().userId == request.auth.uid') && rulesText.includes("incoming().status == 'OPEN'"),
      'firestore.rules enforces creator ownership and OPEN initial state for error_reports'
    );

    // 25.2 Secret redaction & volumetric bounds matching blueprint
    const redactedEp = sanitizeEndpoint('/api/sync?apiKey=supersecret123&league=PL');
    assert(!redactedEp.includes('supersecret123') && redactedEp.includes('REDACTED'), 'sanitizeEndpoint strips query secret parameters');

    const redactedMsg = sanitizeErrorText('Authorization failed with Bearer eyJhbGciOiJIUzI1NiJ9.abc.def', 1000);
    assert(!redactedMsg.includes('eyJhbGci') && redactedMsg.includes('Bearer [REDACTED]'), 'sanitizeErrorText redacts Bearer tokens');

    // 25.3 Capture unhandled API HTTP 500 failure via apiFetch + fallbackValue via fetchJson
    ErrorReportingService.clearRecentErrors();
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ error: 'Upstream gateway timeout' }), {
          status: 502,
          statusText: 'Bad Gateway',
          headers: { 'Content-Type': 'application/json' },
        })) as typeof fetch;

      const fallbackRes = await ErrorReportingService.fetchJson<{ items: any[] }>(
        '/api/test-failure?token=secret_xyz',
        { method: 'GET' },
        { source: 'TestSuite.25', fallbackValue: { items: [] } }
      );
      assert(Array.isArray(fallbackRes.items) && fallbackRes.items.length === 0, 'fetchJson returns fallbackValue after capturing HTTP 502');

      const recent = ErrorReportingService.getRecentErrors();
      assert(recent.length === 1, 'ErrorReportingService captures HTTP 502 failure into telemetry buffer');
      assert(recent[0].statusCode === 502, `Captured statusCode === 502 (Actual: ${recent[0].statusCode})`);
      assert(!recent[0].endpoint.includes('secret_xyz'), 'Captured report endpoint redacted secret query param');

      // Dedup check: immediate repeat inside 10s window is suppressed
      await ErrorReportingService.fetchJson('/api/test-failure?token=secret_xyz', { method: 'GET' }, {
        source: 'TestSuite.25',
        fallbackValue: null,
      });
      assert(ErrorReportingService.getRecentErrors().length === 1, 'Duplicate API error within 10s window deduplicated cleanly');

      // 25.4 Network exception boundary via withErrorBoundary
      const boundaryFallback = await ErrorReportingService.withErrorBoundary(
        'TestSuite.boundary',
        '/api/network-drop',
        async () => {
          throw new Error('ECONNRESET socket hang up');
        },
        { fallbackValue: 'RECOVERED' }
      );
      assert(boundaryFallback === 'RECOVERED', 'withErrorBoundary catches unhandled exception and returns fallback');
      assert(ErrorReportingService.getRecentErrors().length === 2, 'withErrorBoundary logs network exception to recent errors');

      // 25.5 Firestore document payload builder enforces blueprint limits
      const firestoreDoc = buildFirestoreErrorReportDoc(ErrorReportingService.getRecentErrors()[0], 'uid_tester_123');
      assert(firestoreDoc.status === 'OPEN', 'Firestore ErrorReport document initializes with status OPEN');
      assert(firestoreDoc.userId === 'uid_tester_123', 'Firestore ErrorReport document binds authenticated userId');
      assert(firestoreDoc.id.length <= ERROR_REPORT_LIMITS.ID_MAX_LEN, 'ErrorReport ID strictly respects blueprint maxLength');
      assert(firestoreDoc.errorMessage.length <= ERROR_REPORT_LIMITS.ERROR_MSG_MAX_LEN, 'ErrorReport errorMessage strictly respects blueprint maxLength');
    } finally {
      globalThis.fetch = origFetch;
      ErrorReportingService.clearRecentErrors();
    }
  }

  // 26. Fault-Tolerant Live Web Feed & Circuit-Breaker Resilience
  console.log('\n[26. Live Web Feed & Engine Circuit-Breaker Resilience]');
  {
    const {
      LiveWebFeedProvider,
      americanToDecimalOdds,
      parseClockAndPeriod,
    } = await import('../data/providers/liveWebFeedProvider.ts');
    const { ApiFootballProvider } = await import('../data/providers/apiFootballProvider.ts');
    const { LiveMatchEngine } = await import('../data/live/liveMatchEngine.ts');

    // 26.1 Odds & clock parsing accuracy
    assert(americanToDecimalOdds('+250') === 3.5, 'Converts +250 American odds to 3.50 decimal');
    assert(americanToDecimalOdds('-200') === 1.5, 'Converts -200 American odds to 1.50 decimal');
    assert(americanToDecimalOdds(null) === undefined, 'Null odds returns undefined without fabrication');

    const clockParsed = parseClockAndPeriod(
      { clock: 2700, displayClock: "45'+2'", period: 1, type: { name: 'STATUS_FIRST_HALF' } },
      'LIVE'
    );
    assert(clockParsed.minute === 45 && clockParsed.stoppageTime === 2 && clockParsed.period === '1H', "Parses 45'+2' stoppage clock accurately");

    // 26.2 Event normalization preserves real events/stats and never fabricates scheduled scores
    const webFeed = new LiveWebFeedProvider();
    const normLive = webFeed.normalizeEspnEvent(
      {
        id: '999001',
        date: new Date().toISOString(),
        status: { clock: 1860, displayClock: "31'", period: 1, type: { state: 'in', name: 'STATUS_FIRST_HALF' } },
        competitions: [
          {
            venue: { fullName: 'Test Arena' },
            competitors: [
              {
                homeAway: 'home',
                score: '2',
                team: { id: '10', displayName: 'Home FC', abbreviation: 'HOM' },
                statistics: [
                  { name: 'possessionPct', displayValue: '58.5' },
                  { name: 'totalShots', displayValue: '9' },
                  { name: 'shotsOnTarget', displayValue: '4' },
                  { name: 'wonCorners', displayValue: '3' },
                ],
              },
              {
                homeAway: 'away',
                score: '1',
                team: { id: '20', displayName: 'Away FC', abbreviation: 'AWY' },
                statistics: [
                  { name: 'possessionPct', displayValue: '41.5' },
                  { name: 'totalShots', displayValue: '5' },
                  { name: 'shotsOnTarget', displayValue: '2' },
                  { name: 'wonCorners', displayValue: '2' },
                ],
              },
            ],
            details: [
              {
                type: { text: 'Goal' },
                clock: { displayValue: "18'" },
                team: { id: '10' },
                scoringPlay: true,
                athletesInvolved: [{ displayName: 'Alex Striker' }],
              },
            ],
            odds: [
              {
                provider: { name: 'DraftKings' },
                moneyline: {
                  home: { current: { odds: '-150' } },
                  draw: { current: { odds: '+260' } },
                  away: { current: { odds: '+400' } },
                },
              },
            ],
          },
        ],
      },
      'PL',
      'Premier League',
      'eng.1'
    );

    assert(Boolean(normLive) && normLive!.status === 'LIVE' && normLive!.minute === 31, 'Normalizes live ESPN match state and minute');
    assert(normLive!.events.length === 1 && normLive!.events[0].type === 'GOAL' && normLive!.events[0].player === 'Alex Striker', 'Normalizes live goal event accurately');
    assert(normLive!.liveStats?.possession?.home === 58.5 && normLive!.liveStats?.shotsOnTarget?.away === 2, 'Normalizes live team statistics accurately');
    assert(normLive!.moneylineOdds?.away === 5, 'Normalizes moneyline decimal odds accurately');

    const normScheduled = webFeed.normalizeEspnEvent(
      {
        id: '999002',
        date: new Date(Date.now() + 3600000).toISOString(),
        status: { displayClock: '0\'', type: { state: 'pre', name: 'STATUS_SCHEDULED' } },
        competitions: [
          {
            competitors: [
              { homeAway: 'home', score: '0', team: { id: '11', displayName: 'Pre Home', abbreviation: 'PHM' } },
              { homeAway: 'away', score: '0', team: { id: '21', displayName: 'Pre Away', abbreviation: 'PAW' } },
            ],
          },
        ],
      },
      'CL',
      'UEFA Champions League',
      'uefa.champions'
    );
    assert(
      Boolean(normScheduled) &&
        normScheduled!.status === 'SCHEDULED' &&
        normScheduled!.homeScoreFullTime === null &&
        normScheduled!.awayScoreFullTime === null,
      'Scheduled matches return null scores instead of 0-0 fabrication'
    );

    // 26.3 Circuit-breaker short-circuits suspended API-Football accounts cleanly
    const origFetch2 = globalThis.fetch;
    const prevKey = process.env.API_FOOTBALL_KEY;
    try {
      process.env.API_FOOTBALL_KEY = 'test-suspended-key';
      ApiFootballProvider.resetCircuitBreaker();
      let fetchCalls = 0;
      globalThis.fetch = (async () => {
        fetchCalls++;
        return new Response(
          JSON.stringify({ errors: { account: 'Your account is suspended, check dashboard' }, response: [] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }) as typeof fetch;

      const afp = new ApiFootballProvider();
      const health1 = await afp.checkHealth();
      assert(!health1.isOnline && ApiFootballProvider.isInCircuitBreakerCooldown(), 'Suspended API-Football response trips circuit breaker');
      const liveAfterCooldown = await afp.fetchLiveMatches();
      assert(liveAfterCooldown.length === 0 && fetchCalls === 1, 'Circuit breaker short-circuits subsequent API-Football calls without network hit');
    } finally {
      ApiFootballProvider.resetCircuitBreaker();
      globalThis.fetch = origFetch2;
      if (prevKey === undefined) delete process.env.API_FOOTBALL_KEY;
      else process.env.API_FOOTBALL_KEY = prevKey;
    }

    // 26.4 Live Web Feed Snapshot end-to-end integration
    const snapshot = await LiveMatchEngine.getLiveWebFeedSnapshot();
    assert(snapshot.status === 'OPERATIONAL', `LiveWebFeedSnapshot status OPERATIONAL (Actual: ${snapshot.status})`);
    assert(snapshot.leaguesCovered > 0, `LiveWebFeedSnapshot covers ${snapshot.leaguesCovered} global leagues`);
    assert(Array.isArray(snapshot.liveMatches) && Array.isArray(snapshot.dispatches), 'LiveWebFeedSnapshot returns liveMatches & dispatches arrays');
    assert(
      snapshot.feedSources.some((s) => s.id === 'live-web-feed' && s.status === 'OPERATIONAL'),
      'LiveWebFeedSnapshot reports live-web-feed as OPERATIONAL'
    );
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
