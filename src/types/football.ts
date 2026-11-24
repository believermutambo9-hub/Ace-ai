// Pure client-safe data contracts and TypeScript interfaces
// CRITICAL: Must NEVER import backend database drivers (pg, drizzle, etc.)

export type PredictionQueueStatus = 'READY' | 'PENDING' | 'NOT_YET_GENERATED';

export interface UpcomingMatchItem {
  id: number;
  externalId: string;
  competitionId: number;
  competitionName: string;
  competitionCode: string;
  round: string | number;
  venue: string;
  kickoffTime: string;
  kickoffDate: string;
  startsInMinutes: number;
  startsInFormatted: string;
  status: 'SCHEDULED' | 'UPCOMING' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
  homeTeamId: number;
  homeTeam: string;
  homeShortName: string;
  awayTeamId: number;
  awayTeam: string;
  awayShortName: string;
  queueStatus: PredictionQueueStatus;
  isLocked: boolean;
  prediction?: {
    ledgerId: number;
    modelVersion: string;
    versionNumber: number;
    predictionTimestamp: string;
    isLocked: boolean;
    probabilities: {
      homeWin: number;
      draw: number;
      awayWin: number;
    };
    expectedGoals: {
      home: number;
      away: number;
      total: number;
    };
    fairOdds: {
      home: number;
      draw: number;
      away: number;
    };
    mostLikelyScore: string;
    confidenceScore: number;
    confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
    confidenceReason: string;
    dataQuality: {
      score: number;
      rating: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'LIMITED';
      factors: string[];
    };
    totalVersionsCount: number;
  };
}

export interface UpcomingDashboardResponse {
  currentTime: string;
  requestedHoursWindow: number | null;
  windowsSummary: {
    next1Hour: number;
    next2Hours: number;
    next3Hours: number;
    next4Hours: number;
    next5Hours: number;
    today: number;
    tomorrow: number;
    totalUpcoming: number;
  };
  queueSummary: {
    ready: number;
    pending: number;
    notYetGenerated: number;
    total: number;
  };
  matches: UpcomingMatchItem[];
}

export interface IngestionMilestone {
  id: string;
  versionIndex: number;
  timestamp: string;
  relativeTime: string;
  sourceCategory:
    | 'BASELINE'
    | 'FORM_H2H'
    | 'SQUAD_NEWS'
    | 'CONTEXT_FATIGUE'
    | 'MARKET_FLOW'
    | 'CONFIRMED_XI'
    | 'FINAL_ENSEMBLE';
  sourceName: string;
  sourceDescription: string;
  probabilities: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  fairOdds: {
    home: number;
    draw: number;
    away: number;
  };
  expectedGoals: {
    home: number;
    away: number;
    total: number;
  };
  deltaFromPrev?: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  keyEvidence: string;
  evidenceDetails?: {
    absencesCount?: number;
    marketOverround?: number;
    h2hMatchesCount?: number;
    dataFreshness?: string;
  };
  confidenceScore: number;
  dataQuality: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'LIMITED';
  modelVersion: string;
  isLocked: boolean;
  isCurrent: boolean;
}

export interface MatchProbabilityTrend {
  matchId: number;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  kickoffTime: string;
  status: string;
  totalDataSourcesIngested: number;
  currentEnsemble: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  baselineEnsemble: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  netShift: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  milestones: IngestionMilestone[];
  driftVolatilityScore?: number;
  confidenceScore?: number;
  modelVersion?: string;
}

export interface TrendTimelineResponse {
  matchId: number;
  trend: MatchProbabilityTrend | null;
  generatedAt: string;
  message?: string;
}
