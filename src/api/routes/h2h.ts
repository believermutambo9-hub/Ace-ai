import { Router, Request, Response } from 'express';
import { db } from '../../db/index.ts';
import { teams } from '../../db/schema.ts';
import { HistoricalEvidenceEngine } from '../../evidence/historical/h2hEngine.ts';
import { eq } from 'drizzle-orm';

export const h2hRouter = Router();

// GET /api/h2h?teamA=1&teamB=2 or ?home=Arsenal&away=Chelsea
h2hRouter.get('/', async (req: Request, res: Response) => {
  try {
    let teamAId = parseInt(req.query.teamA as string, 10);
    let teamBId = parseInt(req.query.teamB as string, 10);

    if (isNaN(teamAId) || isNaN(teamBId)) {
      // Try resolving by name (supports home, homeTeam, away, awayTeam)
      const teamAName = (req.query.home || req.query.homeTeam) as string;
      const teamBName = (req.query.away || req.query.awayTeam) as string;

      if (!teamAName || !teamBName) {
        return res.status(400).json({ error: 'Provide either teamA & teamB IDs or home & away team names' });
      }

      const allTeams = await db.select().from(teams);
      const foundA = allTeams.find(
        (t) =>
          t.canonicalName.toLowerCase().includes(teamAName.toLowerCase()) ||
          t.shortName.toLowerCase().includes(teamAName.toLowerCase())
      );
      const foundB = allTeams.find(
        (t) =>
          t.canonicalName.toLowerCase().includes(teamBName.toLowerCase()) ||
          t.shortName.toLowerCase().includes(teamBName.toLowerCase())
      );

      if (!foundA || !foundB) {
        return res.status(404).json({ error: 'One or both teams could not be found' });
      }

      teamAId = foundA.id;
      teamBId = foundB.id;
    }

    const [teamARecord] = await db.select().from(teams).where(eq(teams.id, teamAId)).limit(1);
    const [teamBRecord] = await db.select().from(teams).where(eq(teams.id, teamBId)).limit(1);

    if (!teamARecord || !teamBRecord) {
      return res.status(404).json({ error: 'Team not found' });
    }

    const [h2hSummary, formA, formB] = await Promise.all([
      HistoricalEvidenceEngine.getH2HRecord(teamAId, teamBId),
      HistoricalEvidenceEngine.getTeamForm(teamAId, true),
      HistoricalEvidenceEngine.getTeamForm(teamBId, false),
    ]);

    res.json({
      teamA: teamARecord,
      teamB: teamBRecord,
      h2hSummary,
      teamAForm: formA,
      teamBForm: formB,
    });
  } catch (error: any) {
    console.error('Failed to get H2H comparison:', error);
    res.status(500).json({ error: error.message || 'Failed to get H2H comparison' });
  }
});
