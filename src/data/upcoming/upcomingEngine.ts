import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  competitions,
  evidenceSnapshots,
  historicalOdds,
  matches,
  predictionLedger,
  seasons,
  teams,
} from '../../db/schema.ts';
import { PredictionEngine } from '../../models/engine.ts';
import { HistoricalEvidenceEngine } from '../../evidence/historical/h2hEngine.ts';
import { WebIntelligenceEngine } from '../../evidence/web/webIntelligence.ts';
import { FootballDataProvider } from '../providers/footballDataProvider.ts';
import { ApiFootballProvider } from '../providers/apiFootballProvider.ts';
import { IdentityResolver } from '../identity/resolver.ts';

import type { PredictionQueueStatus, UpcomingMatchItem, UpcomingDashboardResponse } from '../../types/football.ts';
export type { PredictionQueueStatus, UpcomingMatchItem, UpcomingDashboardResponse };

export class UpcomingEngine {
  private static isEnsuring: boolean = false;

  /**
   * Format duration in minutes into a human-readable countdown string (e.g., "35m", "1h 40m")
   */
  public static formatStartsIn(minutesRemaining: number): string {
    if (minutesRemaining <= 0) return 'Kickoff Reached (Locked)';
    const hours = Math.floor(minutesRemaining / 60);
    const mins = minutesRemaining % 60;
    if (hours === 0) return `${mins}m`;
    if (mins === 0) return `${hours}h`;
    return `${hours}h ${mins}m`;
  }

  /**
   * Ensures realistic dynamic fixtures exist relative to current time across time horizons.
   */
  /**
   * Synchronizes real upcoming fixtures from active configured providers into PostgreSQL.
   * CRITICAL INTEGRITY: Never artificially shifts kickoff times or creates fake fixtures.
   * Real fixtures maintain their verified official kickoff timestamp.
   */
  public static async ensureUpcomingFixtures(): Promise<void> {
    if (this.isEnsuring) return;
    this.isEnsuring = true;

    try {
      const now = new Date();
      // Check if we have sufficient verified upcoming scheduled fixtures
      const existingScheduled = await db
        .select({ id: matches.id })
        .from(matches)
        .where(
          and(
            eq(matches.status, 'SCHEDULED'),
            gte(matches.kickoffTime, new Date(now.getTime() - 15 * 60 * 1000))
          )
        )
        .limit(5);

      if (existingScheduled.length >= 5) {
        return; // Database already holds active upcoming fixtures
      }

      // Query active providers for genuine upcoming fixtures
      let rawMatches: any[] = [];
      if (process.env.FOOTBALL_DATA_API_KEY) {
        try {
          const fd = new FootballDataProvider();
          rawMatches = await fd.fetchUpcomingMatches();
        } catch (e: any) {
          console.warn('[UpcomingEngine] Football-Data sync notice:', e?.message);
        }
      }

      if (rawMatches.length === 0 && process.env.API_FOOTBALL_KEY && !ApiFootballProvider.isInCircuitBreakerCooldown()) {
        try {
          const apiFootball = new ApiFootballProvider();
          rawMatches = await apiFootball.fetchUpcomingFixtures({ date: now.toISOString().split('T')[0] });
        } catch (e: any) {
          console.warn('[UpcomingEngine] API-Football sync notice:', e?.message);
        }
      }

      if (rawMatches.length < 5) {
        try {
          const { LiveWebFeedProvider } = await import('../providers/liveWebFeedProvider.ts');
          const webFeed = new LiveWebFeedProvider();
          const bundle = await webFeed.fetchWebScoreboardBundle();
          const webUpcoming = bundle.upcoming.map((item) => webFeed.toNormalizedMatch(item));
          if (webUpcoming.length > 0) {
            rawMatches = [...rawMatches, ...webUpcoming];
          }
        } catch (e: any) {
          console.warn('[UpcomingEngine] Live Web Feed sync notice:', e?.message);
        }
      }

      if (rawMatches.length === 0) return;

      // Ingest into PostgreSQL with deduplication and identity resolution
      for (const m of rawMatches.slice(0, 30)) {
        try {
          const [comp] = await db
            .select()
            .from(competitions)
            .where(eq(competitions.code, m.competitionCode))
            .limit(1);

          if (!comp) continue;

          let [season] = await db
            .select()
            .from(seasons)
            .where(and(eq(seasons.competitionId, comp.id), eq(seasons.seasonCode, m.seasonCode)))
            .limit(1);

          if (!season) {
            const parts = String(m.seasonCode || '').split('-').map((p) => parseInt(p, 10)).filter((n) => !isNaN(n));
            const fallbackYear = m.kickoffTime ? new Date(m.kickoffTime).getUTCFullYear() : new Date().getUTCFullYear();
            const yearStart = parts[0] || fallbackYear;
            const yearEnd = parts[1] || yearStart;
            const [newSeason] = await db
              .insert(seasons)
              .values({
                competitionId: comp.id,
                seasonCode: m.seasonCode,
                yearStart,
                yearEnd,
                isCurrent: true,
              })
              .returning();
            season = newSeason;
          }

          const home = await IdentityResolver.resolveTeam(m.homeTeamRawName, comp.country, m.providerSource);
          const away = await IdentityResolver.resolveTeam(m.awayTeamRawName, comp.country, m.providerSource);

          const [existing] = await db
            .select({ id: matches.id })
            .from(matches)
            .where(and(eq(matches.providerSource, m.providerSource), eq(matches.externalId, m.externalId)))
            .limit(1);

          if (!existing) {
            await db.insert(matches).values({
              externalId: m.externalId,
              providerSource: m.providerSource,
              competitionId: comp.id,
              seasonId: season.id,
              round: m.round,
              matchday: m.matchday,
              kickoffTime: m.kickoffTime,
              homeTeamId: home.id,
              awayTeamId: away.id,
              venue: m.venue,
              status: m.status,
              result: m.result,
              metadata: m.metadata,
            });
          }
        } catch (err: any) {
          // Continue with remaining matches
        }
      }
    } catch (err: any) {
      console.warn('[UpcomingEngine] ensureUpcomingFixtures notice:', err?.message);
    } finally {
      this.isEnsuring = false;
    }
  }

  /**
   * Pre-generates prediction for matches within 2 hours if not already generated
   */
  public static async autoPredictActiveWindowMatches(upcomingMatches: any[]): Promise<void> {
    try {
      const now = new Date();
      for (const m of upcomingMatches) {
        const diffMs = new Date(m.kickoffTime).getTime() - now.getTime();
        const diffHours = diffMs / (1000 * 60 * 60);

        // Automatically pre-generate predictions for fixtures starting within 2 hours
        if (diffHours > 0 && diffHours <= 2) {
          const [existingLedger] = await db
            .select()
            .from(predictionLedger)
            .where(eq(predictionLedger.matchId, m.id))
            .limit(1);

          if (!existingLedger) {
            await this.generatePredictionForMatch(m.id);
          }
        }
      }
    } catch (err) {
      console.warn('Auto prediction generation warning:', err);
    }
  }

  /**
   * Runs the full prediction pipeline for a specific match fixture and stores it in the immutable ledger.
   */
  public static async generatePredictionForMatch(
    matchId: number,
    options?: {
      modelVersion?: string;
      customAbsences?: any[];
      marketOdds?: { homeOdds: number; drawOdds: number; awayOdds: number };
    }
  ): Promise<any> {
    const [matchRecord] = await db
      .select({
        id: matches.id,
        kickoffTime: matches.kickoffTime,
        status: matches.status,
        competitionId: matches.competitionId,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
        venue: matches.venue,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!matchRecord) {
      throw new Error(`Match with ID ${matchId} does not exist.`);
    }

    const now = new Date();
    const kickoffDate = new Date(matchRecord.kickoffTime);

    // Safety checks: KICKOFF LOCK
    if (now >= kickoffDate && matchRecord.status !== 'SCHEDULED') {
      throw new Error('KICKOFF LOCK: Prediction cannot be generated for a match that has already kicked off.');
    }

    if (matchRecord.status === 'POSTPONED' || matchRecord.status === 'CANCELLED') {
      throw new Error(`Fixture is marked ${matchRecord.status}. Prediction generation is suspended.`);
    }

    // Retrieve teams & competition
    const [homeTeam] = await db.select().from(teams).where(eq(teams.id, matchRecord.homeTeamId)).limit(1);
    const [awayTeam] = await db.select().from(teams).where(eq(teams.id, matchRecord.awayTeamId)).limit(1);
    const [comp] = await db.select().from(competitions).where(eq(competitions.id, matchRecord.competitionId)).limit(1);

    if (!homeTeam || !awayTeam) {
      throw new Error('Team records missing for this fixture.');
    }

    // Resolve pre-kickoff ratings & historical evidence strictly prior to kickoff
    const [homeRating, awayRating, h2hSummary, homeForm, awayForm, webNews, storedOdds] = await Promise.all([
      HistoricalEvidenceEngine.getEffectiveTeamRating(homeTeam.id, kickoffDate),
      HistoricalEvidenceEngine.getEffectiveTeamRating(awayTeam.id, kickoffDate),
      HistoricalEvidenceEngine.getH2HRecord(homeTeam.id, awayTeam.id, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(homeTeam.id, true, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(awayTeam.id, false, kickoffDate),
      WebIntelligenceEngine.gatherPreMatchIntelligence(
        homeTeam.canonicalName,
        awayTeam.canonicalName,
        kickoffDate,
        comp?.code
      ),
      db
        .select()
        .from(historicalOdds)
        .where(and(eq(historicalOdds.matchId, matchRecord.id), eq(historicalOdds.marketType, 'MATCH_WINNER'))),
    ]);

    let resolvedMarketOdds = options?.marketOdds;
    if (!resolvedMarketOdds && storedOdds.length >= 3) {
      const hOdd = storedOdds.find((o) => o.selection === 'HOME')?.decimalOdds;
      const dOdd = storedOdds.find((o) => o.selection === 'DRAW')?.decimalOdds;
      const aOdd = storedOdds.find((o) => o.selection === 'AWAY')?.decimalOdds;
      if (hOdd && dOdd && aOdd && hOdd > 1 && dOdd > 1 && aOdd > 1) {
        resolvedMarketOdds = { homeOdds: hOdd, drawOdds: dOdd, awayOdds: aOdd };
      }
    }

    const existingLedgers = await db
      .select({ id: predictionLedger.id, modelVersion: predictionLedger.modelVersion })
      .from(predictionLedger)
      .where(eq(predictionLedger.matchId, matchRecord.id))
      .orderBy(desc(predictionLedger.predictionTimestamp));

    const versionIndex = existingLedgers.length + 1;
    const versionLabel = options?.modelVersion || `v${versionIndex}-institutional-ensemble`;
    const sampleCount = homeForm.sampleMatches + awayForm.sampleMatches + h2hSummary.totalH2HMatches;
    const hasRatings = !homeRating.isBaselineDefault || !awayRating.isBaselineDefault;

    const predictionResult = PredictionEngine.calculatePrediction({
      homeTeam: homeTeam.canonicalName,
      awayTeam: awayTeam.canonicalName,
      competition: comp ? comp.name : 'Top Flight',
      venue: matchRecord.venue || homeTeam.venueName || 'Main Stadium',
      kickoffTime: kickoffDate,
      homeElo: homeRating.overallElo,
      awayElo: awayRating.overallElo,
      homeAttack: homeRating.attackRating,
      awayAttack: awayRating.attackRating,
      homeDefense: homeRating.defenseRating,
      awayDefense: awayRating.defenseRating,
      sampleMatchesCount: sampleCount,
      absences: options?.customAbsences && options.customAbsences.length > 0
        ? options.customAbsences
        : webNews.verifiedAbsences,
      marketOdds: resolvedMarketOdds,
      hasTeamRatings: hasRatings,
      hasWebIntelligence: webNews.retrievalStatus !== 'UNAVAILABLE',
      webIntelligenceReliability: webNews.overallIntelligenceReliability,
    });

    // Create Pre-Match Immutable Snapshot
    const [snapshot] = await db
      .insert(evidenceSnapshots)
      .values({
        matchId: matchRecord.id,
        snapshotTimestamp: new Date(),
        h2hData: {
          directH2HFound: h2hSummary.directH2HFound,
          totalH2HMatches: h2hSummary.totalH2HMatches,
          homeWins: h2hSummary.homeWins,
          draws: h2hSummary.draws,
          awayWins: h2hSummary.awayWins,
          avgHomeGoals: h2hSummary.avgHomeGoals,
          avgAwayGoals: h2hSummary.avgAwayGoals,
        },
        recentFormData: {
          homeFormString: homeForm.formString,
          homePPG: homeForm.pointsPerGame,
          awayFormString: awayForm.formString,
          awayPPG: awayForm.pointsPerGame,
        },
        webIntelligenceData: webNews,
        sourceReliabilityScore: webNews.overallIntelligenceReliability,
        dataQualityScore: predictionResult.dataQuality.score,
        missingFields: predictionResult.dataQuality.missingInputs || [],
        isImmutable: true,
      })
      .returning();

    // Record in Prediction Ledger (Never overwrite original!)
    const [savedLedger] = await db
      .insert(predictionLedger)
      .values({
        matchId: matchRecord.id,
        snapshotId: snapshot.id,
        predictionTimestamp: new Date(),
        kickoffTime: kickoffDate,
        modelVersion: versionLabel,
        isLocked: true,
        homeWinProb: predictionResult.prediction.homeWin,
        drawProb: predictionResult.prediction.draw,
        awayWinProb: predictionResult.prediction.awayWin,
        expectedHomeGoals: predictionResult.expectedGoals.home,
        expectedAwayGoals: predictionResult.expectedGoals.away,
        totalExpectedGoals: predictionResult.expectedGoals.total,
        mostLikelyScore: predictionResult.mostLikelyScores[0]?.score || '1-1',
        scoreProbabilities: predictionResult.mostLikelyScores,
        modelBreakdown: predictionResult.models,
        ensembleWeights: { dixonColes: 0.30, monteCarlo: 0.25, elo: 0.20, poisson: 0.15, xg: 0.10 },
        confidenceScore: predictionResult.confidence.score,
        confidenceReason: predictionResult.confidence.reason,
      })
      .returning();

    return {
      matchId: matchRecord.id,
      snapshotId: snapshot.id,
      ledgerId: savedLedger.id,
      versionIndex,
      ...predictionResult,
      modelVersion: versionLabel,
      evidenceHierarchy: {
        h2h: h2hSummary,
        homeForm,
        awayForm,
        webIntelligence: webNews,
      },
    };
  }

  /**
   * Retrieves the comprehensive upcoming dashboard dataset
   */
  public static async getUpcomingDashboard(options: {
    hours?: number;
    competition?: string;
  } = {}): Promise<UpcomingDashboardResponse> {
    await this.ensureUpcomingFixtures();

    const now = new Date();
    const allMatchesQuery = db
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
        venue: matches.venue,
        metadata: matches.metadata,
      })
      .from(matches)
      .innerJoin(competitions, eq(matches.competitionId, competitions.id))
      .where(
        and(
          eq(matches.status, 'SCHEDULED'),
          gte(matches.kickoffTime, new Date(now.getTime() - 15 * 60 * 1000)) // Include matches starting right now or future
        )
      )
      .orderBy(matches.kickoffTime);

    const rawUpcoming = await allMatchesQuery;

    // Pre-generate predictions for active window
    await this.autoPredictActiveWindowMatches(rawUpcoming);

    // Query teams
    const allTeams = await db.select().from(teams);
    const teamMap = new Map(allTeams.map((t) => [t.id, t]));

    const upcomingMatchIds = rawUpcoming.map((m) => m.id);
    const ledgerByMatchId = new Map<number, any[]>();
    const snapshotMap = new Map<number, typeof evidenceSnapshots.$inferSelect>();

    if (upcomingMatchIds.length > 0) {
      const relevantLedger = await db
        .select()
        .from(predictionLedger)
        .where(inArray(predictionLedger.matchId, upcomingMatchIds))
        .orderBy(desc(predictionLedger.predictionTimestamp));

      const snapshotIds: number[] = [];
      for (const row of relevantLedger) {
        if (!ledgerByMatchId.has(row.matchId)) {
          ledgerByMatchId.set(row.matchId, []);
          if (typeof row.snapshotId === 'number') {
            snapshotIds.push(row.snapshotId);
          }
        }
        ledgerByMatchId.get(row.matchId)!.push(row);
      }

      if (snapshotIds.length > 0) {
        const snaps = await db
          .select()
          .from(evidenceSnapshots)
          .where(inArray(evidenceSnapshots.id, snapshotIds));
        for (const s of snaps) {
          snapshotMap.set(s.id, s);
        }
      }
    }

    // Windows calculation
    let next1Hour = 0;
    let next2Hours = 0;
    let next3Hours = 0;
    let next4Hours = 0;
    let next5Hours = 0;
    let todayCount = 0;
    let tomorrowCount = 0;

    const endOfToday = new Date(now);
    endOfToday.setUTCHours(23, 59, 59, 999);

    const endOfTomorrow = new Date(endOfToday);
    endOfTomorrow.setUTCDate(endOfTomorrow.getUTCDate() + 1);

    const enrichedMatches: UpcomingMatchItem[] = [];

    for (const m of rawUpcoming) {
      const kickoff = new Date(m.kickoffTime);
      const diffMs = kickoff.getTime() - now.getTime();
      const diffMins = Math.round(diffMs / (60 * 1000));
      const diffHours = diffMs / (1000 * 60 * 60);

      // Tally window statistics
      if (diffHours >= 0 && diffHours <= 1) next1Hour++;
      if (diffHours >= 0 && diffHours <= 2) next2Hours++;
      if (diffHours >= 0 && diffHours <= 3) next3Hours++;
      if (diffHours >= 0 && diffHours <= 4) next4Hours++;
      if (diffHours >= 0 && diffHours <= 5) next5Hours++;

      if (kickoff <= endOfToday && kickoff >= now) {
        todayCount++;
      } else if (kickoff > endOfToday && kickoff <= endOfTomorrow) {
        tomorrowCount++;
      }

      // Check prediction history
      const matchLedgers = ledgerByMatchId.get(m.id) || [];
      const latestLedger = matchLedgers[0] || null;

      // Determine Prediction Queue Status
      let queueStatus: PredictionQueueStatus = 'NOT_YET_GENERATED';
      if (latestLedger) {
        queueStatus = 'READY';
      } else if (diffHours <= 5 && diffHours >= 0) {
        queueStatus = 'PENDING';
      } else {
        queueStatus = 'NOT_YET_GENERATED';
      }

      const home = teamMap.get(m.homeTeamId);
      const away = teamMap.get(m.awayTeamId);

      // Prediction details if generated
      let predictionSummary = undefined;
      if (latestLedger) {
        const homeProb = latestLedger.homeWinProb;
        const drawProb = latestLedger.drawProb;
        const awayProb = latestLedger.awayWinProb;

        const snap = latestLedger.snapshotId ? snapshotMap.get(latestLedger.snapshotId) : undefined;
        const storedQuality = snap?.dataQualityScore ?? latestLedger.confidenceScore ?? 0.5;
        const qualityRating =
          storedQuality >= 0.80
            ? ('EXCELLENT' as const)
            : storedQuality >= 0.65
            ? ('GOOD' as const)
            : storedQuality >= 0.45
            ? ('MODERATE' as const)
            : ('LIMITED' as const);
        const missingFields = Array.isArray(snap?.missingFields) ? (snap.missingFields as string[]) : [];
        const confScore = latestLedger.confidenceScore ?? 0.5;

        predictionSummary = {
          ledgerId: latestLedger.id,
          modelVersion: latestLedger.modelVersion,
          versionNumber: matchLedgers.length,
          predictionTimestamp: latestLedger.predictionTimestamp
            ? new Date(latestLedger.predictionTimestamp).toISOString()
            : new Date().toISOString(),
          isLocked: diffMs <= 0,
          probabilities: {
            homeWin: homeProb,
            draw: drawProb,
            awayWin: awayProb,
          },
          expectedGoals: {
            home: latestLedger.expectedHomeGoals,
            away: latestLedger.expectedAwayGoals,
            total: latestLedger.totalExpectedGoals,
          },
          fairOdds: {
            home: homeProb > 0 ? parseFloat((1 / homeProb).toFixed(2)) : 0,
            draw: drawProb > 0 ? parseFloat((1 / drawProb).toFixed(2)) : 0,
            away: awayProb > 0 ? parseFloat((1 / awayProb).toFixed(2)) : 0,
          },
          mostLikelyScore: latestLedger.mostLikelyScore,
          confidenceScore: confScore,
          confidenceLevel:
            confScore >= 0.78 && qualityRating === 'EXCELLENT'
              ? ('HIGH' as const)
              : confScore >= 0.55
              ? ('MEDIUM' as const)
              : ('LOW' as const),
          confidenceReason:
            latestLedger.confidenceReason ??
            'Calculated using historical Elo ratings and Dixon-Coles ensemble probabilities.',
          dataQuality: {
            score: Number(storedQuality.toFixed(2)),
            rating: qualityRating,
            factors: missingFields.length > 0 ? missingFields : ['Pre-match DB snapshot persisted'],
          },
          totalVersionsCount: matchLedgers.length,
        };
      }

      enrichedMatches.push({
        id: m.id,
        externalId: m.externalId || `UPCOMING_${m.id}`,
        competitionId: m.competitionId,
        competitionName: m.competitionName,
        competitionCode: m.competitionCode,
        round: m.round || 'Regular Fixture',
        venue: m.venue || 'Main Stadium',
        kickoffTime: kickoff.toISOString(),
        kickoffDate: kickoff.toLocaleDateString(),
        startsInMinutes: diffMins,
        startsInFormatted: this.formatStartsIn(diffMins),
        status: m.status as any,
        homeTeamId: m.homeTeamId,
        homeTeam: home?.canonicalName || 'Home Team',
        homeShortName: home?.shortName || 'Home',
        awayTeamId: m.awayTeamId,
        awayTeam: away?.canonicalName || 'Away Team',
        awayShortName: away?.shortName || 'Away',
        queueStatus,
        isLocked: diffMs <= 0,
        prediction: predictionSummary,
      });
    }

    // Apply hour filtering if requested (1, 2, 3, 4, 5)
    let filteredMatches = enrichedMatches;
    if (options.hours && options.hours > 0) {
      const maxMs = options.hours * 60 * 60 * 1000;
      filteredMatches = enrichedMatches.filter((m) => {
        const ms = new Date(m.kickoffTime).getTime() - now.getTime();
        return ms >= 0 && ms <= maxMs;
      });
    }

    if (options.competition && options.competition !== 'ALL') {
      filteredMatches = filteredMatches.filter(
        (m) => m.competitionCode.toUpperCase() === options.competition!.toUpperCase()
      );
    }

    // Sort queue priority: closest kickoff first
    filteredMatches.sort((a, b) => a.startsInMinutes - b.startsInMinutes);

    const readyCount = enrichedMatches.filter((m) => m.queueStatus === 'READY').length;
    const pendingCount = enrichedMatches.filter((m) => m.queueStatus === 'PENDING').length;
    const notGeneratedCount = enrichedMatches.filter((m) => m.queueStatus === 'NOT_YET_GENERATED').length;

    return {
      currentTime: now.toISOString(),
      requestedHoursWindow: options.hours || null,
      windowsSummary: {
        next1Hour,
        next2Hours,
        next3Hours,
        next4Hours,
        next5Hours,
        today: todayCount,
        tomorrow: tomorrowCount,
        totalUpcoming: enrichedMatches.length,
      },
      queueSummary: {
        ready: readyCount,
        pending: pendingCount,
        notYetGenerated: notGeneratedCount,
        total: enrichedMatches.length,
      },
      matches: filteredMatches,
    };
  }

  /**
   * Retrieves all historical prediction versions for a match.
   */
  public static async getMatchPredictions(matchId: number): Promise<any[]> {
    const versions = await db
      .select()
      .from(predictionLedger)
      .where(eq(predictionLedger.matchId, matchId))
      .orderBy(desc(predictionLedger.predictionTimestamp));

    return versions.map((v, i) => ({
      versionIndex: versions.length - i,
      id: v.id,
      matchId: v.matchId,
      modelVersion: v.modelVersion,
      predictionTimestamp: v.predictionTimestamp,
      kickoffTime: v.kickoffTime,
      probabilities: {
        homeWin: v.homeWinProb,
        draw: v.drawProb,
        awayWin: v.awayWinProb,
      },
      expectedGoals: {
        home: v.expectedHomeGoals,
        away: v.expectedAwayGoals,
        total: v.totalExpectedGoals,
      },
      mostLikelyScore: v.mostLikelyScore,
      scoreProbabilities: v.scoreProbabilities,
      modelBreakdown: v.modelBreakdown,
      confidenceScore: v.confidenceScore,
      confidenceReason: v.confidenceReason,
      isLocked: v.isLocked,
    }));
  }
}
