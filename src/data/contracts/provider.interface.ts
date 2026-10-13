export type MatchStatus = 'SCHEDULED' | 'LIVE' | 'FINISHED' | 'POSTPONED' | 'CANCELLED';
export type MatchResult = 'HOME_WIN' | 'DRAW' | 'AWAY_WIN';

export interface NormalizedCompetition {
  code: string;
  name: string;
  country: string;
  tier: number;
  type: 'LEAGUE' | 'CUP' | 'INTERNATIONAL';
  emblem?: string;
}

export interface NormalizedTeam {
  canonicalName: string;
  shortName: string;
  tla?: string;
  country: string;
  founded?: number;
  venueName?: string;
  crest?: string;
  aliases: string[];
}

export interface NormalizedMatch {
  externalId: string;
  providerSource: string;
  competitionCode: string;
  seasonCode: string;
  round?: string;
  matchday?: number;
  kickoffTime: Date;
  homeTeamRawName: string;
  awayTeamRawName: string;
  venue?: string;
  referee?: string;
  status: MatchStatus;
  homeScoreHalfTime?: number | null;
  awayScoreHalfTime?: number | null;
  homeScoreFullTime?: number | null;
  awayScoreFullTime?: number | null;
  result?: MatchResult | null;
  metadata?: Record<string, any>;
  stats?: {
    home: NormalizedTeamStats;
    away: NormalizedTeamStats;
  };
}

export interface NormalizedTeamStats {
  shots?: number;
  shotsOnTarget?: number;
  possession?: number;
  corners?: number;
  fouls?: number;
  yellowCards?: number;
  redCards?: number;
  offsides?: number;
  xg?: number;
  xga?: number;
}

export interface NormalizedMatchStats {
  matchExternalId: string;
  homeTeamRawName: string;
  awayTeamRawName: string;
  home: NormalizedTeamStats;
  away: NormalizedTeamStats;
}

export interface ProviderHealth {
  providerName: string;
  isOnline: boolean;
  latencyMs: number;
  lastChecked: Date;
  rateLimitRemaining?: number;
  message?: string;
}

export interface IFootballDataProvider {
  readonly name: string;
  checkHealth(): Promise<ProviderHealth>;
  fetchCompetitions(): Promise<NormalizedCompetition[]>;
  fetchMatches(competitionCode: string, seasonCode?: string): Promise<NormalizedMatch[]>;
  fetchMatchStats?(matchExternalId: string): Promise<NormalizedMatchStats | null>;
}
