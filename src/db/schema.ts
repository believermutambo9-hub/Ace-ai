import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------
// 1. Users Table (Firebase Auth mapping for app users)
// ---------------------------------------------------------
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(), // Firebase Auth UID
  email: text('email').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const usersRelations = relations(users, () => ({}));

// ---------------------------------------------------------
// 2. Competitions Table (Leagues & International Tournaments)
// ---------------------------------------------------------
export const competitions = pgTable(
  'competitions',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(), // e.g. 'PL', 'CL', 'PD', 'SA', 'BL1'
    name: text('name').notNull(),
    country: text('country').notNull(),
    tier: integer('tier').default(1),
    type: text('type').default('LEAGUE').notNull(), // 'LEAGUE' | 'CUP' | 'INTERNATIONAL'
    emblem: text('emblem'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    codeIdx: uniqueIndex('competitions_code_idx').on(table.code),
    countryIdx: index('competitions_country_idx').on(table.country),
  })
);

// ---------------------------------------------------------
// 3. Teams Table (Canonical entity for football clubs)
// ---------------------------------------------------------
export const teams = pgTable(
  'teams',
  {
    id: serial('id').primaryKey(),
    canonicalName: text('canonical_name').notNull().unique(), // e.g. 'Manchester United FC'
    shortName: text('short_name').notNull(), // e.g. 'Man United'
    tla: text('tla'), // Three-letter abbreviation e.g. 'MUN'
    country: text('country').notNull(),
    founded: integer('founded'),
    venueName: text('venue_name'),
    crest: text('crest'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    canonicalNameIdx: uniqueIndex('teams_canonical_name_idx').on(table.canonicalName),
    countryIdx: index('teams_country_idx').on(table.country),
  })
);

// ---------------------------------------------------------
// 4. Team Aliases Table (Identity Resolution)
// ---------------------------------------------------------
export const teamAliases = pgTable(
  'team_aliases',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    aliasName: text('alias_name').notNull().unique(), // e.g. 'Man Utd', 'Man United', 'MUFC'
    providerSource: text('provider_source').notNull(), // 'football-data-org', 'api-football', 'manual'
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    aliasNameIdx: uniqueIndex('team_aliases_alias_name_idx').on(table.aliasName),
    teamIdIdx: index('team_aliases_team_id_idx').on(table.teamId),
  })
);

// ---------------------------------------------------------
// 5. Seasons Table
// ---------------------------------------------------------
export const seasons = pgTable(
  'seasons',
  {
    id: serial('id').primaryKey(),
    competitionId: integer('competition_id')
      .references(() => competitions.id, { onDelete: 'cascade' })
      .notNull(),
    seasonCode: text('season_code').notNull(), // e.g. '2024-2025' or '2026'
    yearStart: integer('year_start').notNull(),
    yearEnd: integer('year_end').notNull(),
    isCurrent: boolean('is_current').default(false).notNull(),
  },
  (table) => ({
    compSeasonIdx: index('seasons_comp_season_idx').on(table.competitionId, table.seasonCode),
  })
);

// ---------------------------------------------------------
// 6. Matches Table
// ---------------------------------------------------------
export const matches = pgTable(
  'matches',
  {
    id: serial('id').primaryKey(),
    externalId: text('external_id'),
    providerSource: text('provider_source').notNull(),
    competitionId: integer('competition_id')
      .references(() => competitions.id, { onDelete: 'cascade' })
      .notNull(),
    seasonId: integer('season_id')
      .references(() => seasons.id, { onDelete: 'cascade' })
      .notNull(),
    round: text('round'),
    matchday: integer('matchday'),
    kickoffTime: timestamp('kickoff_time', { withTimezone: true }).notNull(),
    homeTeamId: integer('home_team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    awayTeamId: integer('away_team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    venue: text('venue'),
    referee: text('referee'),
    status: text('status').default('SCHEDULED').notNull(), // 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED'
    homeScoreHalfTime: integer('home_score_half_time'),
    awayScoreHalfTime: integer('away_score_half_time'),
    homeScoreFullTime: integer('home_score_full_time'),
    awayScoreFullTime: integer('away_score_full_time'),
    result: text('result'), // 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow(),
    updatedAt: timestamp('updated_at').defaultNow(),
  },
  (table) => ({
    kickoffTimeIdx: index('matches_kickoff_time_idx').on(table.kickoffTime),
    homeTeamIdx: index('matches_home_team_idx').on(table.homeTeamId),
    awayTeamIdx: index('matches_away_team_idx').on(table.awayTeamId),
    competitionIdx: index('matches_competition_idx').on(table.competitionId),
    statusIdx: index('matches_status_idx').on(table.status),
    providerExternalIdx: uniqueIndex('matches_provider_external_idx').on(
      table.providerSource,
      table.externalId
    ),
  })
);

// ---------------------------------------------------------
// 7. Match Statistics Table (Detailed match facts)
// ---------------------------------------------------------
export const matchStatistics = pgTable(
  'match_statistics',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => matches.id, { onDelete: 'cascade' })
      .notNull(),
    teamId: integer('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    isHome: boolean('is_home').notNull(),
    shots: integer('shots'),
    shotsOnTarget: integer('shots_on_target'),
    possession: integer('possession'), // 0 - 100 percentage
    corners: integer('corners'),
    fouls: integer('fouls'),
    yellowCards: integer('yellow_cards'),
    redCards: integer('red_cards'),
    offsides: integer('offsides'),
    xg: doublePrecision('xg'),
    xga: doublePrecision('xga'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    matchTeamIdx: uniqueIndex('match_stats_match_team_idx').on(table.matchId, table.teamId),
  })
);

// ---------------------------------------------------------
// 8. Dynamic Team Ratings (Elo / Glicko / Strengths)
// ---------------------------------------------------------
export const teamRatings = pgTable(
  'team_ratings',
  {
    id: serial('id').primaryKey(),
    teamId: integer('team_id')
      .references(() => teams.id, { onDelete: 'cascade' })
      .notNull(),
    ratingTimestamp: timestamp('rating_timestamp', { withTimezone: true }).defaultNow().notNull(),
    matchId: integer('match_id').references(() => matches.id, { onDelete: 'set null' }),
    overallElo: doublePrecision('overall_elo').default(1500.0).notNull(),
    attackRating: doublePrecision('attack_rating').default(100.0).notNull(),
    defenseRating: doublePrecision('defense_rating').default(100.0).notNull(),
    homeAdvantage: doublePrecision('home_advantage').default(65.0).notNull(),
    recentFormString: text('recent_form_string'), // e.g. 'WWDLW'
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    teamRatingTimestampIdx: index('team_ratings_team_time_idx').on(
      table.teamId,
      table.ratingTimestamp
    ),
  })
);

// ---------------------------------------------------------
// 9. Pre-Match Evidence Snapshots (Immutable Pre-Kickoff)
// ---------------------------------------------------------
export const evidenceSnapshots = pgTable(
  'evidence_snapshots',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => matches.id, { onDelete: 'cascade' })
      .notNull(),
    snapshotTimestamp: timestamp('snapshot_timestamp', { withTimezone: true }).defaultNow().notNull(),
    h2hData: jsonb('h2h_data'),
    recentFormData: jsonb('recent_form_data'),
    webIntelligenceData: jsonb('web_intelligence_data'),
    sourceReliabilityScore: doublePrecision('source_reliability_score'),
    dataQualityScore: doublePrecision('data_quality_score'),
    missingFields: jsonb('missing_fields'),
    isImmutable: boolean('is_immutable').default(true).notNull(),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    matchSnapshotIdx: index('evidence_snapshots_match_idx').on(table.matchId),
  })
);

// ---------------------------------------------------------
// 10. Prediction Ledger (Pre-Kickoff Locked Ledger)
// ---------------------------------------------------------
export const predictionLedger = pgTable(
  'prediction_ledger',
  {
    id: serial('id').primaryKey(),
    matchId: integer('match_id')
      .references(() => matches.id, { onDelete: 'cascade' })
      .notNull(),
    snapshotId: integer('snapshot_id').references(() => evidenceSnapshots.id, {
      onDelete: 'set null',
    }),
    predictionTimestamp: timestamp('prediction_timestamp', { withTimezone: true }).defaultNow().notNull(),
    kickoffTime: timestamp('kickoff_time', { withTimezone: true }).notNull(),
    modelVersion: text('model_version').notNull(),
    isLocked: boolean('is_locked').default(true).notNull(),
    homeWinProb: doublePrecision('home_win_prob').notNull(),
    drawProb: doublePrecision('draw_prob').notNull(),
    awayWinProb: doublePrecision('away_win_prob').notNull(),
    expectedHomeGoals: doublePrecision('expected_home_goals').notNull(),
    expectedAwayGoals: doublePrecision('expected_away_goals').notNull(),
    totalExpectedGoals: doublePrecision('total_expected_goals').notNull(),
    mostLikelyScore: text('most_likely_score').notNull(),
    scoreProbabilities: jsonb('score_probabilities'),
    modelBreakdown: jsonb('model_breakdown'),
    ensembleWeights: jsonb('ensemble_weights'),
    confidenceScore: doublePrecision('confidence_score'),
    confidenceReason: text('confidence_reason'),
    actualResult: text('actual_result'),
    actualScore: text('actual_score'),
    wasCorrect: boolean('was_correct'),
    brierScore: doublePrecision('brier_score'),
    logLoss: doublePrecision('log_loss'),
    createdAt: timestamp('created_at').defaultNow(),
  },
  (table) => ({
    matchPredictionIdx: index('prediction_ledger_match_idx').on(table.matchId),
    kickoffIdx: index('prediction_ledger_kickoff_idx').on(table.kickoffTime),
  })
);

// ---------------------------------------------------------
// 11. Ingestion Logs (Auditing & Discrepancy Tracking)
// ---------------------------------------------------------
export const ingestionLogs = pgTable(
  'ingestion_logs',
  {
    id: serial('id').primaryKey(),
    providerSource: text('provider_source').notNull(),
    action: text('action').notNull(),
    status: text('status').notNull(), // 'SUCCESS' | 'WARNING' | 'ERROR'
    recordsProcessed: integer('records_processed').default(0),
    recordsInserted: integer('records_inserted').default(0),
    recordsUpdated: integer('records_updated').default(0),
    conflictsDetected: integer('conflicts_detected').default(0),
    details: jsonb('details'),
    timestamp: timestamp('timestamp', { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    timestampIdx: index('ingestion_logs_time_idx').on(table.timestamp),
    sourceIdx: index('ingestion_logs_source_idx').on(table.providerSource),
  })
);

// ---------------------------------------------------------
// Relationships Definition
// ---------------------------------------------------------
export const competitionsRelations = relations(competitions, ({ many }) => ({
  seasons: many(seasons),
  matches: many(matches),
}));

export const teamsRelations = relations(teams, ({ many }) => ({
  aliases: many(teamAliases),
  homeMatches: many(matches, { relationName: 'homeMatches' }),
  awayMatches: many(matches, { relationName: 'awayMatches' }),
  ratings: many(teamRatings),
}));

export const teamAliasesRelations = relations(teamAliases, ({ one }) => ({
  team: one(teams, {
    fields: [teamAliases.teamId],
    references: [teams.id],
  }),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  competition: one(competitions, {
    fields: [seasons.competitionId],
    references: [competitions.id],
  }),
  matches: many(matches),
}));

export const matchesRelations = relations(matches, ({ one, many }) => ({
  competition: one(competitions, {
    fields: [matches.competitionId],
    references: [competitions.id],
  }),
  season: one(seasons, {
    fields: [matches.seasonId],
    references: [seasons.id],
  }),
  homeTeam: one(teams, {
    fields: [matches.homeTeamId],
    references: [teams.id],
    relationName: 'homeMatches',
  }),
  awayTeam: one(teams, {
    fields: [matches.awayTeamId],
    references: [teams.id],
    relationName: 'awayMatches',
  }),
  statistics: many(matchStatistics),
  evidenceSnapshots: many(evidenceSnapshots),
  predictions: many(predictionLedger),
}));

export const matchStatisticsRelations = relations(matchStatistics, ({ one }) => ({
  match: one(matches, {
    fields: [matchStatistics.matchId],
    references: [matches.id],
  }),
  team: one(teams, {
    fields: [matchStatistics.teamId],
    references: [teams.id],
  }),
}));

export const evidenceSnapshotsRelations = relations(evidenceSnapshots, ({ one }) => ({
  match: one(matches, {
    fields: [evidenceSnapshots.matchId],
    references: [matches.id],
  }),
}));

export const predictionLedgerRelations = relations(predictionLedger, ({ one }) => ({
  match: one(matches, {
    fields: [predictionLedger.matchId],
    references: [matches.id],
  }),
  snapshot: one(evidenceSnapshots, {
    fields: [predictionLedger.snapshotId],
    references: [evidenceSnapshots.id],
  }),
}));
