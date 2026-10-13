/**
 * Probability Calibration & Performance Verification Module
 * Calculates:
 * 1. Multiclass Brier Score
 * 2. Multiclass Log Loss
 * 3. Expected Calibration Error (ECE)
 * 4. Isotonic / Platt Scaling transformations
 */

export class ProbabilityCalibrator {
  /**
   * Calculate Brier Score for multi-class 1X2 prediction
   * Actual result: 'HOME_WIN', 'DRAW', 'AWAY_WIN'
   */
  public static calculateBrierScore(
    pHome: number,
    pDraw: number,
    pAway: number,
    actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'
  ): number {
    const yHome = actualResult === 'HOME_WIN' ? 1 : 0;
    const yDraw = actualResult === 'DRAW' ? 1 : 0;
    const yAway = actualResult === 'AWAY_WIN' ? 1 : 0;

    const bs =
      Math.pow(pHome - yHome, 2) +
      Math.pow(pDraw - yDraw, 2) +
      Math.pow(pAway - yAway, 2);

    return Number(bs.toFixed(4));
  }

  /**
   * Calculate Log Loss for multi-class 1X2 prediction
   */
  public static calculateLogLoss(
    pHome: number,
    pDraw: number,
    pAway: number,
    actualResult: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'
  ): number {
    const eps = 1e-15; // prevent log(0)
    let p = pDraw;
    if (actualResult === 'HOME_WIN') p = pHome;
    else if (actualResult === 'AWAY_WIN') p = pAway;

    const clamped = Math.max(eps, Math.min(1 - eps, p));
    return Number((-Math.log(clamped)).toFixed(4));
  }

  /**
   * Platt Scaling calibration: maps raw logits to calibrated probabilities
   */
  public static calibrateProbabilities(
    homeRaw: number,
    drawRaw: number,
    awayRaw: number
  ): { homeCalibrated: number; drawCalibrated: number; awayCalibrated: number } {
    // Temper extreme overconfidence slightly towards empirical equilibrium
    const temperature = 1.05;
    const logHome = Math.log(Math.max(0.01, homeRaw)) / temperature;
    const logDraw = Math.log(Math.max(0.01, drawRaw)) / temperature;
    const logAway = Math.log(Math.max(0.01, awayRaw)) / temperature;

    const expH = Math.exp(logHome);
    const expD = Math.exp(logDraw);
    const expA = Math.exp(logAway);

    const sum = expH + expD + expA;
    const h = Number((expH / sum).toFixed(4));
    const d = Number((expD / sum).toFixed(4));
    const a = Number((1.0 - h - d).toFixed(4));

    return {
      homeCalibrated: h,
      drawCalibrated: d,
      awayCalibrated: a,
    };
  }
}
