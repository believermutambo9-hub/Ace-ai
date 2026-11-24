import { eq, inArray } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  evidenceSnapshots,
  matches,
  predictionLedger,
  teams,
  competitions,
} from '../../db/schema.ts';
import { PredictionEngine } from '../../models/engine.ts';
import { HistoricalEvidenceEngine } from '../../evidence/historical/h2hEngine.ts';
import { WebIntelligenceEngine } from '../../evidence/web/webIntelligence.ts';

import type { IngestionMilestone, MatchProbabilityTrend, TrendTimelineResponse } from '../../types/football.ts';
export type { IngestionMilestone, MatchProbabilityTrend, TrendTimelineResponse };

function mapQualityRating(score: number | null | undefined): 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'LIMITED' {
  const s = score ?? 0.5;
  if (s >= 0.80) return 'EXCELLENT';
  if (s >= 0.65) return 'GOOD';
  if (s >= 0.45) return 'MODERATE';
  return 'LIMITED';
}

export class ProbabilityTrendEngine {
  /**
   * Fetches the chronological trend of real Ensemble Probability versions stored in prediction_ledger
   */
  public static async getTrendForMatch(matchId: number): Promise<MatchProbabilityTrend | null> {
    const [match] = await db
      .select({
        id: matches.id,
        kickoffTime: matches.kickoffTime,
        status: matches.status,
        competitionId: matches.competitionId,
        homeTeamId: matches.homeTeamId,
        awayTeamId: matches.awayTeamId,
      })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) return null;

    const [homeTeam] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, match.homeTeamId))
      .limit(1);

    const [awayTeam] = await db
      .select()
      .from(teams)
      .where(eq(teams.id, match.awayTeamId))
      .limit(1);

    const [comp] = await db
      .select()
      .from(competitions)
      .where(eq(competitions.id, match.competitionId))
      .limit(1);

    const homeName = homeTeam?.canonicalName || 'Home Team';
    const awayName = awayTeam?.canonicalName || 'Away Team';
    const compName = comp?.name || 'League';

    const ledgerRows = await db
      .select()
      .from(predictionLedger)
      .where(eq(predictionLedger.matchId, matchId))
      .orderBy(predictionLedger.predictionTimestamp);

    if (ledgerRows.length === 0) {
      return {
        matchId: match.id,
        homeTeam: homeName,
        awayTeam: awayName,
        competition: compName,
        kickoffTime: new Date(match.kickoffTime).toISOString(),
        status: match.status,
        totalDataSourcesIngested: 0,
        baselineEnsemble: { homeWin: 0, draw: 0, awayWin: 0 },
        currentEnsemble: { homeWin: 0, draw: 0, awayWin: 0 },
        netShift: { homeWin: 0, draw: 0, awayWin: 0 },
        milestones: [],
      };
    }

    const snapshotIds = ledgerRows
      .map((r) => r.snapshotId)
      .filter((id): id is number => typeof id === 'number');

    const snapshotMap = new Map<number, typeof evidenceSnapshots.$inferSelect>();
    if (snapshotIds.length > 0) {
      const snaps = await db
        .select()
        .from(evidenceSnapshots)
        .where(inArray(evidenceSnapshots.id, snapshotIds));
      for (const s of snaps) {
        snapshotMap.set(s.id, s);
      }
    }

    const kickoffMs = new Date(match.kickoffTime).getTime();
    return this.buildTrendFromLedgerRows(
      match,
      homeName,
      awayName,
      compName,
      kickoffMs,
      ledgerRows,
      snapshotMap
    );
  }

  /**
   * Builds trend strictly from authentic persisted prediction_ledger rows
   */
  private static buildTrendFromLedgerRows(
    match: any,
    homeTeam: string,
    awayTeam: string,
    competition: string,
    kickoffMs: number,
    ledgerRows: any[],
    snapshotMap: Map<number, typeof evidenceSnapshots.$inferSelect>
  ): MatchProbabilityTrend {
    const milestones: IngestionMilestone[] = [];

    ledgerRows.forEach((row, idx) => {
      const predTime = new Date(row.predictionTimestamp).getTime();
      const diffHours = Math.round((predTime - kickoffMs) / (60 * 60 * 1000));
      const relTimeStr = diffHours < 0 ? `T${diffHours}h` : `T+${diffHours}h`;
      const versionStr = String(row.modelVersion || '');

      let category: IngestionMilestone['sourceCategory'] = 'FINAL_ENSEMBLE';
      let sourceName = `Prediction Snapshot #${idx + 1}`;
      let sourceDesc = 'Pre-match evidence snapshot recorded in PostgreSQL ledger';

      if (idx === 0) {
        category = 'BASELINE';
        sourceName = 'Initial Pre-Match Ledger Snapshot';
        sourceDesc = 'Elo ratings, historical form sample, and statistical ensemble prior';
      } else if (versionStr.includes('breaking_absence') || versionStr.includes('lineup_confirmed')) {
        category = 'SQUAD_NEWS';
        sourceName = versionStr.includes('lineup_confirmed')
          ? 'Lineup Update Ingested'
          : 'Squad Absence Update Ingested';
        sourceDesc = 'Team strength and expected goals recalculated after squad update';
      } else if (versionStr.includes('market_odds_shift')) {
        category = 'MARKET_FLOW';
        sourceName = 'Bookmaker Market Quote Update';
        sourceDesc = 'External market odds ingested and compared against model fair price';
      } else if (versionStr.includes('weather_tactical')) {
        category = 'CONTEXT_FATIGUE';
        sourceName = 'Tactical & Contextual Re-evaluation';
        sourceDesc = 'Schedule congestion and match context re-evaluated';
      }

      const prevMilestone = milestones[idx - 1];
      const delta = prevMilestone
        ? {
            homeWin: Number(((row.homeWinProb - prevMilestone.probabilities.homeWin) * 100).toFixed(1)),
            draw: Number(((row.drawProb - prevMilestone.probabilities.draw) * 100).toFixed(1)),
            awayWin: Number(((row.awayWinProb - prevMilestone.probabilities.awayWin) * 100).toFixed(1)),
          }
        : undefined;

      const snap = row.snapshotId ? snapshotMap.get(row.snapshotId) : undefined;
      const qualityScore = snap?.dataQualityScore ?? row.confidenceScore ?? 0.5;

      milestones.push({
        id: `ledger-${row.id}`,
        versionIndex: idx + 1,
        timestamp: new Date(row.predictionTimestamp).toISOString(),
        relativeTime: relTimeStr,
        sourceCategory: category,
        sourceName,
        sourceDescription: sourceDesc,
        probabilities: {
          homeWin: Number(row.homeWinProb.toFixed(4)),
          draw: Number(row.drawProb.toFixed(4)),
          awayWin: Number(row.awayWinProb.toFixed(4)),
        },
        fairOdds: {
          home: Number((1 / Math.max(0.01, row.homeWinProb)).toFixed(2)),
          draw: Number((1 / Math.max(0.01, row.drawProb)).toFixed(2)),
          away: Number((1 / Math.max(0.01, row.awayWinProb)).toFixed(2)),
        },
        expectedGoals: {
          home: Number((row.expectedHomeGoals ?? 0).toFixed(2)),
          away: Number((row.expectedAwayGoals ?? 0).toFixed(2)),
          total: Number((row.totalExpectedGoals ?? 0).toFixed(2)),
        },
        deltaFromPrev: delta,
        keyEvidence: row.confidenceReason || 'Calibrated multi-model consensus snapshot stored in PostgreSQL.',
        confidenceScore: Number((row.confidenceScore ?? 0).toFixed(3)),
        dataQuality: mapQualityRating(qualityScore),
        modelVersion: versionStr || `v${idx + 1}.0`,
        isLocked: Boolean(row.isLocked),
        isCurrent: idx === ledgerRows.length - 1,
      });
    });

    const first = milestones[0];
    const last = milestones[milestones.length - 1];

    return {
      matchId: match.id,
      homeTeam,
      awayTeam,
      competition,
      kickoffTime: new Date(match.kickoffTime).toISOString(),
      status: match.status,
      totalDataSourcesIngested: milestones.length,
      baselineEnsemble: first.probabilities,
      currentEnsemble: last.probabilities,
      netShift: {
        homeWin: Number(((last.probabilities.homeWin - first.probabilities.homeWin) * 100).toFixed(1)),
        draw: Number(((last.probabilities.draw - first.probabilities.draw) * 100).toFixed(1)),
        awayWin: Number(((last.probabilities.awayWin - first.probabilities.awayWin) * 100).toFixed(1)),
      },
      milestones,
    };
  }

  /**
   * Ingests an authentic source update (e.g., confirmed absence or full 3-way market odds),
   * recalculates using real DB team ratings & form, and persists a snapshot + ledger entry.
   */
  public static async ingestLiveSourceUpdate(
    matchId: number,
    sourceType: 'BREAKING_ABSENCE' | 'MARKET_ODDS_SHIFT' | 'LINEUP_CONFIRMED' | 'WEATHER_TACTICAL',
    customPayload?: {
      absencePlayer?: string;
      absenceTeam?: 'HOME' | 'AWAY';
      marketOddsHome?: number;
      marketOddsDraw?: number;
      marketOddsAway?: number;
      notes?: string;
    }
  ): Promise<MatchProbabilityTrend> {
    const [match] = await db
      .select()
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    if (!match) {
      throw new Error(`Match #${matchId} not found`);
    }

    const [homeTeam] = await db.select().from(teams).where(eq(teams.id, match.homeTeamId)).limit(1);
    const [awayTeam] = await db.select().from(teams).where(eq(teams.id, match.awayTeamId)).limit(1);
    const [comp] = await db
      .select()
      .from(competitions)
      .where(eq(competitions.id, match.competitionId))
      .limit(1);

    const kickoffDate = new Date(match.kickoffTime);
    const homeName = homeTeam?.canonicalName || 'Home Team';
    const awayName = awayTeam?.canonicalName || 'Away Team';

    const [homeRating, awayRating, h2h, homeForm, awayForm, webIntel] = await Promise.all([
      HistoricalEvidenceEngine.getEffectiveTeamRating(match.homeTeamId, kickoffDate),
      HistoricalEvidenceEngine.getEffectiveTeamRating(match.awayTeamId, kickoffDate),
      HistoricalEvidenceEngine.getH2HRecord(match.homeTeamId, match.awayTeamId, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(match.homeTeamId, true, kickoffDate),
      HistoricalEvidenceEngine.getTeamForm(match.awayTeamId, false, kickoffDate),
      WebIntelligenceEngine.gatherPreMatchIntelligence(homeName, awayName, kickoffDate, comp?.code),
    ]);

    const absences: any[] = [...(webIntel.verifiedAbsences || [])];
    if (sourceType === 'BREAKING_ABSENCE' && customPayload?.absencePlayer) {
      const team = customPayload.absenceTeam || 'AWAY';
      absences.push({
        name: customPayload.absencePlayer,
        role: team === 'HOME' ? 'PRIMARY_GOALSCORER' : 'LEAD_CENTER_BACK',
        team,
        status: 'CONFIRMED_OUT',
      });
    }

    const hasCompleteMarketOdds =
      typeof customPayload?.marketOddsHome === 'number' &&
      customPayload.marketOddsHome > 1.0 &&
      typeof customPayload?.marketOddsDraw === 'number' &&
      customPayload.marketOddsDraw > 1.0 &&
      typeof customPayload?.marketOddsAway === 'number' &&
      customPayload.marketOddsAway > 1.0;

    const marketOdds = hasCompleteMarketOdds
      ? {
          homeOdds: customPayload!.marketOddsHome!,
          drawOdds: customPayload!.marketOddsDraw!,
          awayOdds: customPayload!.marketOddsAway!,
        }
      : undefined;

    const sampleCount = homeForm.sampleMatches + awayForm.sampleMatches + h2h.totalH2HMatches;
    const hasRatings = !homeRating.isBaselineDefault || !awayRating.isBaselineDefault;

    const predictionResult = PredictionEngine.calculatePrediction({
      homeTeam: homeName,
      awayTeam: awayName,
      competition: comp?.name || 'League',
      venue: match.venue || undefined,
      kickoffTime: kickoffDate,
      homeElo: homeRating.overallElo,
      awayElo: awayRating.overallElo,
      homeAttack: homeRating.attackRating,
      awayAttack: awayRating.attackRating,
      homeDefense: homeRating.defenseRating,
      awayDefense: awayRating.defenseRating,
      sampleMatchesCount: sampleCount,
      absences,
      marketOdds,
      hasTeamRatings: hasRatings,
      hasWebIntelligence: webIntel.retrievalStatus !== 'UNAVAILABLE',
      webIntelligenceReliability: webIntel.overallIntelligenceReliability,
    });

    const versionLabel = `v-ingested-${sourceType.toLowerCase()}-${Date.now()}`;

    const [snapshot] = await db
      .insert(evidenceSnapshots)
      .values({
        matchId: match.id,
        snapshotTimestamp: new Date(),
        h2hData: h2h,
        recentFormData: { homeForm, awayForm },
        webIntelligenceData: {
          ...webIntel,
          verifiedAbsences: absences,
          tacticalNotes: [
            ...(webIntel.tacticalNotes || []),
            customPayload?.notes || `Real-time ingestion of ${sourceType} applied.`,
          ],
        },
        sourceReliabilityScore: webIntel.overallIntelligenceReliability,
        dataQualityScore: predictionResult.dataQuality.score,
        missingFields: predictionResult.dataQuality.missingInputs || [],
        isImmutable: true,
      })
      .returning();

    await db
      .insert(predictionLedger)
      .values({
        matchId: match.id,
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
        confidenceScore: predictionResult.confidence.score,
        confidenceReason: `Ingested ${sourceType}: ${predictionResult.confidence.reason}`,
      })
      .returning();

    const updatedTrend = await this.getTrendForMatch(matchId);
    if (!updatedTrend) throw new Error('Failed to generate updated trend');
    return updatedTrend;
  }
}
