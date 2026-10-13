// Value Bet & Kelly Criterion Quantitative Engine
import { UpcomingMatchItem } from '../upcoming/upcomingEngine.ts';

export interface MarketOpportunity {
  id: string;
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffTime: string;
  marketType: '1X2' | 'TOTAL_GOALS_2_5' | 'BTTS' | 'DOUBLE_CHANCE';
  selection: string;
  selectionLabel: string;
  modelProbability: number; // e.g. 0.62 (62%)
  modelFairOdds: number; // 1 / probability e.g. 1.61
  bookmakerOdds: number; // e.g. 1.85
  impliedMarketProb: number; // 1 / bookmakerOdds e.g. 0.54
  edgePercent: number; // (modelProbability * bookmakerOdds - 1) * 100
  expectedValueUnit: number; // (modelProbability * (bookmakerOdds - 1)) - (1 - modelProbability)
  kellyStakeFraction: number; // Full Kelly fraction f*
  halfKellyPercent: number; // f* / 2 * 100
  quarterKellyPercent: number; // f* / 4 * 100
  confidenceScore: number;
  dataQuality: string;
}

/**
 * Computes Poisson probability for exact score (h, a)
 */
function poissonProb(k: number, lambda: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function factorial(n: number): number {
  if (n <= 1) return 1;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/**
 * Calculates synthetic consensus bookmaker odds with realistic 5.5% margin (overround)
 */
function deriveConsensusOdds(prob: number, overround: number = 1.055): number {
  const adjustedProb = prob * overround;
  const rawOdds = 1 / Math.max(0.01, Math.min(0.99, adjustedProb));
  return Math.round(rawOdds * 100) / 100;
}

/**
 * Calculates full Kelly fraction: (b * p - q) / b
 * where b = odds - 1, p = model prob, q = 1 - p
 */
export function calculateKellyFraction(modelProb: number, odds: number): number {
  if (odds <= 1 || modelProb <= 0) return 0;
  const b = odds - 1;
  const q = 1 - modelProb;
  const f = (b * modelProb - q) / b;
  // Clamp between 0 and 0.15 (15% max single wager for risk safety)
  return Math.max(0, Math.min(0.15, f));
}

/**
 * Extracts and scans value opportunities from upcoming fixtures
 */
export function scanValueBetsFromMatches(matches: UpcomingMatchItem[]): MarketOpportunity[] {
  const opportunities: MarketOpportunity[] = [];

  for (const match of matches) {
    if (!match.prediction) continue;

    const { probabilities, expectedGoals, confidenceScore, dataQuality } = match.prediction;
    const homeWinP = probabilities.homeWin;
    const drawP = probabilities.draw;
    const awayWinP = probabilities.awayWin;
    const lambdaHome = Math.max(0.3, expectedGoals.home || 1.4);
    const muAway = Math.max(0.3, expectedGoals.away || 1.1);

    // 1. Calculate Over / Under 2.5 goals via bivariate Poisson grid
    let under25Prob = 0;
    for (let h = 0; h <= 2; h++) {
      for (let a = 0; a <= 2 - h; a++) {
        under25Prob += poissonProb(h, lambdaHome) * poissonProb(a, muAway);
      }
    }
    under25Prob = Math.max(0.05, Math.min(0.95, under25Prob));
    const over25Prob = Math.max(0.05, Math.min(0.95, 1 - under25Prob));

    // 2. Both Teams To Score (BTTS)
    const probHomeScoreAtLeast1 = 1 - Math.exp(-lambdaHome);
    const probAwayScoreAtLeast1 = 1 - Math.exp(-muAway);
    const bttsYesProb = Math.max(0.05, Math.min(0.95, probHomeScoreAtLeast1 * probAwayScoreAtLeast1));
    const bttsNoProb = Math.max(0.05, Math.min(0.95, 1 - bttsYesProb));

    // 3. Double Chance
    const dc1XProb = Math.min(0.98, homeWinP + drawP);
    const dcX2Prob = Math.min(0.98, drawP + awayWinP);

    // List of candidate betting propositions
    const propositions: Array<{
      marketType: MarketOpportunity['marketType'];
      selection: string;
      selectionLabel: string;
      prob: number;
      syntheticMarketBoost: number; // simulates slight market bias (fading draws or away underdog)
    }> = [
      { marketType: '1X2', selection: 'HOME', selectionLabel: `${match.homeTeam} to Win`, prob: homeWinP, syntheticMarketBoost: 0.96 },
      { marketType: '1X2', selection: 'DRAW', selectionLabel: 'Draw', prob: drawP, syntheticMarketBoost: 1.05 },
      { marketType: '1X2', selection: 'AWAY', selectionLabel: `${match.awayTeam} to Win`, prob: awayWinP, syntheticMarketBoost: 1.08 },
      { marketType: 'TOTAL_GOALS_2_5', selection: 'OVER', selectionLabel: 'Over 2.5 Goals', prob: over25Prob, syntheticMarketBoost: 1.04 },
      { marketType: 'TOTAL_GOALS_2_5', selection: 'UNDER', selectionLabel: 'Under 2.5 Goals', prob: under25Prob, syntheticMarketBoost: 1.03 },
      { marketType: 'BTTS', selection: 'YES', selectionLabel: 'Both Teams to Score - Yes', prob: bttsYesProb, syntheticMarketBoost: 1.05 },
      { marketType: 'BTTS', selection: 'NO', selectionLabel: 'Both Teams to Score - No', prob: bttsNoProb, syntheticMarketBoost: 1.02 },
      { marketType: 'DOUBLE_CHANCE', selection: '1X', selectionLabel: `${match.homeTeam} or Draw (1X)`, prob: dc1XProb, syntheticMarketBoost: 1.03 },
      { marketType: 'DOUBLE_CHANCE', selection: 'X2', selectionLabel: `Draw or ${match.awayTeam} (X2)`, prob: dcX2Prob, syntheticMarketBoost: 1.06 },
    ];

    for (const prop of propositions) {
      if (prop.prob <= 0.08) continue; // Skip near-zero events

      const modelFairOdds = Math.round((1 / prop.prob) * 100) / 100;
      // Bookmaker odds with realistic market variance:
      // When market price is higher than model fair odds, it represents positive EV
      const bookmakerOdds = deriveConsensusOdds(prop.prob * prop.syntheticMarketBoost, 1.03);

      const impliedMarketProb = Math.round((1 / bookmakerOdds) * 1000) / 1000;
      const ev = (prop.prob * (bookmakerOdds - 1)) - (1 - prop.prob);
      const edge = (prop.prob * bookmakerOdds - 1) * 100;

      // Only include if Edge > 0% (Positive Expected Value)
      if (edge > 0.5) {
        const fullKelly = calculateKellyFraction(prop.prob, bookmakerOdds);

        opportunities.push({
          id: `${match.id}-${prop.marketType}-${prop.selection}`,
          matchId: match.id,
          homeTeam: match.homeTeam,
          awayTeam: match.awayTeam,
          competition: match.competitionName,
          kickoffTime: match.kickoffTime,
          marketType: prop.marketType,
          selection: prop.selection,
          selectionLabel: prop.selectionLabel,
          modelProbability: Math.round(prop.prob * 1000) / 1000,
          modelFairOdds,
          bookmakerOdds,
          impliedMarketProb,
          edgePercent: Math.round(edge * 10) / 10,
          expectedValueUnit: Math.round(ev * 1000) / 1000,
          kellyStakeFraction: Math.round(fullKelly * 1000) / 1000,
          halfKellyPercent: Math.round((fullKelly / 2) * 1000) / 10,
          quarterKellyPercent: Math.round((fullKelly / 4) * 1000) / 10,
          confidenceScore,
          dataQuality: dataQuality?.rating || 'GOOD',
        });
      }
    }
  }

  // Sort by highest Edge descending
  return opportunities.sort((a, b) => b.edgePercent - a.edgePercent);
}
