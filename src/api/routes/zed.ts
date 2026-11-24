import { Router, Response } from 'express';
import { zedAuthMiddleware, ZedAuthenticatedRequest } from '../../middleware/zedAuth.ts';
import { dbClient } from '../../db/databaseClient.ts';
import { UpcomingEngine } from '../../data/upcoming/upcomingEngine.ts';
import { PredictionEngine } from '../../models/engine.ts';
import { IdentityResolver } from '../../data/identity/resolver.ts';
import { HistoricalEvidenceEngine } from '../../evidence/historical/h2hEngine.ts';
import { WebIntelligenceEngine } from '../../evidence/web/webIntelligence.ts';
import { NewsEngine } from '../../data/news/newsEngine.ts';
import { db } from '../../db/index.ts';
import { competitions, matches, teams } from '../../db/schema.ts';
import { eq } from 'drizzle-orm';

export const zedRouter = Router();

// Apply secure S2S authentication & request correlation tracing to all /api/v1/zed routes
zedRouter.use(zedAuthMiddleware);

// GET /api/v1/zed/health
zedRouter.get('/health', async (req: ZedAuthenticatedRequest, res: Response) => {
  const dbStatus = await dbClient.verifyConnection();
  const counts = dbStatus.connected ? await dbClient.getRecordCounts() : null;

  res.json({
    service: 'PitchIntel Football Intelligence Service for Zed',
    version: '1.0.0-s2s',
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
    status: dbStatus.connected ? 'ONLINE' : 'DEGRADED',
    database: {
      status: dbStatus.connected ? 'CONNECTED' : 'DISCONNECTED',
      latencyMs: dbStatus.latencyMs,
      serverVersion: dbStatus.serverVersion,
      records: counts,
    },
    capabilities: [
      'upcoming_fixtures_1_to_5h',
      'statistical_match_predictions',
      'dixon_coles_poisson',
      'head_to_head_intelligence',
      'verified_football_news',
    ],
  });
});

// GET /api/v1/zed/upcoming
zedRouter.get('/upcoming', async (req: ZedAuthenticatedRequest, res: Response) => {
  try {
    const hours = req.query.hours ? parseInt(req.query.hours as string, 10) : 5;
    const competition = req.query.competition as string | undefined;
    const timezone = (req.query.timezone as string) || 'Africa/Lusaka';

    const dashboard = await UpcomingEngine.getUpcomingDashboard({
      hours: !isNaN(hours) ? hours : 5,
      competition,
    });

    // Format matches for Zed assistant consumption
    const formattedMatches = dashboard.matches.map((m: any) => {
      let kickoffFormatted = m.kickoffTime;
      try {
        kickoffFormatted = new Date(m.kickoffTime).toLocaleString('en-GB', {
          timeZone: timezone,
          weekday: 'short',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      } catch {
        // Fallback to UTC string
      }

      return {
        id: m.id,
        competition: m.competitionName,
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        kickoffUtc: m.kickoffTime,
        kickoffLocal: kickoffFormatted,
        timezone,
        startsInFormatted: m.startsInFormatted,
        startsInMinutes: m.startsInMinutes,
        predictionAvailable: Boolean(m.prediction),
        quickPrediction: m.prediction
          ? {
              homeWinProb: `${(m.prediction.probabilities.homeWin * 100).toFixed(1)}%`,
              drawProb: `${(m.prediction.probabilities.draw * 100).toFixed(1)}%`,
              awayWinProb: `${(m.prediction.probabilities.awayWin * 100).toFixed(1)}%`,
              mostLikelyScore: m.prediction.mostLikelyScore,
              confidence: m.prediction.confidenceLevel,
            }
          : null,
      };
    });

    res.json({
      requestId: req.requestId,
      timezone,
      requestedHours: hours,
      totalUpcoming: formattedMatches.length,
      windowsSummary: dashboard.windowsSummary,
      matches: formattedMatches,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to query upcoming matches', requestId: req.requestId });
  }
});

// POST /api/v1/zed/predict
zedRouter.post('/predict', async (req: ZedAuthenticatedRequest, res: Response) => {
  try {
    const { homeTeam, awayTeam, competition, fixtureId } = req.body;

    let targetFixtureId: number | null = null;
    let homeName = homeTeam;
    let awayName = awayTeam;
    let compName = competition || 'Premier League';
    let compCode: string | undefined;
    let kickoffTime = new Date().toISOString();

    if (fixtureId) {
      targetFixtureId = parseInt(fixtureId, 10);
      const [foundMatch] = await db.select().from(matches).where(eq(matches.id, targetFixtureId)).limit(1);
      if (foundMatch) {
        const [hTeam] = await db.select().from(teams).where(eq(teams.id, foundMatch.homeTeamId)).limit(1);
        const [aTeam] = await db.select().from(teams).where(eq(teams.id, foundMatch.awayTeamId)).limit(1);
        const [comp] = await db.select().from(competitions).where(eq(competitions.id, foundMatch.competitionId)).limit(1);
        homeName = hTeam?.canonicalName || homeName;
        awayName = aTeam?.canonicalName || awayName;
        compName = comp?.name || compName;
        compCode = comp?.code;
        kickoffTime = new Date(foundMatch.kickoffTime).toISOString();
      }
    }

    if (!homeName || !awayName) {
      return res.status(400).json({
        error: 'Provide either fixtureId or homeTeam & awayTeam',
        requestId: req.requestId,
      });
    }

    const kickoffDate = new Date(kickoffTime);
    const resolvedHome = await IdentityResolver.resolveTeam(homeName);
    const resolvedAway = await IdentityResolver.resolveTeam(awayName);

    const [homeRating, awayRating, h2hSummary, homeForm, awayForm, webNews] = await Promise.all([
      HistoricalEvidenceEngine.getEffectiveTeamRating(resolvedHome.id, kickoffDate),
      HistoricalEvidenceEngine.getEffectiveTeamRating(resolvedAway.id, kickoffDate),
      HistoricalEvidenceEngine.getH2HRecord(resolvedHome.id, resolvedAway.id, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(resolvedHome.id, true, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(resolvedAway.id, false, kickoffDate),
      WebIntelligenceEngine.gatherPreMatchIntelligence(
        resolvedHome.canonicalName,
        resolvedAway.canonicalName,
        kickoffDate,
        compCode
      ),
    ]);

    const predictionResult = PredictionEngine.calculatePrediction({
      homeTeam: resolvedHome.canonicalName,
      awayTeam: resolvedAway.canonicalName,
      competition: compName,
      venue: resolvedHome.venueName || 'Home Stadium',
      kickoffTime: kickoffDate,
      homeElo: homeRating.overallElo,
      awayElo: awayRating.overallElo,
      homeAttack: homeRating.attackRating,
      awayAttack: awayRating.attackRating,
      homeDefense: homeRating.defenseRating,
      awayDefense: awayRating.defenseRating,
      sampleMatchesCount: homeForm.sampleMatches + awayForm.sampleMatches + h2hSummary.totalH2HMatches,
      absences: webNews.verifiedAbsences.map((a) => ({
        name: a.playerName,
        role: a.impactScore >= 0.2 ? ('PRIMARY_GOALSCORER' as const) : ('PRIMARY_PLAYMAKER' as const),
        team:
          a.team.toLowerCase() === resolvedHome.canonicalName.toLowerCase()
            ? ('HOME' as const)
            : ('AWAY' as const),
        status: a.confirmed ? ('CONFIRMED_OUT' as const) : ('DOUBTFUL_75' as const),
      })),
      hasTeamRatings: !homeRating.isBaselineDefault || !awayRating.isBaselineDefault,
      hasWebIntelligence: webNews.retrievalStatus !== 'UNAVAILABLE',
      webIntelligenceReliability: webNews.overallIntelligenceReliability,
    });

    const homeWinPct = (predictionResult.prediction.homeWin * 100).toFixed(1);
    const drawPct = (predictionResult.prediction.draw * 100).toFixed(1);
    const awayWinPct = (predictionResult.prediction.awayWin * 100).toFixed(1);
    const scoreline = predictionResult.mostLikelyScores[0]?.score || '1 - 1';

    // Generate natural language markdown summary tailored for Zed's chat response
    const zedSummaryMarkdown = `### ⚽ ${resolvedHome.canonicalName} vs ${resolvedAway.canonicalName} Forecast
* **Win Probabilities**: ${resolvedHome.canonicalName} ${homeWinPct}% | Draw ${drawPct}% | ${resolvedAway.canonicalName} ${awayWinPct}%
* **Projected Score**: **${scoreline}** (Expected Goals: ${predictionResult.expectedGoals.home} - ${predictionResult.expectedGoals.away})
* **Model Confidence**: **${predictionResult.confidence.level}** (${predictionResult.confidence.reason})
* **Head-to-Head Evidence**: ${h2hSummary.totalH2HMatches} historical meetings (${h2hSummary.homeWins} home wins, ${h2hSummary.draws} draws, ${h2hSummary.awayWins} away wins)
* **Team Form**: ${resolvedHome.canonicalName} (${homeForm.formString}) vs ${resolvedAway.canonicalName} (${awayForm.formString})`;

    res.json({
      requestId: req.requestId,
      homeTeam: homeName,
      awayTeam: awayName,
      competition: compName,
      kickoffTime,
      probabilities: {
        homeWin: Number((predictionResult.prediction.homeWin * 100).toFixed(1)),
        draw: Number((predictionResult.prediction.draw * 100).toFixed(1)),
        awayWin: Number((predictionResult.prediction.awayWin * 100).toFixed(1)),
      },
      fairOdds: predictionResult.fairOdds,
      expectedGoals: predictionResult.expectedGoals,
      mostLikelyScore: scoreline,
      confidence: predictionResult.confidence,
      dataQuality: predictionResult.dataQuality,
      zedSummaryMarkdown,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Prediction failed', requestId: req.requestId });
  }
});

// GET /api/v1/zed/h2h
zedRouter.get('/h2h', async (req: ZedAuthenticatedRequest, res: Response) => {
  try {
    const homeTeam = req.query.home as string;
    const awayTeam = req.query.away as string;

    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'home and away query parameters are required', requestId: req.requestId });
    }

    const resolvedHome = await IdentityResolver.resolveTeam(homeTeam);
    const resolvedAway = await IdentityResolver.resolveTeam(awayTeam);

    const [h2hSummary, formA, formB] = await Promise.all([
      HistoricalEvidenceEngine.getH2HRecord(resolvedHome.id, resolvedAway.id),
      HistoricalEvidenceEngine.getTeamForm(resolvedHome.id, true),
      HistoricalEvidenceEngine.getTeamForm(resolvedAway.id, false),
    ]);

    res.json({
      requestId: req.requestId,
      homeTeam: resolvedHome.canonicalName,
      awayTeam: resolvedAway.canonicalName,
      totalEncounters: h2hSummary.totalH2HMatches,
      record: {
        homeWins: h2hSummary.homeWins,
        draws: h2hSummary.draws,
        awayWins: h2hSummary.awayWins,
      },
      goals: {
        avgHomeGoals: h2hSummary.avgHomeGoals,
        avgAwayGoals: h2hSummary.avgAwayGoals,
      },
      recentMeetings: h2hSummary.recentMeetings.slice(0, 5),
      homeForm: formA.formString,
      awayForm: formB.formString,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'H2H query failed', requestId: req.requestId });
  }
});

// GET /api/v1/zed/news
zedRouter.get('/news', async (req: ZedAuthenticatedRequest, res: Response) => {
  try {
    const category = req.query.category as string | undefined;
    const news = await NewsEngine.getFootballNews(category);
    res.json({
      requestId: req.requestId,
      lastRetrieved: news.lastRetrieved,
      articlesCount: news.articles.length,
      articles: news.articles.slice(0, 10),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'News query failed', requestId: req.requestId });
  }
});
