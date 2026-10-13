import { Router, Request, Response } from 'express';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { competitions, matches, matchStatistics, teams } from '../../db/schema.ts';
import { LiveMatchEngine } from '../../data/live/liveMatchEngine.ts';

export const matchesRouter = Router();

// GET /api/matches
matchesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const competitionCode = req.query.competition as string;

    // Advance live matches on periodic poll
    await LiveMatchEngine.tickLiveMatches();

    const query = db
      .select({
        id: matches.id,
        externalId: matches.externalId,
        competitionId: matches.competitionId,
        competitionName: competitions.name,
        competitionCode: competitions.code,
        round: matches.round,
        kickoffTime: matches.kickoffTime,
        status: matches.status,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        homeScoreFullTime: matches.homeScoreFullTime,
        awayScoreFullTime: matches.awayScoreFullTime,
        result: matches.result,
        venue: matches.venue,
        metadata: matches.metadata,
      })
      .from(matches)
      .innerJoin(competitions, eq(matches.competitionId, competitions.id));

    const allMatches = await query.orderBy(desc(matches.kickoffTime));

    // Get team details
    const allTeams = await db.select().from(teams);
    const teamMap = new Map(allTeams.map((t) => [t.id, t]));

    let filtered = allMatches.map((m) => ({
      ...m,
      homeTeam: teamMap.get(m.homeTeamId)?.canonicalName || 'Unknown Team',
      awayTeam: teamMap.get(m.awayTeamId)?.canonicalName || 'Unknown Team',
      homeShortName: teamMap.get(m.homeTeamId)?.shortName || 'Unknown',
      awayShortName: teamMap.get(m.awayTeamId)?.shortName || 'Unknown',
    }));

    if (status) {
      filtered = filtered.filter((m) => m.status.toUpperCase() === status.toUpperCase());
    }
    if (competitionCode) {
      filtered = filtered.filter((m) => m.competitionCode.toUpperCase() === competitionCode.toUpperCase());
    }

    res.json(filtered);
  } catch (error: any) {
    console.error('Failed to get matches:', error);
    res.status(500).json({ error: error.message || 'Failed to get matches' });
  }
});

// GET /api/matches/live - Dedicated fast endpoint for active live matches
matchesRouter.get('/live', async (_req: Request, res: Response) => {
  try {
    await LiveMatchEngine.tickLiveMatches();

    const liveMatches = await db
      .select({
        id: matches.id,
        externalId: matches.externalId,
        competitionId: matches.competitionId,
        competitionName: competitions.name,
        competitionCode: competitions.code,
        round: matches.round,
        kickoffTime: matches.kickoffTime,
        status: matches.status,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        homeScoreFullTime: matches.homeScoreFullTime,
        awayScoreFullTime: matches.awayScoreFullTime,
        result: matches.result,
        venue: matches.venue,
        metadata: matches.metadata,
      })
      .from(matches)
      .innerJoin(competitions, eq(matches.competitionId, competitions.id))
      .where(eq(matches.status, 'LIVE'))
      .orderBy(desc(matches.kickoffTime));

    const allTeams = await db.select().from(teams);
    const teamMap = new Map(allTeams.map((t) => [t.id, t]));

    const enriched = liveMatches.map((m) => ({
      ...m,
      homeTeam: teamMap.get(m.homeTeamId)?.canonicalName || 'Home Team',
      awayTeam: teamMap.get(m.awayTeamId)?.canonicalName || 'Away Team',
      homeShortName: teamMap.get(m.homeTeamId)?.shortName || 'Home',
      awayShortName: teamMap.get(m.awayTeamId)?.shortName || 'Away',
    }));

    res.json(enriched);
  } catch (error: any) {
    console.error('Failed to get live matches:', error);
    res.status(500).json({ error: error.message || 'Failed to get live matches' });
  }
});

// POST /api/matches/simulate-live - Trigger live event simulation
matchesRouter.post('/simulate-live', async (req: Request, res: Response) => {
  try {
    const { matchId, eventType } = req.body;
    if (eventType === 'RESET_ALL') {
      await LiveMatchEngine.ensureLiveMatches();
      return res.json({ message: 'Live matches reset successfully' });
    }

    if (!matchId || !eventType) {
      return res.status(400).json({ error: 'matchId and eventType are required' });
    }

    const result = await LiveMatchEngine.triggerSimulatedEvent(matchId, eventType);
    res.json(result);
  } catch (error: any) {
    console.error('Simulate live event failed:', error);
    res.status(500).json({ error: error.message || 'Simulate live event failed' });
  }
});

// GET /api/match/:id
matchesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const matchId = parseInt(req.params.id, 10);
    if (isNaN(matchId)) {
      return res.status(400).json({ error: 'Invalid match ID' });
    }

    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const [homeTeam] = await db.select().from(teams).where(eq(teams.id, match.homeTeamId)).limit(1);
    const [awayTeam] = await db.select().from(teams).where(eq(teams.id, match.awayTeamId)).limit(1);
    const [competition] = await db.select().from(competitions).where(eq(competitions.id, match.competitionId)).limit(1);

    const stats = await db
      .select()
      .from(matchStatistics)
      .where(eq(matchStatistics.matchId, matchId));

    res.json({
      ...match,
      homeTeam,
      awayTeam,
      competition,
      statistics: stats,
    });
  } catch (error: any) {
    console.error('Failed to get match details:', error);
    res.status(500).json({ error: error.message || 'Failed to get match details' });
  }
});
