import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { competitions, matches, seasons, teams } from '../../db/schema.ts';

export interface LiveEventItem {
  id: string;
  minute: number;
  type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'VAR_CHECK' | 'PENALTY' | 'DANGEROUS_ATTACK';
  team: 'HOME' | 'AWAY';
  player: string;
  scoreAfter?: string;
  description: string;
}

export interface LiveMatchMetadata {
  minute: number;
  period: '1H' | 'HT' | '2H' | 'FT';
  stoppageTime?: number;
  lastUpdated: string;
  events: LiveEventItem[];
  lastEvent?: LiveEventItem;
  liveStats: {
    possession: { home: number; away: number };
    shots: { home: number; away: number };
    shotsOnTarget: { home: number; away: number };
    corners: { home: number; away: number };
    fouls: { home: number; away: number };
    yellowCards: { home: number; away: number };
    redCards: { home: number; away: number };
    liveXg: { home: number; away: number };
    pitchTilt: { home: number; away: number };
  };
  inPlayProbabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
}

export class LiveMatchEngine {
  private static lastTickTimestamp: number = Date.now();
  private static isTicking: boolean = false;

  /**
   * Ensure there are active LIVE matches in the database. If none, seeds 4 worldwide matches.
   */
  public static async ensureLiveMatches(): Promise<void> {
    try {
      const activeLive = await db
        .select()
        .from(matches)
        .where(eq(matches.status, 'LIVE'));

      if (activeLive.length >= 3) {
        return;
      }

      // Query necessary teams
      const allTeams = await db.select().from(teams);
      const teamMap = new Map(allTeams.map((t) => [t.canonicalName, t.id]));

      const getTeamId = (name: string, fallbackId: number) => teamMap.get(name) || fallbackId;

      const liveFixturesConfig = [
        {
          extId: 'live_pl_ars_mci',
          compCode: 'PL',
          homeName: 'Arsenal FC',
          homeId: getTeamId('Arsenal FC', 1),
          awayName: 'Manchester City FC',
          awayId: getTeamId('Manchester City FC', 3),
          minute: 68,
          period: '2H' as const,
          homeScore: 2,
          awayScore: 1,
          venue: 'Emirates Stadium',
          events: [
            {
              id: 'ev_1',
              minute: 22,
              type: 'GOAL' as const,
              team: 'HOME' as const,
              player: 'Bukayo Saka',
              scoreAfter: '1-0',
              description: 'Left footed shot from inside the box to bottom left corner.',
            },
            {
              id: 'ev_2',
              minute: 39,
              type: 'GOAL' as const,
              team: 'AWAY' as const,
              player: 'Erling Haaland',
              scoreAfter: '1-1',
              description: 'Header from 6 yards out following a pinpoint cross.',
            },
            {
              id: 'ev_3',
              minute: 59,
              type: 'GOAL' as const,
              team: 'HOME' as const,
              player: 'Kai Havertz',
              scoreAfter: '2-1',
              description: 'Right footed volley deflected into the top right corner.',
            },
            {
              id: 'ev_4',
              minute: 65,
              type: 'YELLOW_CARD' as const,
              team: 'AWAY' as const,
              player: 'Rodri',
              description: 'Tactical foul breaking up a fast counter-attack.',
            },
          ],
          liveStats: {
            possession: { home: 49, away: 51 },
            shots: { home: 11, away: 9 },
            shotsOnTarget: { home: 5, away: 4 },
            corners: { home: 5, away: 4 },
            fouls: { home: 9, away: 11 },
            yellowCards: { home: 1, away: 2 },
            redCards: { home: 0, away: 0 },
            liveXg: { home: 1.74, away: 1.28 },
            pitchTilt: { home: 52, away: 48 },
          },
        },
        {
          extId: 'live_cl_rma_bay',
          compCode: 'CL',
          homeName: 'Real Madrid CF',
          homeId: getTeamId('Real Madrid CF', 11),
          awayName: 'FC Bayern München',
          awayId: getTeamId('FC Bayern München', 21),
          minute: 34,
          period: '1H' as const,
          homeScore: 1,
          awayScore: 0,
          venue: 'Santiago Bernabéu',
          events: [
            {
              id: 'ev_11',
              minute: 14,
              type: 'GOAL' as const,
              team: 'HOME' as const,
              player: 'Vinícius Júnior',
              scoreAfter: '1-0',
              description: 'Clinical low finish across the goalkeeper into bottom right.',
            },
            {
              id: 'ev_12',
              minute: 27,
              type: 'YELLOW_CARD' as const,
              team: 'AWAY' as const,
              player: 'Joshua Kimmich',
              description: 'Late sliding challenge in the central third.',
            },
          ],
          liveStats: {
            possession: { home: 54, away: 46 },
            shots: { home: 6, away: 3 },
            shotsOnTarget: { home: 3, away: 1 },
            corners: { home: 3, away: 2 },
            fouls: { home: 4, away: 6 },
            yellowCards: { home: 0, away: 1 },
            redCards: { home: 0, away: 0 },
            liveXg: { home: 0.92, away: 0.35 },
            pitchTilt: { home: 58, away: 42 },
          },
        },
        {
          extId: 'live_pd_bar_atm',
          compCode: 'PD',
          homeName: 'FC Barcelona',
          homeId: getTeamId('FC Barcelona', 12),
          awayName: 'Atlético de Madrid',
          awayId: getTeamId('Atlético de Madrid', 13),
          minute: 81,
          period: '2H' as const,
          homeScore: 1,
          awayScore: 1,
          venue: 'Estadi Olímpic Lluís Companys',
          events: [
            {
              id: 'ev_21',
              minute: 31,
              type: 'GOAL' as const,
              team: 'HOME' as const,
              player: 'Lamine Yamal',
              scoreAfter: '1-0',
              description: 'Sensational curled effort from outside the 18-yard box.',
            },
            {
              id: 'ev_22',
              minute: 73,
              type: 'GOAL' as const,
              team: 'AWAY' as const,
              player: 'Antoine Griezmann',
              scoreAfter: '1-1',
              description: 'Chipped finish over the advancing goalkeeper on the break.',
            },
          ],
          liveStats: {
            possession: { home: 62, away: 38 },
            shots: { home: 14, away: 7 },
            shotsOnTarget: { home: 6, away: 3 },
            corners: { home: 8, away: 3 },
            fouls: { home: 7, away: 14 },
            yellowCards: { home: 1, away: 3 },
            redCards: { home: 0, away: 0 },
            liveXg: { home: 1.88, away: 0.94 },
            pitchTilt: { home: 66, away: 34 },
          },
        },
        {
          extId: 'live_sa_int_juv',
          compCode: 'SA',
          homeName: 'Inter Milan',
          homeId: getTeamId('Inter Milan', 18),
          awayName: 'Juventus FC',
          awayId: getTeamId('Juventus FC', 18),
          minute: 52,
          period: '2H' as const,
          homeScore: 0,
          awayScore: 0,
          venue: 'San Siro',
          events: [
            {
              id: 'ev_31',
              minute: 19,
              type: 'YELLOW_CARD' as const,
              team: 'HOME' as const,
              player: 'Nicolò Barella',
              description: 'Dissent after a referee foul decision.',
            },
            {
              id: 'ev_32',
              minute: 44,
              type: 'VAR_CHECK' as const,
              team: 'AWAY' as const,
              player: 'Dušan Vlahović',
              description: 'VAR review confirms offside; goal disallowed.',
            },
          ],
          liveStats: {
            possession: { home: 51, away: 49 },
            shots: { home: 7, away: 6 },
            shotsOnTarget: { home: 2, away: 2 },
            corners: { home: 4, away: 3 },
            fouls: { home: 10, away: 11 },
            yellowCards: { home: 2, away: 1 },
            redCards: { home: 0, away: 0 },
            liveXg: { home: 0.65, away: 0.58 },
            pitchTilt: { home: 50, away: 50 },
          },
        },
      ];

      for (const fix of liveFixturesConfig) {
        const [comp] = await db
          .select()
          .from(competitions)
          .where(eq(competitions.code, fix.compCode))
          .limit(1);

        const [season] = await db
          .select()
          .from(seasons)
          .where(eq(seasons.competitionId, comp ? comp.id : 1))
          .limit(1);

        const inPlay = LiveMatchEngine.calculateInPlayProbabilities(
          fix.homeScore,
          fix.awayScore,
          fix.minute
        );

        const meta: LiveMatchMetadata = {
          minute: fix.minute,
          period: fix.period,
          lastUpdated: new Date().toISOString(),
          events: fix.events,
          lastEvent: fix.events[fix.events.length - 1],
          liveStats: fix.liveStats,
          inPlayProbabilities: inPlay,
        };

        // Check if existing
        const [existing] = await db
          .select()
          .from(matches)
          .where(eq(matches.externalId, fix.extId))
          .limit(1);

        if (!existing) {
          await db.insert(matches).values({
            providerSource: 'live-engine',
            externalId: fix.extId,
            competitionId: comp ? comp.id : 1,
            seasonId: season ? season.id : 1,
            round: 'Matchday 8 (Live in Progress)',
            kickoffTime: new Date(Date.now() - fix.minute * 60 * 1000),
            homeTeamId: fix.homeId,
            awayTeamId: fix.awayId,
            venue: fix.venue,
            status: 'LIVE',
            homeScoreFullTime: fix.homeScore,
            awayScoreFullTime: fix.awayScore,
            metadata: meta,
          });
        }
      }
    } catch (err: any) {
      console.warn('[LiveMatchEngine] Initial setup notice:', err?.message || err);
    }
  }

  /**
   * Advance live matches dynamically by elapsed time
   */
  public static async tickLiveMatches(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      const now = Date.now();
      const deltaSec = Math.floor((now - this.lastTickTimestamp) / 1000);
      // Advance approximately 1 match minute every 6 real-world seconds
      const minutesToAdvance = Math.max(1, Math.floor(deltaSec / 6));

      if (deltaSec < 3) {
        this.isTicking = false;
        return;
      }
      this.lastTickTimestamp = now;

      const liveList = await db
        .select()
        .from(matches)
        .where(eq(matches.status, 'LIVE'));

      if (liveList.length === 0) {
        await this.ensureLiveMatches();
        this.isTicking = false;
        return;
      }

      for (const m of liveList) {
        const meta = (m.metadata as LiveMatchMetadata) || {
          minute: 10,
          period: '1H',
          lastUpdated: new Date().toISOString(),
          events: [],
          liveStats: {
            possession: { home: 50, away: 50 },
            shots: { home: 3, away: 2 },
            shotsOnTarget: { home: 1, away: 1 },
            corners: { home: 1, away: 1 },
            fouls: { home: 3, away: 3 },
            yellowCards: { home: 0, away: 0 },
            redCards: { home: 0, away: 0 },
            liveXg: { home: 0.35, away: 0.28 },
            pitchTilt: { home: 50, away: 50 },
          },
          inPlayProbabilities: { homeWin: 0.45, draw: 0.30, awayWin: 0.25 },
        };

        let currentMinute = meta.minute + minutesToAdvance;
        let currentPeriod = meta.period;
        let homeScore = m.homeScoreFullTime ?? 0;
        let awayScore = m.awayScoreFullTime ?? 0;
        const events = [...(meta.events || [])];
        const stats = { ...meta.liveStats };

        // Handle half-time transition
        if (currentMinute >= 45 && currentPeriod === '1H') {
          currentPeriod = 'HT';
          currentMinute = 45;
        } else if (currentPeriod === 'HT') {
          currentPeriod = '2H';
          currentMinute = 46;
        }

        // Random in-match developments based on Poisson probability per minute
        // Poisson chance of goal in 1 minute ~ 0.03
        if (currentPeriod !== 'HT' && currentMinute <= 92) {
          // Increment shots / corners
          if (Math.random() < 0.35) {
            if (Math.random() > 0.5) {
              stats.shots.home += 1;
              stats.liveXg.home = Number((stats.liveXg.home + (0.05 + Math.random() * 0.12)).toFixed(2));
              if (Math.random() > 0.55) stats.shotsOnTarget.home += 1;
            } else {
              stats.shots.away += 1;
              stats.liveXg.away = Number((stats.liveXg.away + (0.04 + Math.random() * 0.11)).toFixed(2));
              if (Math.random() > 0.55) stats.shotsOnTarget.away += 1;
            }
          }

          // Goal event check (approx 4% chance per tick)
          if (Math.random() < 0.06 && currentMinute < 90) {
            const isHomeGoal = Math.random() > 0.48;
            if (isHomeGoal) {
              homeScore += 1;
              const scorerPool = ['B. Saka', 'K. Havertz', 'V. Júnior', 'L. Yamal', 'L. Martínez', 'M. Salah', 'Rodrygo'];
              const scorer = scorerPool[Math.floor(Math.random() * scorerPool.length)];
              const newEv: LiveEventItem = {
                id: `ev_goal_${Date.now()}`,
                minute: currentMinute,
                type: 'GOAL',
                team: 'HOME',
                player: scorer,
                scoreAfter: `${homeScore}-${awayScore}`,
                description: `GOAL! ${scorer} finishes brilliantly into the net.`,
              };
              events.push(newEv);
              meta.lastEvent = newEv;
              stats.liveXg.home = Number((stats.liveXg.home + 0.42).toFixed(2));
            } else {
              awayScore += 1;
              const scorerPool = ['E. Haaland', 'A. Griezmann', 'H. Kane', 'D. Vlahović', 'K. De Bruyne', 'L. Sané'];
              const scorer = scorerPool[Math.floor(Math.random() * scorerPool.length)];
              const newEv: LiveEventItem = {
                id: `ev_goal_${Date.now()}`,
                minute: currentMinute,
                type: 'GOAL',
                team: 'AWAY',
                player: scorer,
                scoreAfter: `${homeScore}-${awayScore}`,
                description: `GOAL! ${scorer} strikes past the keeper from the edge of the box.`,
              };
              events.push(newEv);
              meta.lastEvent = newEv;
              stats.liveXg.away = Number((stats.liveXg.away + 0.38).toFixed(2));
            }
          }

          // Card event check (approx 5% chance)
          if (Math.random() < 0.05) {
            const isHomeCard = Math.random() > 0.5;
            const newCard: LiveEventItem = {
              id: `ev_card_${Date.now()}`,
              minute: currentMinute,
              type: 'YELLOW_CARD',
              team: isHomeCard ? 'HOME' : 'AWAY',
              player: isHomeCard ? 'Home Midfielder' : 'Away Defender',
              description: 'Cautioned by the referee for a tactical foul.',
            };
            events.push(newCard);
            meta.lastEvent = newCard;
            if (isHomeCard) stats.yellowCards.home += 1;
            else stats.yellowCards.away += 1;
          }
        }

        // Full time finish check
        if (currentMinute >= 93) {
          const result = homeScore > awayScore ? 'HOME_WIN' : homeScore < awayScore ? 'AWAY_WIN' : 'DRAW';
          await db
            .update(matches)
            .set({
              status: 'FINISHED',
              homeScoreFullTime: homeScore,
              awayScoreFullTime: awayScore,
              result,
              metadata: {
                ...meta,
                minute: 90,
                period: 'FT',
                lastUpdated: new Date().toISOString(),
                events,
                liveStats: stats,
              },
            })
            .where(eq(matches.id, m.id));
          continue;
        }

        // Recalculate dynamic in-play win probabilities
        const updatedInPlay = LiveMatchEngine.calculateInPlayProbabilities(homeScore, awayScore, currentMinute);

        const updatedMetadata: LiveMatchMetadata = {
          minute: currentMinute,
          period: currentPeriod,
          lastUpdated: new Date().toISOString(),
          events,
          lastEvent: meta.lastEvent,
          liveStats: stats,
          inPlayProbabilities: updatedInPlay,
        };

        await db
          .update(matches)
          .set({
            homeScoreFullTime: homeScore,
            awayScoreFullTime: awayScore,
            metadata: updatedMetadata,
          })
          .where(eq(matches.id, m.id));
      }
    } catch (err: any) {
      console.warn('[LiveMatchEngine] Tick error:', err?.message || err);
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * Calculate live In-Play Win/Draw/Away probabilities using score and time remaining
   */
  public static calculateInPlayProbabilities(
    homeScore: number,
    awayScore: number,
    minute: number
  ): { homeWin: number; draw: number; awayWin: number } {
    const minClamped = Math.min(90, Math.max(0, minute));
    const timeRemainingFraction = (90 - minClamped) / 90;
    const goalDiff = homeScore - awayScore;

    let pHome: number;
    let pDraw: number;
    let pAway: number;

    if (goalDiff === 0) {
      // Level score: Draw probability increases as time ticks down
      pDraw = Number((0.28 + (1 - timeRemainingFraction) * 0.54).toFixed(3));
      const remaining = 1 - pDraw;
      pHome = Number((remaining * 0.53).toFixed(3));
      pAway = Number((remaining * 0.47).toFixed(3));
    } else if (goalDiff === 1) {
      // Home leading by 1
      pHome = Number((0.55 + (1 - timeRemainingFraction) * 0.40).toFixed(3));
      const rem = 1 - pHome;
      pDraw = Number((rem * 0.68).toFixed(3));
      pAway = Number((rem * 0.32).toFixed(3));
    } else if (goalDiff === -1) {
      // Away leading by 1
      pAway = Number((0.52 + (1 - timeRemainingFraction) * 0.42).toFixed(3));
      const rem = 1 - pAway;
      pDraw = Number((rem * 0.68).toFixed(3));
      pHome = Number((rem * 0.32).toFixed(3));
    } else if (goalDiff >= 2) {
      // Home leading by 2+
      pHome = Number((0.85 + (1 - timeRemainingFraction) * 0.14).toFixed(3));
      const rem = 1 - pHome;
      pDraw = Number((rem * 0.80).toFixed(3));
      pAway = Number((rem * 0.20).toFixed(3));
    } else {
      // Away leading by 2+
      pAway = Number((0.82 + (1 - timeRemainingFraction) * 0.16).toFixed(3));
      const rem = 1 - pAway;
      pDraw = Number((rem * 0.80).toFixed(3));
      pHome = Number((rem * 0.20).toFixed(3));
    }

    const sum = pHome + pDraw + pAway;
    return {
      homeWin: Number((pHome / sum).toFixed(4)),
      draw: Number((pDraw / sum).toFixed(4)),
      awayWin: Number((pAway / sum).toFixed(4)),
    };
  }

  /**
   * Trigger an on-demand event (e.g. goal or reset) for testing
   */
  public static async triggerSimulatedEvent(matchId: number, eventType: 'GOAL_HOME' | 'GOAL_AWAY' | 'ADVANCE_5'): Promise<any> {
    const [m] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
    if (!m) throw new Error('Match not found');

    const meta = (m.metadata as LiveMatchMetadata) || {
      minute: 20,
      period: '1H',
      lastUpdated: new Date().toISOString(),
      events: [],
      liveStats: {
        possession: { home: 50, away: 50 },
        shots: { home: 4, away: 4 },
        shotsOnTarget: { home: 2, away: 2 },
        corners: { home: 2, away: 2 },
        fouls: { home: 4, away: 4 },
        yellowCards: { home: 0, away: 0 },
        redCards: { home: 0, away: 0 },
        liveXg: { home: 0.5, away: 0.5 },
        pitchTilt: { home: 50, away: 50 },
      },
      inPlayProbabilities: { homeWin: 0.45, draw: 0.3, awayWin: 0.25 },
    };

    let homeScore = m.homeScoreFullTime ?? 0;
    let awayScore = m.awayScoreFullTime ?? 0;
    let minute = meta.minute;
    const events = [...(meta.events || [])];

    if (eventType === 'GOAL_HOME') {
      homeScore += 1;
      const ev: LiveEventItem = {
        id: `ev_test_${Date.now()}`,
        minute,
        type: 'GOAL',
        team: 'HOME',
        player: 'Simulated Goalscorer',
        scoreAfter: `${homeScore}-${awayScore}`,
        description: 'GOAL! Powerful strike into the roof of the net!',
      };
      events.push(ev);
      meta.lastEvent = ev;
      meta.liveStats.liveXg.home = Number((meta.liveStats.liveXg.home + 0.48).toFixed(2));
      meta.liveStats.shotsOnTarget.home += 1;
    } else if (eventType === 'GOAL_AWAY') {
      awayScore += 1;
      const ev: LiveEventItem = {
        id: `ev_test_${Date.now()}`,
        minute,
        type: 'GOAL',
        team: 'AWAY',
        player: 'Simulated Goalscorer',
        scoreAfter: `${homeScore}-${awayScore}`,
        description: 'GOAL! Away team strikes on the counter-attack!',
      };
      events.push(ev);
      meta.lastEvent = ev;
      meta.liveStats.liveXg.away = Number((meta.liveStats.liveXg.away + 0.44).toFixed(2));
      meta.liveStats.shotsOnTarget.away += 1;
    } else if (eventType === 'ADVANCE_5') {
      minute = Math.min(90, minute + 5);
    }

    const inPlay = LiveMatchEngine.calculateInPlayProbabilities(homeScore, awayScore, minute);

    const updatedMeta: LiveMatchMetadata = {
      ...meta,
      minute,
      events,
      lastUpdated: new Date().toISOString(),
      inPlayProbabilities: inPlay,
    };

    await db
      .update(matches)
      .set({
        homeScoreFullTime: homeScore,
        awayScoreFullTime: awayScore,
        metadata: updatedMeta,
      })
      .where(eq(matches.id, matchId));

    return {
      matchId,
      homeScore,
      awayScore,
      minute,
      updatedMeta,
    };
  }
}
