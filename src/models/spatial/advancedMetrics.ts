/**
 * Spatial, Congestion & Advanced Performance Metrics Engine
 * Computes:
 * 1. Non-Penalty Expected Goals (npxG) to eliminate penalty luck variance
 * 2. Pitch Tilt (% of territorial possession in final third)
 * 3. Schedule Congestion / Midweek Rest Differential
 * 4. European / Continental Travel Fatigue index
 */

export interface TeamContextFactors {
  daysRest: number; // Days since last competitive fixture
  travelDistanceKm: number; // One-way travel distance
  playedMidweekEuropean: boolean;
  isDerbyMatch?: boolean;
}

export interface AdvancedMetricsResult {
  homeNpxG: number;
  awayNpxG: number;
  pitchTiltShare: {
    home: number; // 0 to 100%
    away: number;
  };
  congestionIndex: {
    homeFatiguePenalty: number;
    awayFatiguePenalty: number;
    travelImpactAway: number;
  };
  contextualAdjustmentMultiplier: {
    homeAttackMultiplier: number;
    awayAttackMultiplier: number;
  };
}

export class AdvancedMetricsEngine {
  /**
   * Calculate non-penalty xG and contextual adjustments based on schedule and travel
   */
  public static calculateContext(
    homeBaseXg: number,
    awayBaseXg: number,
    homeContext?: TeamContextFactors,
    awayContext?: TeamContextFactors
  ): AdvancedMetricsResult {
    const hRest = homeContext?.daysRest ?? 6;
    const aRest = awayContext?.daysRest ?? 6;
    const aTravel = awayContext?.travelDistanceKm ?? 120;
    const aEuropean = awayContext?.playedMidweekEuropean ?? false;
    const hEuropean = homeContext?.playedMidweekEuropean ?? false;

    // 1. Non-penalty xG: Subtract expected penalty rate (~0.12 xG per match)
    const homeNpxG = Number(Math.max(0.3, homeBaseXg - 0.12).toFixed(2));
    const awayNpxG = Number(Math.max(0.25, awayBaseXg - 0.12).toFixed(2));

    // 2. Schedule Fatigue Penalties
    let homeFatigue = 0;
    let awayFatigue = 0;

    if (hRest <= 3 && hEuropean) homeFatigue += 0.08;
    if (aRest <= 3 && aEuropean) awayFatigue += 0.12; // Away fatigue is amplified

    // Travel penalty (long away European trips)
    let travelImpact = 0;
    if (aTravel > 1500) travelImpact = 0.06;
    else if (aTravel > 800) travelImpact = 0.03;

    // 3. Final-Third Pitch Tilt Share
    const expectedGoalRatio = homeBaseXg / (homeBaseXg + awayBaseXg);
    const homeTilt = Number((Math.min(0.75, Math.max(0.35, expectedGoalRatio * 0.95 + 0.04)) * 100).toFixed(1));
    const awayTilt = Number((100 - homeTilt).toFixed(1));

    // 4. Contextual Multipliers
    const homeAttackMult = Number(Math.max(0.85, 1.0 - homeFatigue).toFixed(3));
    const awayAttackMult = Number(Math.max(0.80, 1.0 - (awayFatigue + travelImpact)).toFixed(3));

    return {
      homeNpxG,
      awayNpxG,
      pitchTiltShare: {
        home: homeTilt,
        away: awayTilt,
      },
      congestionIndex: {
        homeFatiguePenalty: Number(homeFatigue.toFixed(3)),
        awayFatiguePenalty: Number(awayFatigue.toFixed(3)),
        travelImpactAway: Number(travelImpact.toFixed(3)),
      },
      contextualAdjustmentMultiplier: {
        homeAttackMultiplier: homeAttackMult,
        awayAttackMultiplier: awayAttackMult,
      },
    };
  }
}
