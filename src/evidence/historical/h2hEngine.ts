import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { matches, matchStatistics } from '../../db/schema.ts';

export interface H2HSummary {
  directH2HFound: boolean;
  totalH2HMatches: number;
  homeWins: number;
  draws: number;
  awayWins: number;
  avgHomeGoals: number;
  avgAwayGoals: number;
  recentMeetings: Array<{
    date: Date;
    homeScore: number;
    awayScore: number;
    homeTeamId: number;
    awayTeamId: number;
  }>;
}

export interface TeamFormMetric {
  teamId: number;
  sampleMatches: number;
  formString: string;
  pointsPerGame: number;
  goalsScoredAvg: number;
  goalsConcededAvg: number;
  cleanSheetRate: number;
  exponentialFormIndex: number; // Decayed score where recent matches have 3x weight of older matches
  venueSpecificWinRate: number;
}

export class HistoricalEvidenceEngine {
  /**
   * Extract Direct Head-to-Head record between two teams
   */
  public static async getH2HRecord(teamAId: number, teamBId: number): Promise<H2HSummary> {
    const directMatches = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.status, 'FINISHED'),
          or(
            and(eq(matches.homeTeamId, teamAId), eq(matches.awayTeamId, teamBId)),
            and(eq(matches.homeTeamId, teamBId), eq(matches.awayTeamId, teamAId))
          )
        )
      )
      .orderBy(desc(matches.kickoffTime))
      .limit(10);

    if (directMatches.length === 0) {
      return {
        directH2HFound: false,
        totalH2HMatches: 0,
        homeWins: 0,
        draws: 0,
        awayWins: 0,
        avgHomeGoals: 0,
        avgAwayGoals: 0,
        recentMeetings: [],
      };
    }

    let aWins = 0;
    let bWins = 0;
    let draws = 0;
    let totalAGoals = 0;
    let totalBGoals = 0;

    const meetings = directMatches.map((m) => {
      const hGoals = m.homeScoreFullTime ?? 0;
      const aGoals = m.awayScoreFullTime ?? 0;

      const isAHome = m.homeTeamId === teamAId;
      const aScore = isAHome ? hGoals : aGoals;
      const bScore = isAHome ? aGoals : hGoals;

      totalAGoals += aScore;
      totalBGoals += bScore;

      if (aScore > bScore) aWins++;
      else if (bScore > aScore) bWins++;
      else draws++;

      return {
        date: m.kickoffTime,
        homeScore: hGoals,
        awayScore: aGoals,
        homeTeamId: m.homeTeamId,
        awayTeamId: m.awayTeamId,
      };
    });

    const N = directMatches.length;
    return {
      directH2HFound: true,
      totalH2HMatches: N,
      homeWins: aWins,
      draws,
      awayWins: bWins,
      avgHomeGoals: Number((totalAGoals / N).toFixed(2)),
      avgAwayGoals: Number((totalBGoals / N).toFixed(2)),
      recentMeetings: meetings,
    };
  }

  /**
   * Calculate detailed exponential-decay form for a team (last 10 matches)
   */
  public static async getTeamForm(teamId: number, isHomeVenue: boolean): Promise<TeamFormMetric> {
    const recent = await db
      .select()
      .from(matches)
      .where(
        and(
          eq(matches.status, 'FINISHED'),
          or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId))
        )
      )
      .orderBy(desc(matches.kickoffTime))
      .limit(10);

    if (recent.length === 0) {
      return {
        teamId,
        sampleMatches: 0,
        formString: '-----',
        pointsPerGame: 1.35,
        goalsScoredAvg: 1.3,
        goalsConcededAvg: 1.3,
        cleanSheetRate: 0.25,
        exponentialFormIndex: 50.0,
        venueSpecificWinRate: isHomeVenue ? 0.45 : 0.32,
      };
    }

    let points = 0;
    let scored = 0;
    let conceded = 0;
    let cleanSheets = 0;
    let formChars: string[] = [];
    let decayedScore = 0;
    let totalWeight = 0;

    let venueMatches = 0;
    let venueWins = 0;

    recent.forEach((m, idx) => {
      const isHome = m.homeTeamId === teamId;
      const teamGoals = isHome ? (m.homeScoreFullTime ?? 0) : (m.awayScoreFullTime ?? 0);
      const oppGoals = isHome ? (m.awayScoreFullTime ?? 0) : (m.homeScoreFullTime ?? 0);

      scored += teamGoals;
      conceded += oppGoals;
      if (oppGoals === 0) cleanSheets++;

      let matchPts = 1;
      let char = 'D';
      if (teamGoals > oppGoals) {
        matchPts = 3;
        char = 'W';
      } else if (teamGoals < oppGoals) {
        matchPts = 0;
        char = 'L';
      }

      points += matchPts;
      formChars.push(char);

      // Exponential decay: most recent has weight 1.0, 10th has weight 0.25
      const decayWeight = Math.exp(-0.15 * idx);
      decayedScore += (matchPts / 3) * 100 * decayWeight;
      totalWeight += decayWeight;

      if (isHome === isHomeVenue) {
        venueMatches++;
        if (teamGoals > oppGoals) venueWins++;
      }
    });

    const N = recent.length;
    return {
      teamId,
      sampleMatches: N,
      formString: formChars.slice(0, 5).join(''),
      pointsPerGame: Number((points / N).toFixed(2)),
      goalsScoredAvg: Number((scored / N).toFixed(2)),
      goalsConcededAvg: Number((conceded / N).toFixed(2)),
      cleanSheetRate: Number((cleanSheets / N).toFixed(2)),
      exponentialFormIndex: Number((decayedScore / totalWeight).toFixed(1)),
      venueSpecificWinRate: venueMatches > 0 ? Number((venueWins / venueMatches).toFixed(2)) : (isHomeVenue ? 0.48 : 0.30),
    };
  }
}
