import { Router, Request, Response } from 'express';
import { desc, eq, or } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { matches, teamAliases, teamRatings, teams } from '../../db/schema.ts';

export const teamsRouter = Router();

// GET /api/teams
teamsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const country = req.query.country as string;
    let query = db.select().from(teams);

    if (country) {
      const filtered = await db.select().from(teams).where(eq(teams.country, country));
      return res.json(filtered);
    }

    const allTeams = await query;
    const allRatings = await db.select().from(teamRatings);
    const ratingMap = new Map<number, any>();
    for (const r of allRatings) {
      if (!ratingMap.has(r.teamId) || (r.ratingTimestamp && ratingMap.get(r.teamId)?.ratingTimestamp && r.ratingTimestamp > ratingMap.get(r.teamId).ratingTimestamp)) {
        ratingMap.set(r.teamId, r);
      }
    }

    const enrichedTeams = allTeams.map((t) => ({
      ...t,
      rating: ratingMap.get(t.id) || {
        overallElo: 1500,
        attackRating: 100,
        defenseRating: 100,
        homeAdvantage: 65,
      },
    })).sort((a, b) => (b.rating?.overallElo || 1500) - (a.rating?.overallElo || 1500));

    res.json(enrichedTeams);
  } catch (error: any) {
    console.error('Failed to get teams:', error);
    res.status(500).json({ error: error.message || 'Failed to get teams' });
  }
});

// GET /api/team/:id
teamsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const teamId = parseInt(req.params.id, 10);
    if (isNaN(teamId)) {
      return res.status(400).json({ error: 'Invalid team ID' });
    }

    const [team] = await db.select().from(teams).where(eq(teams.id, teamId)).limit(1);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const aliases = await db.select().from(teamAliases).where(eq(teamAliases.teamId, teamId));
    const [rating] = await db
      .select()
      .from(teamRatings)
      .where(eq(teamRatings.teamId, teamId))
      .orderBy(desc(teamRatings.ratingTimestamp))
      .limit(1);

    res.json({
      ...team,
      aliases: aliases.map((a) => a.aliasName),
      rating: rating || {
        overallElo: 1500,
        attackRating: 100,
        defenseRating: 100,
        homeAdvantage: 65,
      },
    });
  } catch (error: any) {
    console.error('Failed to get team by ID:', error);
    res.status(500).json({ error: error.message || 'Failed to get team' });
  }
});

// GET /api/form/:teamId
teamsRouter.get('/form/:teamId', async (req: Request, res: Response) => {
  try {
    const teamId = parseInt(req.params.teamId, 10);
    if (isNaN(teamId)) {
      return res.status(400).json({ error: 'Invalid team ID' });
    }

    const recentMatches = await db
      .select()
      .from(matches)
      .where(
        or(eq(matches.homeTeamId, teamId), eq(matches.awayTeamId, teamId))
      )
      .orderBy(desc(matches.kickoffTime))
      .limit(10);

    const formItems = recentMatches
      .filter((m) => m.status === 'FINISHED' && m.homeScoreFullTime !== null && m.awayScoreFullTime !== null)
      .slice(0, 5)
      .map((m) => {
        const isHome = m.homeTeamId === teamId;
        const teamGoals = isHome ? m.homeScoreFullTime! : m.awayScoreFullTime!;
        const oppGoals = isHome ? m.awayScoreFullTime! : m.homeScoreFullTime!;
        let resultChar = 'D';
        if (teamGoals > oppGoals) resultChar = 'W';
        else if (teamGoals < oppGoals) resultChar = 'L';

        return {
          matchId: m.id,
          date: m.kickoffTime,
          isHome,
          scored: teamGoals,
          conceded: oppGoals,
          result: resultChar,
        };
      });

    const formString = formItems.map((f) => f.result).join('');

    res.json({
      teamId,
      formString,
      matches: formItems,
    });
  } catch (error: any) {
    console.error('Failed to get team form:', error);
    res.status(500).json({ error: error.message || 'Failed to get team form' });
  }
});
