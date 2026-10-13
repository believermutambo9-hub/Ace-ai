import { NormalizedMatch } from '../contracts/provider.interface.ts';

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
}

export class DataValidator {
  /**
   * Validate integrity of match information before persisting to database
   */
  public static validateMatch(match: NormalizedMatch): ValidationResult {
    const errors: string[] = [];

    if (!match.externalId) {
      errors.push('Match externalId is missing');
    }
    if (!match.homeTeamRawName || match.homeTeamRawName.trim().length === 0) {
      errors.push('Home team name is empty');
    }
    if (!match.awayTeamRawName || match.awayTeamRawName.trim().length === 0) {
      errors.push('Away team name is empty');
    }
    if (match.homeTeamRawName.toLowerCase() === match.awayTeamRawName.toLowerCase()) {
      errors.push(`Home and Away teams are identical: "${match.homeTeamRawName}"`);
    }
    if (isNaN(match.kickoffTime.getTime())) {
      errors.push('Invalid kickoff timestamp');
    }

    if (match.status === 'FINISHED') {
      if (match.homeScoreFullTime === undefined || match.homeScoreFullTime === null) {
        errors.push('Finished match missing homeScoreFullTime');
      } else if (match.homeScoreFullTime < 0) {
        errors.push(`Negative home score: ${match.homeScoreFullTime}`);
      }

      if (match.awayScoreFullTime === undefined || match.awayScoreFullTime === null) {
        errors.push('Finished match missing awayScoreFullTime');
      } else if (match.awayScoreFullTime < 0) {
        errors.push(`Negative away score: ${match.awayScoreFullTime}`);
      }

      if (match.homeScoreHalfTime !== undefined && match.homeScoreHalfTime !== null && match.homeScoreHalfTime < 0) {
        errors.push(`Negative home half-time score: ${match.homeScoreHalfTime}`);
      }
      if (match.awayScoreHalfTime !== undefined && match.awayScoreHalfTime !== null && match.awayScoreHalfTime < 0) {
        errors.push(`Negative away half-time score: ${match.awayScoreHalfTime}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate numerical probability bounds (1X2 sum equals approx 1.0 within numerical tolerance)
   */
  public static validateProbabilities(homeProb: number, drawProb: number, awayProb: number, tolerance = 0.005): boolean {
    if (homeProb < 0 || homeProb > 1) return false;
    if (drawProb < 0 || drawProb > 1) return false;
    if (awayProb < 0 || awayProb > 1) return false;

    const sum = homeProb + drawProb + awayProb;
    return Math.abs(sum - 1.0) <= tolerance;
  }
}
