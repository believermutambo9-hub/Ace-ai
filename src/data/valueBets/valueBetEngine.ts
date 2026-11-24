// Value Bet & Kelly Criterion Quantitative Engine
// CRITICAL INTEGRITY: Never fabricates bookmaker odds or generates synthetic market prices from probabilities.
// Real market quotes are kept strictly separated from theoretical model fair prices.
// Browser and Client-Bundle Safe: Zero database driver imports (pg, drizzle, etc.)

import type { UpcomingMatchItem } from '../../types/football.ts';

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

  // Strict separation of genuine market odds vs unquoted
  hasRealMarketOdds: boolean;
  bookmakerOdds: number | null; // Real market price or null
  bookmakerName: string | null; // e.g., 'Bet365', 'Pinnacle', 'Consensus'
  impliedMarketProb: number | null; // 1 / bookmakerOdds or null
  edgePercent: number | null; // (modelProbability * bookmakerOdds - 1) * 100 or null
  expectedValueUnit: number | null; // (modelProbability * (bookmakerOdds - 1)) - (1 - modelProbability) or null
  kellyStakeFraction: number | null; // Full Kelly fraction f* or null
  halfKellyPercent: number | null; // f* / 2 * 100 or null
  quarterKellyPercent: number | null; // f* / 4 * 100 or null

  confidenceScore: number;
  dataQuality: string;
  marketStatus: 'VERIFIED_MARKET_ODDS' | 'UNQUOTED_THEORETICAL_ONLY';
  marketStatusNote: string;
}

export interface RealOddsQuote {
  odds: number;
  bookmaker: string;
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
 * Calculates full Kelly fraction: (b * p - q) / b
 * where b = odds - 1, p = model prob, q = 1 - p
 * Safely handles invalid or negative bounds.
 */
export function calculateKellyFraction(modelProb: number, odds: number): number {
  if (odds <= 1 || modelProb <= 0 || modelProb >= 1) return 0;
  const b = odds - 1;
  const q = 1 - modelProb;
  const f = (b * modelProb - q) / b;
  // Clamp between 0 and 0.15 (15% max single wager for bankroll preservation)
  return Math.max(0, Math.min(0.15, f));
}

/**
 * Extracts and scans value opportunities from upcoming fixtures.
 * CRITICAL RULE: If genuine market odds are not present in realOddsMap,
 * it sets bookmakerOdds: null and marketStatus: 'UNQUOTED_THEORETICAL_ONLY'.
 * It NEVER derives simulated bookmaker odds from model probabilities.
 */
export function scanValueBetsFromMatches(
  matches: UpcomingMatchItem[],
  realOddsMap?: Map<string, RealOddsQuote>,
  includeUnquotedTheoretical: boolean = true
): MarketOpportunity[] {
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
    }> = [
      { marketType: '1X2', selection: 'HOME', selectionLabel: `${match.homeTeam} to Win`, prob: homeWinP },
      { marketType: '1X2', selection: 'DRAW', selectionLabel: 'Draw', prob: drawP },
      { marketType: '1X2', selection: 'AWAY', selectionLabel: `${match.awayTeam} to Win`, prob: awayWinP },
      { marketType: 'TOTAL_GOALS_2_5', selection: 'OVER', selectionLabel: 'Over 2.5 Goals', prob: over25Prob },
      { marketType: 'TOTAL_GOALS_2_5', selection: 'UNDER', selectionLabel: 'Under 2.5 Goals', prob: under25Prob },
      { marketType: 'BTTS', selection: 'YES', selectionLabel: 'Both Teams to Score - Yes', prob: bttsYesProb },
      { marketType: 'BTTS', selection: 'NO', selectionLabel: 'Both Teams to Score - No', prob: bttsNoProb },
      { marketType: 'DOUBLE_CHANCE', selection: '1X', selectionLabel: `${match.homeTeam} or Draw (1X)`, prob: dc1XProb },
      { marketType: 'DOUBLE_CHANCE', selection: 'X2', selectionLabel: `Draw or ${match.awayTeam} (X2)`, prob: dcX2Prob },
    ];

    for (const prop of propositions) {
      if (prop.prob <= 0.08) continue; // Skip near-zero events

      const modelFairOdds = Math.round((1 / prop.prob) * 100) / 100;
      const lookupKey = `${match.id}:${prop.marketType}:${prop.selection}`;
      const realQuote = realOddsMap?.get(lookupKey);

      if (realQuote && realQuote.odds > 1.0) {
        // Genuine bookmaker odds are verified
        const bookmakerOdds = Math.round(realQuote.odds * 100) / 100;
        const impliedMarketProb = Math.round((1 / bookmakerOdds) * 1000) / 1000;
        const ev = prop.prob * (bookmakerOdds - 1) - (1 - prop.prob);
        const edge = (prop.prob * bookmakerOdds - 1) * 100;
        const fullKelly = edge > 0 ? calculateKellyFraction(prop.prob, bookmakerOdds) : 0;

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
          hasRealMarketOdds: true,
          bookmakerOdds,
          bookmakerName: realQuote.bookmaker,
          impliedMarketProb,
          edgePercent: Math.round(edge * 10) / 10,
          expectedValueUnit: Math.round(ev * 1000) / 1000,
          kellyStakeFraction: Math.round(fullKelly * 1000) / 1000,
          halfKellyPercent: Math.round((fullKelly / 2) * 1000) / 10,
          quarterKellyPercent: Math.round((fullKelly / 4) * 1000) / 10,
          confidenceScore,
          dataQuality: dataQuality?.rating || 'GOOD',
          marketStatus: 'VERIFIED_MARKET_ODDS',
          marketStatusNote: `Verified ${realQuote.bookmaker} quote: ${bookmakerOdds.toFixed(2)} (Fair: ${modelFairOdds.toFixed(2)})`,
        });
      } else if (includeUnquotedTheoretical) {
        // Market odds unquoted: Expose theoretical model fair odds with strict nulls on market prices
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
          hasRealMarketOdds: false,
          bookmakerOdds: null,
          bookmakerName: null,
          impliedMarketProb: null,
          edgePercent: null,
          expectedValueUnit: null,
          kellyStakeFraction: null,
          halfKellyPercent: null,
          quarterKellyPercent: null,
          confidenceScore,
          dataQuality: dataQuality?.rating || 'GOOD',
          marketStatus: 'UNQUOTED_THEORETICAL_ONLY',
          marketStatusNote:
            'Market odds unquoted. Theoretical model fair price shown for analytical reference only; market EV cannot be claimed without verified bookmaker odds.',
        });
      }
    }
  }

  // Sort: verified positive edge first (descending), then unquoted by highest model probability
  return opportunities.sort((a, b) => {
    if (a.hasRealMarketOdds && b.hasRealMarketOdds) {
      return (b.edgePercent || 0) - (a.edgePercent || 0);
    }
    if (a.hasRealMarketOdds && !b.hasRealMarketOdds) return -1;
    if (!a.hasRealMarketOdds && b.hasRealMarketOdds) return 1;
    return b.modelProbability - a.modelProbability;
  });
}
