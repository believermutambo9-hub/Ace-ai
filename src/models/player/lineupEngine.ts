/**
 * Player Availability & Starting XI Impact Modifier Engine
 * Computes positional replacement drop-off (ΔxG) when key players are confirmed out.
 * 
 * Positional Impact Coefficients:
 * - Primary Goalscorer Out: -0.28 to -0.38 xG created drop
 * - Primary Playmaker Out:  -0.20 to -0.28 xG created drop
 * - Starting Center-Back Out: +0.22 to +0.32 xGA conceded rise
 * - First-choice Goalkeeper Out: +0.18 to +0.26 xGA conceded rise
 */

export type PlayerRole = 'PRIMARY_GOALSCORER' | 'PRIMARY_PLAYMAKER' | 'LEAD_CENTER_BACK' | 'FIRST_GOALKEEPER';

export interface PlayerAbsenceItem {
  name: string;
  role: PlayerRole;
  team: 'HOME' | 'AWAY';
  status: 'CONFIRMED_OUT' | 'DOUBTFUL_75' | 'BENCHED';
}

export interface LineupImpactResult {
  homeXgModifier: number;
  awayXgModifier: number;
  homeXgaModifier: number;
  awayXgaModifier: number;
  homeEloAdjustment: number;
  awayEloAdjustment: number;
  notes: string[];
}

export class LineupImpactEngine {
  /**
   * Calculate tactical and expected goal modifications from confirmed starting absences
   */
  public static calculateAbsenceImpact(absences: PlayerAbsenceItem[]): LineupImpactResult {
    let homeXgMod = 0;
    let awayXgMod = 0;
    let homeXgaMod = 0;
    let awayXgaMod = 0;
    let homeEloAdj = 0;
    let awayEloAdj = 0;
    const notes: string[] = [];

    for (const p of absences) {
      const isHome = p.team === 'HOME';
      const severityMultiplier = p.status === 'CONFIRMED_OUT' ? 1.0 : p.status === 'BENCHED' ? 0.85 : 0.65;

      switch (p.role) {
        case 'PRIMARY_GOALSCORER': {
          const delta = -0.32 * severityMultiplier;
          const eloDelta = -35 * severityMultiplier;
          if (isHome) {
            homeXgMod += delta;
            homeEloAdj += eloDelta;
          } else {
            awayXgMod += delta;
            awayEloAdj += eloDelta;
          }
          notes.push(`${isHome ? 'Home' : 'Away'} primary goalscorer (${p.name}) out: ${delta.toFixed(2)} xG attacking drop.`);
          break;
        }

        case 'PRIMARY_PLAYMAKER': {
          const delta = -0.24 * severityMultiplier;
          const eloDelta = -25 * severityMultiplier;
          if (isHome) {
            homeXgMod += delta;
            homeEloAdj += eloDelta;
          } else {
            awayXgMod += delta;
            awayEloAdj += eloDelta;
          }
          notes.push(`${isHome ? 'Home' : 'Away'} primary playmaker (${p.name}) out: ${delta.toFixed(2)} xG progressive creation drop.`);
          break;
        }

        case 'LEAD_CENTER_BACK': {
          const delta = 0.28 * severityMultiplier; // More goals conceded
          const eloDelta = -30 * severityMultiplier;
          if (isHome) {
            homeXgaMod += delta;
            homeEloAdj += eloDelta;
          } else {
            awayXgaMod += delta;
            awayEloAdj += eloDelta;
          }
          notes.push(`${isHome ? 'Home' : 'Away'} lead center-back (${p.name}) missing: +${delta.toFixed(2)} xGA defensive concession rise.`);
          break;
        }

        case 'FIRST_GOALKEEPER': {
          const delta = 0.22 * severityMultiplier;
          const eloDelta = -20 * severityMultiplier;
          if (isHome) {
            homeXgaMod += delta;
            homeEloAdj += eloDelta;
          } else {
            awayXgaMod += delta;
            awayEloAdj += eloDelta;
          }
          notes.push(`${isHome ? 'Home' : 'Away'} starting goalkeeper (${p.name}) absent: backup keeper delta +${delta.toFixed(2)} xGA.`);
          break;
        }
      }
    }

    return {
      homeXgModifier: Number(homeXgMod.toFixed(2)),
      awayXgModifier: Number(awayXgMod.toFixed(2)),
      homeXgaModifier: Number(homeXgaMod.toFixed(2)),
      awayXgaModifier: Number(awayXgaMod.toFixed(2)),
      homeEloAdjustment: Math.round(homeEloAdj),
      awayEloAdjustment: Math.round(awayEloAdj),
      notes,
    };
  }
}
