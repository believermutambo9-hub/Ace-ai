import { Router, Request, Response } from 'express';
import { NewsEngine } from '../../data/news/newsEngine.ts';

export const newsRouter = Router();

// GET /api/news?category=...
newsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const data = await NewsEngine.getFootballNews(category);
    res.json(data);
  } catch (error: any) {
    console.error('Failed to get football news:', error);
    res.status(500).json({ error: error.message || 'Failed to get football news' });
  }
});
