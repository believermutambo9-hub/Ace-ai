import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { competitions, matches, seasons, teams } from '../../db/schema.ts';
import { FootballDataProvider } from '../providers/footballDataProvider.ts';

export interface StandingsRow {
  position: number;
  teamId: number;
  teamName: string;
  shortName: string;
  tla?: string | null;
  crest?: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

export interface CompetitionStandingsResponse {
  competitionId: number;
  competitionCode: string;
  competitionName: string;
  country: string;
  seasonCode: string;
  lastUpdated: string;
  totalTeams: number;
  standings: StandingsRow[];
}

export class StandingsEngine {
  /**
   * Computes official league table standings from verified database match results
   */
  public static async getStandings(
    competitionCode: string = 'PL',
    seasonCode?: string
  ): Promise<CompetitionStandingsResponse | null> {
    // 1. Locate competition
    const [comp] = await db
      .select()
      .from(competitions)
      .where(eq(competitions.code, competitionCode))
      .limit(1);

    if (!comp) return null;

    // 2. Select season (prefer most recent season with FINISHED matches when seasonCode omitted)
    let targetSeasonCode = seasonCode;
    if (!targetSeasonCode) {
      const candidateSeasons = await db
        .select({
          id: seasons.id,
          seasonCode: seasons.seasonCode,
          yearEnd: seasons.yearEnd,
        })
        .from(seasons)
        .where(eq(seasons.competitionId, comp.id))
        .orderBy(desc(seasons.yearEnd));

      let pickedCode: string | undefined;
      for (const s of candidateSeasons) {
        const [hasFinished] = await db
          .select({ id: matches.id })
          .from(matches)
          .where(
            and(
              eq(matches.competitionId, comp.id),
              eq(matches.seasonId, s.id),
              eq(matches.status, 'FINISHED')
            )
          )
          .limit(1);
        if (hasFinished) {
          pickedCode = s.seasonCode;
          break;
        }
      }

      targetSeasonCode = pickedCode || candidateSeasons[0]?.seasonCode || '2024-2025';
    }

    const [seasonRecord] = await db
      .select()
      .from(seasons)
      .where(
        and(
          eq(seasons.competitionId, comp.id),
          eq(seasons.seasonCode, targetSeasonCode)
        )
      )
      .limit(1);

    const seasonId = seasonRecord?.id;

    // 3. Fetch finished matches for this competition & season
    let matchQuery = db
      .select({
        id: matches.id,
        kickoffTime: matches.kickoffTime,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        homeScore: matches.homeScoreFullTime,
        awayScore: matches.awayScoreFullTime,
        result: matches.result,
      })
      .from(matches)
      .where(
        and(
          eq(matches.competitionId, comp.id),
          eq(matches.status, 'FINISHED')
        )
      );

    if (seasonId) {
      matchQuery = db
        .select({
          id: matches.id,
          kickoffTime: matches.kickoffTime,
          homeTeamId: matches.homeTeamId,
          awayTeamId: matches.awayTeamId,
          homeScore: matches.homeScoreFullTime,
          awayScore: matches.awayScoreFullTime,
          result: matches.result,
        })
        .from(matches)
        .where(
          and(
            eq(matches.competitionId, comp.id),
            eq(matches.seasonId, seasonId),
            eq(matches.status, 'FINISHED')
          )
        );
    }

    const finishedMatches = await matchQuery.orderBy(desc(matches.kickoffTime));

    // Also get all registered teams to populate meta
    const allTeams = await db.select().from(teams);
    const teamMap = new Map<number, typeof teams.$inferSelect>();
    for (const t of allTeams) teamMap.set(t.id, t);

    // Compute stats per team
    const tableMap = new Map<
      number,
      {
        teamId: number;
        played: number;
        won: number;
        drawn: number;
        lost: number;
        goalsFor: number;
        goalsAgainst: number;
        points: number;
        form: Array<'W' | 'D' | 'L'>;
      }
    >();

    // Process chronological matches (reversed from newest for form)
    for (const m of finishedMatches) {
      if (m.homeScore === null || m.awayScore === null) continue;

      // Ensure home team entry
      if (!tableMap.has(m.homeTeamId)) {
        tableMap.set(m.homeTeamId, {
          teamId: m.homeTeamId,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          points: 0,
          form: [],
        });
      }
      // Ensure away team entry
      if (!tableMap.has(m.awayTeamId)) {
        tableMap.set(m.awayTeamId, {
          teamId: m.awayTeamId,
          played: 0,
          won: 0,
          drawn: 0,
          lost: 0,
          goalsFor: 0,
          goalsAgainst: 0,
          points: 0,
          form: [],
        });
      }

      const homeRow = tableMap.get(m.homeTeamId)!;
      const awayRow = tableMap.get(m.awayTeamId)!;

      homeRow.played++;
      awayRow.played++;
      homeRow.goalsFor += m.homeScore;
      homeRow.goalsAgainst += m.awayScore;
      awayRow.goalsFor += m.awayScore;
      awayRow.goalsAgainst += m.homeScore;

      if (m.homeScore > m.awayScore) {
        homeRow.won++;
        homeRow.points += 3;
        awayRow.lost++;
        if (homeRow.form.length < 5) homeRow.form.push('W');
        if (awayRow.form.length < 5) awayRow.form.push('L');
      } else if (m.homeScore < m.awayScore) {
        awayRow.won++;
        awayRow.points += 3;
        homeRow.lost++;
        if (homeRow.form.length < 5) homeRow.form.push('L');
        if (awayRow.form.length < 5) awayRow.form.push('W');
      } else {
        homeRow.drawn++;
        awayRow.drawn++;
        homeRow.points += 1;
        awayRow.points += 1;
        if (homeRow.form.length < 5) homeRow.form.push('D');
        if (awayRow.form.length < 5) awayRow.form.push('D');
      }
    }

    // Sort table rows by standard football hierarchy: Points DESC, GoalDiff DESC, GoalsFor DESC
    const sortedRows = Array.from(tableMap.values()).sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      const diffB = b.goalsFor - b.goalsAgainst;
      const diffA = a.goalsFor - a.goalsAgainst;
      if (diffB !== diffA) return diffB - diffA;
      return b.goalsFor - a.goalsFor;
    });

    const formattedStandings: StandingsRow[] = sortedRows.map((row, idx) => {
      const team = teamMap.get(row.teamId);
      return {
        position: idx + 1,
        teamId: row.teamId,
        teamName: team?.canonicalName || `Team #${row.teamId}`,
        shortName: team?.shortName || team?.canonicalName || 'Team',
        tla: team?.tla,
        crest: team?.crest,
        played: row.played,
        won: row.won,
        drawn: row.drawn,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalsFor - row.goalsAgainst,
        points: row.points,
        form: row.form,
      };
    });

    return {
      competitionId: comp.id,
      competitionCode: comp.code,
      competitionName: comp.name,
      country: comp.country,
      seasonCode: targetSeasonCode,
      lastUpdated: new Date().toISOString(),
      totalTeams: formattedStandings.length,
      standings: formattedStandings,
    };
  }
}
