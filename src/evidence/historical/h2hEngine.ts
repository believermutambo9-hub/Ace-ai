import { and, desc, eq, lt, lte, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { matches, teamRatings } from '../../db/schema.ts';

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
  exponentialFormIndex: number; // Decayed score where recent matches have higher weight than older matches
  venueSpecificWinRate: number;
}

export interface EffectiveTeamRating {
  teamId: number;
  overallElo: number;
  attackRating: number;
  defenseRating: number;
  homeAdvantage: number;
  matchesPlayed: number;
  isFromComputedHistory: boolean;
  isBaselineDefault: boolean;
}

export class HistoricalEvidenceEngine {
  /**
   * Extract Direct Head-to-Head record between two teams with date-aware cutoff
   */
  public static async getH2HRecord(teamAId: number, teamBId: number, asOfDate?: Date): Promise<H2HSummary> {
    const conditions = [
      eq(matches.status, 'FINISHED'),
      or(
        and(eq(matches.homeTeamId, teamAId), eq(matches.awayTeamId, teamBId)),
        and(eq(matches.homeTeamId, teamBId), eq(matches.awayTeamId, teamAId))
      ),
    ];

    if (asOfDate) {
      conditions.push(lt(matches.kickoffTime, asOfDate));
    }

    const directMatches = await db
      .select()
      .from(matches)
      .where(and(...conditions))
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
   * Calculate detailed exponential-decay form for a team (last 10 matches) with date-aware cutoff
   */
  public static async getTeamForm(teamId: number, isHomeVenue: boolean, asOfDate?: Date): Promise<TeamFormMetric> {
    const conditions = [
      eq(matches.status, 'FINISHED'),
      or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)),
    ];

    if (asOfDate) {
      conditions.push(lt(matches.kickoffTime, asOfDate));
    }

    const recent = await db
      .select()
      .from(matches)
      .where(and(...conditions))
      .orderBy(desc(matches.kickoffTime))
      .limit(10);

    if (recent.length === 0) {
      return {
        teamId,
        sampleMatches: 0,
        formString: '-----',
        pointsPerGame: 0,
        goalsScoredAvg: 0,
        goalsConcededAvg: 0,
        cleanSheetRate: 0,
        exponentialFormIndex: 0,
        venueSpecificWinRate: 0,
      };
    }

    let points = 0;
    let scored = 0;
    let conceded = 0;
    let cleanSheets = 0;
    const formChars: string[] = [];
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

      // Exponential decay: most recent has weight 1.0, 10th has weight ~0.26
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
      venueSpecificWinRate: venueMatches > 0 ? Number((venueWins / venueMatches).toFixed(2)) : 0,
    };
  }

  /**
   * Resolve a team's pre-match rating from stored team_ratings (if non-default) or
   * compute directly from genuine finished matches strictly prior to asOfDate.
   */
  public static async getEffectiveTeamRating(teamId: number, asOfDate?: Date): Promise<EffectiveTeamRating> {
    if (!teamId || teamId <= 0) {
      return {
        teamId: teamId || 0,
        overallElo: 1500,
        attackRating: 100,
        defenseRating: 100,
        homeAdvantage: 65,
        matchesPlayed: 0,
        isFromComputedHistory: false,
        isBaselineDefault: true,
      };
    }

    const ratingConditions = [eq(teamRatings.teamId, teamId)];
    if (asOfDate) {
      ratingConditions.push(lte(teamRatings.ratingTimestamp, asOfDate));
    }

    const [storedRating] = await db
      .select()
      .from(teamRatings)
      .where(and(...ratingConditions))
      .orderBy(desc(teamRatings.ratingTimestamp))
      .limit(1);

    const hasNonDefaultStored =
      storedRating &&
      (Math.abs(storedRating.overallElo - 1500) > 0.05 ||
        Math.abs(storedRating.attackRating - 100) > 0.05 ||
        Math.abs(storedRating.defenseRating - 100) > 0.05);

    const historyConditions = [
      eq(matches.status, 'FINISHED'),
      or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId)),
    ];
    if (asOfDate) {
      historyConditions.push(lt(matches.kickoffTime, asOfDate));
    }

    const history = await db
      .select({
        kickoffTime: matches.kickoffTime,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        homeScore: matches.homeScoreFullTime,
        awayScore: matches.awayScoreFullTime,
      })
      .from(matches)
      .where(and(...historyConditions))
      .orderBy(desc(matches.kickoffTime))
      .limit(30);

    if (hasNonDefaultStored) {
      return {
        teamId,
        overallElo: Number(storedRating.overallElo.toFixed(1)),
        attackRating: Number(storedRating.attackRating.toFixed(1)),
        defenseRating: Number(storedRating.defenseRating.toFixed(1)),
        homeAdvantage: storedRating.homeAdvantage,
        matchesPlayed: history.length,
        isFromComputedHistory: false,
        isBaselineDefault: false,
      };
    }

    if (history.length === 0) {
      return {
        teamId,
        overallElo: 1500,
        attackRating: 100,
        defenseRating: 100,
        homeAdvantage: 65,
        matchesPlayed: 0,
        isFromComputedHistory: false,
        isBaselineDefault: true,
      };
    }

    // Compute empirical rating chronologically across up to 30 most recent prior matches
    const chronological = [...history].reverse();
    let elo = 1500;
    let totalScored = 0;
    let totalConceded = 0;

    for (const m of chronological) {
      const isHome = m.homeTeamId === teamId;
      const scored = isHome ? (m.homeScore ?? 0) : (m.awayScore ?? 0);
      const conceded = isHome ? (m.awayScore ?? 0) : (m.homeScore ?? 0);

      totalScored += scored;
      totalConceded += conceded;

      const actual = scored > conceded ? 1 : scored === conceded ? 0.5 : 0;
      const expected = 1 / (1 + Math.pow(10, (1500 - (elo + (isHome ? 65 : 0))) / 400));
      const gd = Math.abs(scored - conceded);
      const goalMult = gd >= 3 ? 1.5 : gd === 2 ? 1.25 : 1.0;
      elo += 24 * goalMult * (actual - expected);
    }

    const n = chronological.length;
    const avgScored = totalScored / n;
    const avgConceded = totalConceded / n;

    // Shrink toward league neutral (1.30 goals/match) for small samples
    const shrinkageWeight = 6;
    const smoothedScored = (n * avgScored + shrinkageWeight * 1.3) / (n + shrinkageWeight);
    const smoothedConceded = (n * avgConceded + shrinkageWeight * 1.3) / (n + shrinkageWeight);

    const attackRating = Math.max(65, Math.min(140, (smoothedScored / 1.3) * 100));
    const defenseRating = Math.max(65, Math.min(140, 100 + ((1.3 - smoothedConceded) / 1.3) * 35));

    return {
      teamId,
      overallElo: Number(elo.toFixed(1)),
      attackRating: Number(attackRating.toFixed(1)),
      defenseRating: Number(defenseRating.toFixed(1)),
      homeAdvantage: 65,
      matchesPlayed: n,
      isFromComputedHistory: true,
      isBaselineDefault: false,
    };
  }
}
