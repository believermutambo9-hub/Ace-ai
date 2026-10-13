/**
 * Monte Carlo Football Match Simulation Engine
 * Simulates N matches (default 5,000 to 10,000) using bivariate Poisson goal rates
 * and Dixon-Coles correlation adjustments to generate empirical probability distributions.
 */

export interface MonteCarloConfig {
  simulationsCount: number;
  homeLambda: number;
  awayMu: number;
  dixonColesRho?: number;
}

export interface MonteCarloResult {
  simulationsCount: number;
  probabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  expectedGoals: {
    home: number;
    away: number;
    total: number;
  };
  goalDistributions: {
    home: Record<number, number>;
    away: Record<number, number>;
    total: Record<number, number>;
  };
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
  topScores: Array<{
    score: string;
    count: number;
    probability: number;
  }>;
}

export class MonteCarloSimulator {
  /**
   * Sample Poisson distributed random integer using Knuth's algorithm
   */
  public static samplePoisson(lambda: number): number {
    if (lambda <= 0) return 0;
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1.0;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }

  /**
   * Execute N Monte Carlo simulations of the fixture
   */
  public static simulateMatch(config: MonteCarloConfig): MonteCarloResult {
    const N = Math.max(500, Math.min(20000, config.simulationsCount || 5000));
    const { homeLambda, awayMu, dixonColesRho = -0.06 } = config;

    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    let totalHomeGoals = 0;
    let totalAwayGoals = 0;

    let over15Count = 0;
    let over25Count = 0;
    let over35Count = 0;
    let bttsCount = 0;

    const scoreCounts = new Map<string, number>();
    const homeGoalsDist: Record<number, number> = {};
    const awayGoalsDist: Record<number, number> = {};
    const totalGoalsDist: Record<number, number> = {};

    for (let i = 0; i < N; i++) {
      let homeGoals = this.samplePoisson(homeLambda);
      let awayGoals = this.samplePoisson(awayMu);

      // Apply Dixon-Coles adjustment for low scores (0-0, 1-0, 0-1, 1-1)
      if (homeGoals <= 1 && awayGoals <= 1 && Math.random() < Math.abs(dixonColesRho)) {
        if (dixonColesRho < 0) {
          // Negative correlation: reduce 0-0 and 1-1, boost 1-0 and 0-1
          if (homeGoals === awayGoals && Math.random() < 0.3) {
            if (Math.random() > 0.5) homeGoals++;
            else awayGoals++;
          }
        }
      }

      totalHomeGoals += homeGoals;
      totalAwayGoals += awayGoals;
      const matchTotal = homeGoals + awayGoals;

      // 1X2 outcomes
      if (homeGoals > awayGoals) homeWins++;
      else if (homeGoals === awayGoals) draws++;
      else awayWins++;

      // Markets
      if (matchTotal > 1.5) over15Count++;
      if (matchTotal > 2.5) over25Count++;
      if (matchTotal > 3.5) over35Count++;
      if (homeGoals > 0 && awayGoals > 0) bttsCount++;

      // Tally distributions
      homeGoalsDist[homeGoals] = (homeGoalsDist[homeGoals] || 0) + 1;
      awayGoalsDist[awayGoals] = (awayGoalsDist[awayGoals] || 0) + 1;
      totalGoalsDist[matchTotal] = (totalGoalsDist[matchTotal] || 0) + 1;

      const scoreKey = `${homeGoals}-${awayGoals}`;
      scoreCounts.set(scoreKey, (scoreCounts.get(scoreKey) || 0) + 1);
    }

    // Sort score occurrences descending
    const sortedScores = Array.from(scoreCounts.entries())
      .map(([score, count]) => ({
        score,
        count,
        probability: Number((count / N).toFixed(4)),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      simulationsCount: N,
      probabilities: {
        homeWin: Number((homeWins / N).toFixed(4)),
        draw: Number((draws / N).toFixed(4)),
        awayWin: Number((awayWins / N).toFixed(4)),
      },
      expectedGoals: {
        home: Number((totalHomeGoals / N).toFixed(2)),
        away: Number((totalAwayGoals / N).toFixed(2)),
        total: Number(((totalHomeGoals + totalAwayGoals) / N).toFixed(2)),
      },
      goalDistributions: {
        home: homeGoalsDist,
        away: awayGoalsDist,
        total: totalGoalsDist,
      },
      markets: {
        over15: Number((over15Count / N).toFixed(4)),
        under15: Number((1 - over15Count / N).toFixed(4)),
        over25: Number((over25Count / N).toFixed(4)),
        under25: Number((1 - over25Count / N).toFixed(4)),
        over35: Number((over35Count / N).toFixed(4)),
        under35: Number((1 - over35Count / N).toFixed(4)),
        bttsYes: Number((bttsCount / N).toFixed(4)),
        bttsNo: Number((1 - bttsCount / N).toFixed(4)),
      },
      topScores: sortedScores.slice(0, 6),
    };
  }
}
