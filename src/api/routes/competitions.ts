import { Router, Request, Response } from 'express';
import { sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { competitions } from '../../db/schema.ts';

export const competitionsRouter = Router();

competitionsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const list = await db
      .select({
        id: competitions.id,
        code: competitions.code,
        name: competitions.name,
        country: competitions.country,
        tier: competitions.tier,
        type: competitions.type,
        emblem: competitions.emblem,
      })
      .from(competitions)
      .orderBy(competitions.tier, competitions.name);

    // Get match counts per competition
    const matchCounts = await db.execute<{ competition_id: number; count: number }>(
      sql`SELECT competition_id, count(*) as count FROM matches GROUP BY competition_id`
    );

    const countMap = new Map<number, number>();
    for (const r of matchCounts.rows) {
      countMap.set(r.competition_id, Number(r.count));
    }

    const enhanced = list.map((c) => ({
      ...c,
      totalMatches: countMap.get(c.id) || 0,
    }));

    res.json(enhanced);
  } catch (error: any) {
    console.error('Failed to retrieve competitions:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch competitions' });
  }
});
