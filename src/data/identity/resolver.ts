import { eq, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { teamAliases, teams } from '../../db/schema.ts';
import { CANONICAL_TEAMS_DATA } from './teamAliases.ts';

// In-memory lookup cache to minimize redundant DB queries
const teamIdCache = new Map<string, number>();
const canonicalCache = new Map<number, typeof teams.$inferSelect>();

/**
 * Clean and normalize team string for robust fuzzy matching
 */
export function cleanTeamString(rawName: string): string {
  if (!rawName) return '';
  return rawName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/\./g, '') // remove dots so C.F. becomes CF
    .replace(/\b(fc|cf|sc|afc|club|ac|ssc|as|rb|cd)\b/gi, '')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export class IdentityResolver {
  private static seeded = false;

  /**
   * Seed standard canonical teams and their aliases into Postgres if not already present
   */
  public static async seedCanonicalEntities(): Promise<void> {
    if (this.seeded) return;

    try {
      for (const item of CANONICAL_TEAMS_DATA) {
        // Upsert team
        let [existingTeam] = await db
          .select()
          .from(teams)
          .where(eq(teams.canonicalName, item.canonicalName))
          .limit(1);

        if (!existingTeam) {
          const [inserted] = await db
            .insert(teams)
            .values({
              canonicalName: item.canonicalName,
              shortName: item.shortName,
              tla: item.tla,
              country: item.country,
              venueName: item.venueName,
            })
            .returning();
          existingTeam = inserted;
        }

        if (existingTeam) {
          teamIdCache.set(existingTeam.canonicalName.toLowerCase(), existingTeam.id);
          teamIdCache.set(existingTeam.shortName.toLowerCase(), existingTeam.id);
          teamIdCache.set(cleanTeamString(existingTeam.canonicalName), existingTeam.id);
          teamIdCache.set(cleanTeamString(existingTeam.shortName), existingTeam.id);
          canonicalCache.set(existingTeam.id, existingTeam);

          // Insert aliases
          for (const alias of item.aliases) {
            teamIdCache.set(alias.toLowerCase(), existingTeam.id);
            teamIdCache.set(cleanTeamString(alias), existingTeam.id);

            await db
              .insert(teamAliases)
              .values({
                teamId: existingTeam.id,
                aliasName: alias,
                providerSource: 'system-seed',
              })
              .onConflictDoNothing();
          }
        }
      }
      this.seeded = true;
    } catch (error) {
      console.error('Error during canonical entity seeding:', error);
      throw error;
    }
  }

  /**
   * Resolve any team raw name (e.g. 'Man Utd', 'Manchester United') to its internal canonical Team record
   */
  public static async resolveTeam(
    rawName: string,
    countryHint: string = 'International',
    providerSource: string = 'generic'
  ): Promise<typeof teams.$inferSelect> {
    const trimmed = rawName.trim();
    const lower = trimmed.toLowerCase();
    const cleaned = cleanTeamString(trimmed);

    // 1. Check in-memory fast cache
    if (teamIdCache.has(lower)) {
      const id = teamIdCache.get(lower)!;
      const cached = canonicalCache.get(id);
      if (cached) return cached;
    }

    if (teamIdCache.has(cleaned)) {
      const id = teamIdCache.get(cleaned)!;
      const cached = canonicalCache.get(id);
      if (cached) return cached;
    }

    // 2. Query team_aliases in PostgreSQL
    const [aliasRecord] = await db
      .select({ team: teams })
      .from(teamAliases)
      .innerJoin(teams, eq(teamAliases.teamId, teams.id))
      .where(sql`LOWER(${teamAliases.aliasName}) = ${lower}`)
      .limit(1);

    if (aliasRecord) {
      teamIdCache.set(lower, aliasRecord.team.id);
      teamIdCache.set(cleaned, aliasRecord.team.id);
      canonicalCache.set(aliasRecord.team.id, aliasRecord.team);
      return aliasRecord.team;
    }

    // 3. Query teams table (canonicalName or shortName)
    const [teamRecord] = await db
      .select()
      .from(teams)
      .where(
        or(
          sql`LOWER(${teams.canonicalName}) = ${lower}`,
          sql`LOWER(${teams.shortName}) = ${lower}`
        )
      )
      .limit(1);

    if (teamRecord) {
      teamIdCache.set(lower, teamRecord.id);
      teamIdCache.set(cleaned, teamRecord.id);
      canonicalCache.set(teamRecord.id, teamRecord);

      // Register alias for future lookup
      await db
        .insert(teamAliases)
        .values({
          teamId: teamRecord.id,
          aliasName: trimmed,
          providerSource,
        })
        .onConflictDoNothing();

      return teamRecord;
    }

    // 4. Fuzzy / Cleaned match against registered teams
    const allTeams = await db.select().from(teams);
    for (const t of allTeams) {
      if (
        cleanTeamString(t.canonicalName) === cleaned ||
        cleanTeamString(t.shortName) === cleaned
      ) {
        teamIdCache.set(lower, t.id);
        teamIdCache.set(cleaned, t.id);
        canonicalCache.set(t.id, t);

        await db
          .insert(teamAliases)
          .values({
            teamId: t.id,
            aliasName: trimmed,
            providerSource,
          })
          .onConflictDoNothing();

        return t;
      }
    }

    // 5. If completely new, register as a new canonical team and alias
    const [createdTeam] = await db
      .insert(teams)
      .values({
        canonicalName: trimmed,
        shortName: trimmed.replace(/\s+(FC|CF|SC)$/i, ''),
        country: countryHint,
      })
      .returning();

    await db
      .insert(teamAliases)
      .values({
        teamId: createdTeam.id,
        aliasName: trimmed,
        providerSource,
      })
      .onConflictDoNothing();

    teamIdCache.set(lower, createdTeam.id);
    teamIdCache.set(cleaned, createdTeam.id);
    canonicalCache.set(createdTeam.id, createdTeam);

    return createdTeam;
  }
}
