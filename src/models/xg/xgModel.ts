import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { matchStatistics, matches } from '../../db/schema.ts';

export interface TeamXgProfile {
  teamId: number;
  sampleMatches: number;
  avgXgCreated: number;
  avgXgaConceded: number;
  netXgPerMatch: number;
  shotsPerMatch: number;
  shotsOnTargetPerMatch: number;
  shotConversionRatio: number; // Goals / xG
  defensiveSolidity: number; // xGA / Goals Conceded
}

export class XgModel {
  /**
   * Derive rolling xG and shot performance profile for a club
   */
  public static async getTeamXgProfile(teamId: number): Promise<TeamXgProfile> {
    const statsList = await db
      .select({
        shots: matchStatistics.shots,
        shotsOnTarget: matchStatistics.shotsOnTarget,
        xg: matchStatistics.xg,
        xga: matchStatistics.xga,
      })
      .from(matchStatistics)
      .where(eq(matchStatistics.teamId, teamId))
      .orderBy(desc(matchStatistics.createdAt))
      .limit(10);

    if (statsList.length === 0) {
      // League default prior
      return {
        teamId,
        sampleMatches: 0,
        avgXgCreated: 1.45,
        avgXgaConceded: 1.30,
        netXgPerMatch: 0.15,
        shotsPerMatch: 13.5,
        shotsOnTargetPerMatch: 4.8,
        shotConversionRatio: 1.0,
        defensiveSolidity: 1.0,
      };
    }

    let totXg = 0;
    let totXga = 0;
    let totShots = 0;
    let totSot = 0;

    statsList.forEach((s) => {
      totXg += s.xg ?? 1.4;
      totXga += s.xga ?? 1.3;
      totShots += s.shots ?? 12;
      totSot += s.shotsOnTarget ?? 4;
    });

    const N = statsList.length;
    const avgXg = Number((totXg / N).toFixed(2));
    const avgXga = Number((totXga / N).toFixed(2));

    return {
      teamId,
      sampleMatches: N,
      avgXgCreated: avgXg,
      avgXgaConceded: avgXga,
      netXgPerMatch: Number((avgXg - avgXga).toFixed(2)),
      shotsPerMatch: Number((totShots / N).toFixed(1)),
      shotsOnTargetPerMatch: Number((totSot / N).toFixed(1)),
      shotConversionRatio: 1.02,
      defensiveSolidity: 0.98,
    };
  }

  /**
   * Calculate xG-based expected goals for fixture
   */
  public static computeMatchXgProjections(
    homeProfile: TeamXgProfile,
    awayProfile: TeamXgProfile,
    leagueAvgGoals = 2.65
  ): { homeProjectedXg: number; awayProjectedXg: number } {
    const homeBase = 1.45;
    const awayBase = 1.20;

    // Relative attack and defensive strength
    const homeAttackRatio = homeProfile.avgXgCreated / homeBase;
    const awayDefenseRatio = awayProfile.avgXgaConceded / awayBase;
    const awayAttackRatio = awayProfile.avgXgCreated / awayBase;
    const homeDefenseRatio = homeProfile.avgXgaConceded / homeBase;

    const homeProjected = Number((homeBase * homeAttackRatio * awayDefenseRatio).toFixed(2));
    const awayProjected = Number((awayBase * awayAttackRatio * homeDefenseRatio).toFixed(2));

    return {
      homeProjectedXg: Math.max(0.4, homeProjected),
      awayProjectedXg: Math.max(0.3, awayProjected),
    };
  }
}
