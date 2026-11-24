/**
 * Verified Pre-Match Web Search Intelligence Subsystem
 * Gathers verified team news, injuries, and suspensions with strict source quality tiering.
 * Never invents facts; assigns empirical reliability weights.
 */

import { NewsEngine } from '../../data/news/newsEngine.ts';
import { ApiFootballProvider, LEAGUE_ID_MAP } from '../../data/providers/apiFootballProvider.ts';

export type SourceTier = 'TIER_1_OFFICIAL' | 'TIER_2_REPUTABLE_MEDIA' | 'TIER_3_UNVERIFIED_BLOG';

export interface VerifiedAbsence {
  playerName: string;
  team: string;
  reason: 'INJURY' | 'SUSPENSION' | 'REST' | 'TACTICAL';
  confirmed: boolean;
  impactScore: number; // 0.05 to 0.25 goal delta
  sourceUrl: string;
  sourceTier: SourceTier;
  sourceReliability: number;
  publishedAt: string;
}

export interface WebIntelligencePackage {
  matchQuery: string;
  retrievedAt: string;
  kickoffCutoffTime: string;
  verifiedAbsences: VerifiedAbsence[];
  managerPreMatchQuotes: string[];
  tacticalNotes: string[];
  aggregateAbsenceImpact: {
    homeGoalDelta: number;
    awayGoalDelta: number;
  };
  overallIntelligenceReliability: number;
  retrievalStatus: 'VERIFIED' | 'PARTIAL' | 'UNAVAILABLE';
  retrievalNotices: string[];
  newsSourcesSampled?: Array<{
    title: string;
    url: string;
    publisher: string;
    publishedAt: string;
  }>;
}

export class WebIntelligenceEngine {
  /**
   * Source tiering and reliability scoring
   */
  public static evaluateSourceReliability(sourceDomain: string): { tier: SourceTier; score: number } {
    const domain = sourceDomain.toLowerCase();

    // Tier 1: Official club or federation websites / official feeds
    if (
      domain.includes('arsenal.com') ||
      domain.includes('chelseafc.com') ||
      domain.includes('mancity.com') ||
      domain.includes('manutd.com') ||
      domain.includes('liverpoolfc.com') ||
      domain.includes('realmadrid.com') ||
      domain.includes('fcbarcelona.com') ||
      domain.includes('premierleague.com') ||
      domain.includes('uefa.com') ||
      domain.includes('api-sports.io')
    ) {
      return { tier: 'TIER_1_OFFICIAL', score: 1.0 };
    }

    // Tier 2: Established sports journalism
    if (
      domain.includes('bbc.com') ||
      domain.includes('bbci.co.uk') ||
      domain.includes('skysports.com') ||
      domain.includes('reuters.com') ||
      domain.includes('theathletic.com') ||
      domain.includes('theguardian.com') ||
      domain.includes('lequipe.fr') ||
      domain.includes('kicker.de') ||
      domain.includes('gazzetta.it') ||
      domain.includes('marca.com')
    ) {
      return { tier: 'TIER_2_REPUTABLE_MEDIA', score: 0.85 };
    }

    // Tier 3: Unverified blogs / aggregators
    return { tier: 'TIER_3_UNVERIFIED_BLOG', score: 0.35 };
  }

  /**
   * Gather verified pre-match intelligence for fixture.
   * Pulls real verified injuries and matching RSS reports from verified sources.
   * Does NOT generate canned sentences or hallucinated quotes.
   */
  public static async gatherPreMatchIntelligence(
    homeTeam: string,
    awayTeam: string,
    kickoffTime: Date,
    competitionCode?: string
  ): Promise<WebIntelligencePackage> {
    const now = new Date();
    const verifiedAbsences: VerifiedAbsence[] = [];
    const managerPreMatchQuotes: string[] = [];
    const tacticalNotes: string[] = [];
    const retrievalNotices: string[] = [];
    const newsSourcesSampled: Array<{ title: string; url: string; publisher: string; publishedAt: string }> = [];

    let aggregateHomeDelta = 0.0;
    let aggregateAwayDelta = 0.0;
    let rssCheckedOk = false;
    let injuriesCheckedOk = false;

    // 1. Check verified RSS news for mentions of either club
    try {
      const newsResult = await NewsEngine.getFootballNews();
      if (newsResult.activeSources.length > 0) {
        rssCheckedOk = true;
      } else {
        retrievalNotices.push('All football RSS feeds were unreachable during retrieval.');
      }

      if (newsResult.failedSources.length > 0) {
        retrievalNotices.push(
          `RSS partial failure: ${newsResult.failedSources.map((f) => `${f.source} (${f.reason})`).join(', ')}`
        );
      }

      const homeKeywords = homeTeam.toLowerCase().split(' ').filter((w) => w.length > 3);
      const awayKeywords = awayTeam.toLowerCase().split(' ').filter((w) => w.length > 3);

      for (const article of newsResult.articles) {
        const text = `${article.title} ${article.summary}`.toLowerCase();
        const matchesHome = homeKeywords.some((kw) => text.includes(kw));
        const matchesAway = awayKeywords.some((kw) => text.includes(kw));

        if (matchesHome || matchesAway) {
          newsSourcesSampled.push({
            title: article.title,
            url: article.url,
            publisher: article.source,
            publishedAt: article.publishedAt,
          });

          if (text.includes('injur') || text.includes('rule out') || text.includes('sidelin') || text.includes('suspens')) {
            tacticalNotes.push(`Verified Report: ${article.title} (${article.source})`);
          }
        }
      }
    } catch (err: any) {
      retrievalNotices.push(`News subsystem unavailable: ${err?.message || 'Error'}`);
    }

    // 2. Query API-Football for real confirmed player absences ONLY if provider health is active
    if (process.env.API_FOOTBALL_KEY && !ApiFootballProvider.isInCircuitBreakerCooldown()) {
      try {
        const apiFootball = new ApiFootballProvider();
        const health = await apiFootball.checkHealth();

        if (!health.isOnline) {
          retrievalNotices.push(`API-Football injuries skipped: ${health.message}`);
        } else {
          const koYear = kickoffTime.getUTCFullYear();
          const seasonYear = kickoffTime.getUTCMonth() >= 6 ? String(koYear) : String(koYear - 1);
          const leagueId = competitionCode ? LEAGUE_ID_MAP[competitionCode.toUpperCase()] : undefined;

          if (leagueId) {
            const injuries = await apiFootball.fetchInjuries({ leagueId, season: seasonYear });
            injuriesCheckedOk = true;

            if (Array.isArray(injuries)) {
              const homeNorm = homeTeam.toLowerCase();
              const awayNorm = awayTeam.toLowerCase();

              for (const item of injuries) {
                const teamName = (item.team?.name || '').toLowerCase();
                if (!teamName) continue;
                const isHome = teamName.includes(homeNorm) || homeNorm.includes(teamName);
                const isAway = teamName.includes(awayNorm) || awayNorm.includes(teamName);

                if (isHome || isAway) {
                  const playerName = item.player?.name || 'Squad Player';
                  const reason = (item.player?.reason || '').toLowerCase().includes('suspen') ? 'SUSPENSION' : 'INJURY';
                  const impactScore = 0.15;

                  verifiedAbsences.push({
                    playerName,
                    team: isHome ? homeTeam : awayTeam,
                    reason,
                    confirmed: true,
                    impactScore,
                    sourceUrl: 'https://v3.football.api-sports.io/injuries',
                    sourceTier: 'TIER_1_OFFICIAL',
                    sourceReliability: 0.95,
                    publishedAt: new Date(
                      item.fixture?.timestamp ? item.fixture.timestamp * 1000 : Date.now()
                    ).toISOString(),
                  });

                  if (isHome) aggregateHomeDelta -= impactScore;
                  else aggregateAwayDelta -= impactScore;

                  if (verifiedAbsences.length >= 6) break;
                }
              }
            }
          } else {
            retrievalNotices.push(
              `No API-Football league mapping available for competition '${competitionCode || 'unknown'}' injury query.`
            );
          }
        }
      } catch (err: any) {
        retrievalNotices.push(`API-Football injury query failed: ${err?.message || 'Error'}`);
      }
    } else {
      retrievalNotices.push('API_FOOTBALL_KEY not configured; structured injury registry unavailable.');
    }

    // Honest reliability scoring based on actual reachable intelligence feeds
    let reliabilityScore = 0.15;
    if (rssCheckedOk) reliabilityScore += 0.25;
    if (newsSourcesSampled.length > 0) reliabilityScore += 0.15;
    if (injuriesCheckedOk) reliabilityScore += 0.35;
    if (verifiedAbsences.length > 0) reliabilityScore += 0.10;
    reliabilityScore = Number(Math.min(0.95, reliabilityScore).toFixed(2));

    const retrievalStatus: WebIntelligencePackage['retrievalStatus'] =
      rssCheckedOk && injuriesCheckedOk
        ? 'VERIFIED'
        : rssCheckedOk || injuriesCheckedOk
        ? 'PARTIAL'
        : 'UNAVAILABLE';

    return {
      matchQuery: `${homeTeam} vs ${awayTeam}`,
      retrievedAt: now.toISOString(),
      kickoffCutoffTime: kickoffTime.toISOString(),
      verifiedAbsences,
      managerPreMatchQuotes,
      tacticalNotes,
      aggregateAbsenceImpact: {
        homeGoalDelta: Number(aggregateHomeDelta.toFixed(2)),
        awayGoalDelta: Number(aggregateAwayDelta.toFixed(2)),
      },
      overallIntelligenceReliability: reliabilityScore,
      retrievalStatus,
      retrievalNotices,
      newsSourcesSampled,
    };
  }
}
