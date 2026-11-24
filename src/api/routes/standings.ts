import { Router, Request, Response } from 'express';
import { StandingsEngine } from '../../data/standings/standingsEngine.ts';

export const standingsRouter = Router();

// GET /api/standings?competition=PL&season=2024-2025
standingsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const competitionCode = (req.query.competition as string) || 'PL';
    const seasonCode = req.query.season as string | undefined;

    const data = await StandingsEngine.getStandings(competitionCode, seasonCode);
    if (!data) {
      return res.status(404).json({ error: `Competition '${competitionCode}' not found` });
    }

    res.json(data);
  } catch (error: any) {
    console.error('Failed to get standings:', error);
    res.status(500).json({ error: error.message || 'Failed to get standings' });
  }
});
