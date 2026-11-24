import { Router, Request, Response } from 'express';
import { and, desc, eq, gte, ilike, inArray, lte, or, type SQL } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { competitions, matches, matchStatistics, teams } from '../../db/schema.ts';
import { LiveMatchEngine } from '../../data/live/liveMatchEngine.ts';

export const matchesRouter = Router();

// GET /api/matches
// Query options: ?status=...&competition=...&hours=1..5&date=today|tomorrow|YYYY-MM-DD&search=...&limit=...&offset=...
matchesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const status = (req.query.status as string | undefined)?.trim();
    const competitionCode = (req.query.competition as string | undefined)?.trim();
    const hoursParam = req.query.hours ? parseInt(req.query.hours as string, 10) : undefined;
    const dateParam = (req.query.date as string | undefined)?.trim();
    const searchParam = ((req.query.search as string) || '').trim();

    const rawLimit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const limit = isNaN(rawLimit) || rawLimit <= 0 ? 100 : Math.min(rawLimit, 250);
    const rawOffset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;
    const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

    const conditions: SQL[] = [];
    const now = new Date();

    if (status && status.toUpperCase() !== 'ALL') {
      conditions.push(eq(matches.status, status.toUpperCase()));
    }

    if (competitionCode && competitionCode.toUpperCase() !== 'ALL') {
      conditions.push(eq(competitions.code, competitionCode.toUpperCase()));
    }

    if (hoursParam && !isNaN(hoursParam) && hoursParam > 0) {
      const windowEnd = new Date(now.getTime() + hoursParam * 60 * 60 * 1000);
      conditions.push(gte(matches.kickoffTime, now));
      conditions.push(lte(matches.kickoffTime, windowEnd));
    }

    if (dateParam) {
      let targetDateStr: string | null = null;
      if (dateParam === 'today') {
        targetDateStr = now.toISOString().split('T')[0];
      } else if (dateParam === 'tomorrow') {
        targetDateStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        targetDateStr = dateParam;
      }

      if (targetDateStr) {
        const dayStart = new Date(`${targetDateStr}T00:00:00.000Z`);
        const dayEnd = new Date(`${targetDateStr}T23:59:59.999Z`);
        conditions.push(gte(matches.kickoffTime, dayStart));
        conditions.push(lte(matches.kickoffTime, dayEnd));
      }
    }

    if (searchParam) {
      const pattern = `%${searchParam}%`;
      const [matchedTeams, matchedComps] = await Promise.all([
        db
          .select({ id: teams.id })
          .from(teams)
          .where(or(ilike(teams.canonicalName, pattern), ilike(teams.shortName, pattern))),
        db
          .select({ id: competitions.id })
          .from(competitions)
          .where(or(ilike(competitions.name, pattern), ilike(competitions.code, pattern))),
      ]);

      const teamIds = matchedTeams.map((t) => t.id);
      const compIds = matchedComps.map((c) => c.id);

      const searchClauses: SQL[] = [ilike(matches.venue, pattern)];
      if (teamIds.length > 0) {
        searchClauses.push(inArray(matches.homeTeamId, teamIds));
        searchClauses.push(inArray(matches.awayTeamId, teamIds));
      }
      if (compIds.length > 0) {
        searchClauses.push(inArray(matches.competitionId, compIds));
      }

      conditions.push(or(...searchClauses)!);
    }

    const rows = await db
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
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(matches.kickoffTime))
      .limit(limit)
      .offset(offset);

    if (rows.length === 0) {
      return res.json([]);
    }

    const neededTeamIds = Array.from(
      new Set(rows.flatMap((m) => [m.homeTeamId, m.awayTeamId]))
    );
    const neededTeams = await db
      .select()
      .from(teams)
      .where(inArray(teams.id, neededTeamIds));
    const teamMap = new Map(neededTeams.map((t) => [t.id, t]));

    const enriched = rows.map((m) => ({
      ...m,
      homeTeam: teamMap.get(m.homeTeamId)?.canonicalName || 'Unknown Team',
      awayTeam: teamMap.get(m.awayTeamId)?.canonicalName || 'Unknown Team',
      homeShortName: teamMap.get(m.homeTeamId)?.shortName || 'Unknown',
      awayShortName: teamMap.get(m.awayTeamId)?.shortName || 'Unknown',
    }));

    res.json(enriched);
  } catch (error: any) {
    console.error('Failed to get matches:', error);
    res.status(500).json({ error: error.message || 'Failed to get matches' });
  }
});

// GET /api/matches/live - Dedicated fast endpoint for active live matches
matchesRouter.get('/live', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const liveMatches = await LiveMatchEngine.getLiveMatches(forceRefresh);
    res.json(liveMatches);
  } catch (error: any) {
    console.error('Failed to get live matches:', error);
    res.status(500).json({ error: error.message || 'Failed to get live matches' });
  }
});

// GET /api/matches/live-feed - Unified live web feed (in-play scores, global schedule, dispatches, source health)
matchesRouter.get('/live-feed', async (req: Request, res: Response) => {
  try {
    const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';
    const snapshot = await LiveMatchEngine.getLiveWebFeedSnapshot(forceRefresh);
    res.json(snapshot);
  } catch (error: any) {
    console.error('Failed to get live web feed:', error);
    res.status(500).json({ error: error.message || 'Failed to get live web feed' });
  }
});

// POST /api/matches/simulate-live - Notice endpoint for verified mode
matchesRouter.post('/simulate-live', async (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'VERIFIED_DATA_MODE',
    message: 'PitchIntel operates in verified production data mode. Live match scores, events, and cards originate strictly from configured sports data providers and cannot be artificially manipulated.',
  });
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
