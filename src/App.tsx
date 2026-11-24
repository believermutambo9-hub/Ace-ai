import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowRight,
  BarChart3,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Database,
  DollarSign,
  Filter,
  Flame,
  Globe,
  Info,
  Layers,
  Radio,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Swords,
  TrendingUp,
  Trophy,
  Users,
  X,
  LogIn,
  LogOut,
} from 'lucide-react';
import { UpcomingPredictionQueue } from './components/UpcomingPredictionQueue.tsx';
import { ValueBetScanner } from './components/ValueBetScanner.tsx';
import { PortfolioDashboard } from './components/PortfolioDashboard.tsx';
import { BetSlipDrawer } from './components/BetSlipDrawer.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { LeagueStandingsView } from './components/LeagueStandingsView.tsx';
import { HeadToHeadView } from './components/HeadToHeadView.tsx';
import { PortfolioStore } from './data/portfolio/portfolioStore.ts';
import { useAuth } from './context/AuthContext.tsx';
import { HistoricalCoverageDashboard } from './components/HistoricalCoverageDashboard.tsx';
import { ErrorReportingService } from './services/errorReporting.ts';

interface MatchItem {
  id: number;
  externalId: string;
  competitionId: number;
  competitionName: string;
  competitionCode: string;
  round: string;
  kickoffTime: string;
  status: 'SCHEDULED' | 'FINISHED' | 'LIVE';
  homeTeam: string;
  awayTeam: string;
  homeShortName: string;
  awayShortName: string;
  homeScoreFullTime?: number | null;
  awayScoreFullTime?: number | null;
  result?: string | null;
  venue?: string | null;
  metadata?: {
    minute?: number;
    period?: '1H' | 'HT' | '2H' | 'FT';
    stoppageTime?: number;
    lastUpdated?: string;
    events?: Array<{
      id: string;
      minute: number;
      type: 'GOAL' | 'YELLOW_CARD' | 'RED_CARD' | 'VAR_CHECK' | 'PENALTY' | 'DANGEROUS_ATTACK';
      team: 'HOME' | 'AWAY';
      player: string;
      scoreAfter?: string;
      description: string;
    }>;
    liveStats?: {
      possession: { home: number; away: number };
      shots: { home: number; away: number };
      shotsOnTarget: { home: number; away: number };
      corners: { home: number; away: number };
      fouls: { home: number; away: number };
      yellowCards: { home: number; away: number };
      redCards: { home: number; away: number };
      liveXg: { home: number; away: number };
      pitchTilt: { home: number; away: number };
    };
    inPlayProbabilities?: {
      homeWin: number;
      draw: number;
      awayWin: number;
    };
  };
}

interface CompetitionItem {
  id: number;
  code: string;
  name: string;
  country: string;
  tier: number;
  type: string;
  totalMatches?: number;
}

interface TeamItem {
  id: number;
  canonicalName: string;
  shortName: string;
  tla?: string;
  country: string;
  venueName?: string;
  rating?: {
    overallElo: number;
    attackRating: number;
    defenseRating: number;
    homeAdvantage: number;
  };
}

interface PredictionData {
  matchId?: number;
  match: {
    homeTeam: string;
    awayTeam: string;
    competition: string;
    kickoffTime: string;
    venue: string;
  };
  prediction: {
    homeWin: number;
    draw: number;
    awayWin: number;
  };
  fairOdds?: {
    home: number;
    draw: number;
    away: number;
  };
  expectedGoals: {
    home: number;
    away: number;
    total: number;
  };
  mostLikelyScore?: string;
  markets?: {
    over25?: number;
    bttsYes?: number;
    under25?: number;
    bttsNo?: number;
  };
  teamRatings?: {
    homeElo?: number;
    awayElo?: number;
    homeAttack?: number;
    awayAttack?: number;
    homeDefense?: number;
    awayDefense?: number;
  };
  dataQuality: {
    score: number;
    rating: 'EXCELLENT' | 'GOOD' | 'MODERATE' | 'LIMITED';
    factors: string[];
  };
  confidence: {
    level: 'HIGH' | 'MEDIUM' | 'LOW';
    score: number;
    reason: string;
  };
  modelVersion: string;
}

export default function App() {
  const { user, loading: authLoading, signIn, signOut, getIdToken, isFirebaseReady } = useAuth();

  // 5 Clean Core Tabs: 'matches' | 'live' | 'value' | 'standings' | 'portfolio'
  const [activeTab, setActiveTab] = useState<'matches' | 'live' | 'value' | 'standings' | 'portfolio' | 'database'>('matches');

  // Sub-view selectors
  const [matchesSubView, setMatchesSubView] = useState<'upcoming' | 'all'>('upcoming');
  const [standingsSubView, setStandingsSubView] = useState<'table' | 'h2h'>('table');

  // Data states
  const [matches, setMatches] = useState<MatchItem[]>([]);
  const [liveFeedSnapshot, setLiveFeedSnapshot] = useState<any>(null);
  const [competitions, setCompetitions] = useState<CompetitionItem[]>([]);
  const [teamsList, setTeamsList] = useState<TeamItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [healthInfo, setHealthInfo] = useState<any>(null);
  const [dataSources, setDataSources] = useState<any[]>([]);

  // Filter states
  const [selectedComp, setSelectedComp] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LIVE' | 'SCHEDULED' | 'FINISHED'>('ALL');
  const [selectedTimezone, setSelectedTimezone] = useState<string>('local');

  // Bet slip drawer & notification toast
  const [isBetSlipOpen, setIsBetSlipOpen] = useState<boolean>(false);
  const [slipCount, setSlipCount] = useState<number>(() => PortfolioStore.getState().slip.length);
  const [appNotice, setAppNotice] = useState<string>('');

  // Feeds & Settings Modal
  const [isFeedsModalOpen, setIsFeedsModalOpen] = useState<boolean>(false);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<string>('');

  // Inspection modal
  const [activePrediction, setActivePrediction] = useState<PredictionData | null>(null);
  const [predLoading, setPredLoading] = useState<boolean>(false);

  // Live polling
  const [lastPollTime, setLastPollTime] = useState<Date>(new Date());
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);

  useEffect(() => {
    const unsub = PortfolioStore.subscribe((state) => {
      setSlipCount(state.slip.length);
    });
    return () => unsub();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [matchesRes, liveFeedRes, compsRes, teamsRes, healthRes, sourcesRes] = await Promise.all([
        ErrorReportingService.fetchJson<MatchItem[]>('/api/matches', undefined, {
          source: 'App.fetchData',
          fallbackValue: [],
        }),
        ErrorReportingService.fetchJson<any>('/api/matches/live-feed', undefined, {
          source: 'App.fetchData',
          fallbackValue: null,
        }),
        ErrorReportingService.fetchJson<CompetitionItem[]>('/api/competitions', undefined, {
          source: 'App.fetchData',
          fallbackValue: [],
        }),
        ErrorReportingService.fetchJson<TeamItem[]>('/api/teams', undefined, {
          source: 'App.fetchData',
          fallbackValue: [],
        }),
        ErrorReportingService.fetchJson<any>('/api/health', undefined, {
          source: 'App.fetchData',
          fallbackValue: null,
        }),
        ErrorReportingService.fetchJson<any>('/api/data-sources', undefined, {
          source: 'App.fetchData',
          fallbackValue: null,
        }),
      ]);

      if (Array.isArray(matchesRes)) {
        setMatches(matchesRes);
        setLastPollTime(new Date());
      }
      if (liveFeedRes) setLiveFeedSnapshot(liveFeedRes);
      if (Array.isArray(compsRes)) setCompetitions(compsRes);
      if (Array.isArray(teamsRes)) setTeamsList(teamsRes);
      if (healthRes) setHealthInfo(healthRes);
      if (sourcesRes?.providers) setDataSources(sourcesRes.providers);
    } catch (err) {
      console.error('Failed to load initial data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Periodic polling for live scores & web feed every 8s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const [data, liveFeed] = await Promise.all([
          ErrorReportingService.fetchJson<MatchItem[]>('/api/matches', undefined, {
            source: 'App.livePolling',
          }),
          ErrorReportingService.fetchJson<any>('/api/matches/live-feed', undefined, {
            source: 'App.livePolling',
            fallbackValue: null,
          }),
        ]);
        if (Array.isArray(data)) {
          setMatches(data);
          setLastPollTime(new Date());
        }
        if (liveFeed) {
          setLiveFeedSnapshot(liveFeed);
        }
      } catch {
        // Error already reported by centralized ErrorReportingService
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  const handleManualRefresh = async () => {
    try {
      setIsRefreshing(true);
      const [data, liveFeed] = await Promise.all([
        ErrorReportingService.fetchJson<MatchItem[]>('/api/matches', undefined, {
          source: 'App.handleManualRefresh',
        }),
        ErrorReportingService.fetchJson<any>('/api/matches/live-feed?refresh=1', undefined, {
          source: 'App.handleManualRefresh',
          fallbackValue: null,
        }),
      ]);
      if (Array.isArray(data)) {
        setMatches(data);
        setLastPollTime(new Date());
      }
      if (liveFeed) {
        setLiveFeedSnapshot(liveFeed);
      }
    } catch (err) {
      console.error('Manual refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleTriggerSync = async () => {
    try {
      const token = await getIdToken();
      if (!token) {
        setSyncNotice('Admin sign-in required to trigger global fixture synchronization.');
        return;
      }
      setSyncing(true);
      setSyncNotice('Connecting to official providers...');
      const res = await ErrorReportingService.apiFetch(
        '/api/sync',
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
        { source: 'App.handleTriggerSync' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncNotice(`Sync failed (${res.status}): ${data?.error || 'Request rejected'}`);
        return;
      }
      setSyncNotice(data.message || 'Worldwide fixture synchronization complete');
      await fetchData();
    } catch (err: any) {
      setSyncNotice(`Sync error: ${err?.message || 'Unable to reach synchronization endpoint'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleInspectMatch = async (m: any) => {
    try {
      setPredLoading(true);
      const payload: any = {
        homeTeam: m.homeTeam,
        awayTeam: m.awayTeam,
        competition: m.competitionName || m.competition,
        kickoff: m.kickoffTime,
      };
      if (m.id && m.isDatabaseMatch !== false && m.status === 'SCHEDULED') {
        payload.fixtureId = m.id;
      }
      const data = await ErrorReportingService.fetchJson<PredictionData>(
        '/api/predict',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
        { source: 'App.handleInspectMatch' }
      );
      setActivePrediction(data);
    } catch (err) {
      console.error('Failed to predict match:', err);
    } finally {
      setPredLoading(false);
    }
  };

  const liveMatches = useMemo(() => {
    const feedLive: any[] = Array.isArray(liveFeedSnapshot?.liveMatches)
      ? liveFeedSnapshot.liveMatches
      : [];
    const dbLive = matches.filter((m) => m.status === 'LIVE');
    const seen = new Set(feedLive.map((m) => m.externalId));
    const merged = [...feedLive];
    for (const m of dbLive) {
      if (!seen.has(m.externalId)) {
        merged.push(m);
      }
    }
    return merged;
  }, [liveFeedSnapshot, matches]);

  const formatKickoff = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      if (selectedTimezone === 'local') {
        return d.toLocaleString([], {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });
      }
      return d.toLocaleString([], {
        timeZone: selectedTimezone,
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return new Date(isoStr).toLocaleString();
    }
  };

  const calcFairOdds = (prob: number) => {
    if (!prob || prob <= 0) return '—';
    return (1 / prob).toFixed(2);
  };

  const filteredMatches = useMemo(() => {
    return matches.filter((m) => {
      const matchComp = selectedComp === 'ALL' || m.competitionCode === selectedComp;
      const matchStatus = statusFilter === 'ALL' || m.status === statusFilter;
      const matchSearch =
        searchQuery === '' ||
        m.homeTeam.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.awayTeam.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.competitionName.toLowerCase().includes(searchQuery.toLowerCase());

      return matchComp && matchStatus && matchSearch;
    });
  }, [matches, selectedComp, statusFilter, searchQuery]);

  const handleAddBetToSlip = (
    matchId: number,
    homeTeam: string,
    awayTeam: string,
    competition: string,
    marketType: 'MATCH_WINNER_HOME' | 'MATCH_WINNER_DRAW' | 'MATCH_WINNER_AWAY',
    selection: string,
    odds: number,
    prob: number
  ) => {
    PortfolioStore.addToSlip({
      matchId,
      homeTeam,
      awayTeam,
      competition,
      kickoffTime: new Date().toISOString(),
      marketType,
      selection,
      selectionLabel: selection,
      bookmakerOdds: odds,
      modelProbability: prob,
      edgePercent: prob > 0 ? ((odds * prob) - 1) * 100 : 0,
      recommendedKellyPercent: 2.5,
    });
    setAppNotice(`Added ${selection} (${odds.toFixed(2)}) to slip`);
    setTimeout(() => setAppNotice(''), 3000);
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex flex-col font-sans selection:bg-emerald-500 selection:text-slate-950">
      {/* Top Header - Strict Clean 3-Zone Contract */}
      <header className="border-b border-slate-800/80 bg-[#070b14]/95 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-6">
          {/* Zone 1: Brand Wordmark */}
          <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center shadow-inner">
              <Shield className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-base sm:text-lg tracking-tight text-white leading-none">
                PitchIntel
              </span>
              <span className="text-[10px] text-slate-400 font-medium tracking-wide">
                Football Intelligence
              </span>
            </div>
          </div>

          {/* Zone 2: Clean 5-Tab Navigation */}
          <nav className="hidden md:flex items-center gap-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setActiveTab('matches')}
              className={`px-3.5 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'matches'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              Matches
            </button>

            <button
              onClick={() => setActiveTab('live')}
              className={`px-3.5 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'live'
                  ? 'bg-rose-500 text-white font-semibold shadow-sm'
                  : 'text-rose-400 hover:text-rose-300 hover:bg-slate-800/60'
              }`}
            >
              <span className="relative flex h-2 w-2">
                {liveMatches.length > 0 && (
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                )}
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              Live ({liveMatches.length})
            </button>

            <button
              onClick={() => setActiveTab('value')}
              className={`px-3.5 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'value'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-emerald-400 hover:text-emerald-300 hover:bg-slate-800/60'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
              Value (+EV)
            </button>

            <button
              onClick={() => setActiveTab('standings')}
              className={`px-3.5 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'standings'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Trophy className="w-3.5 h-3.5" />
              Standings &amp; H2H
            </button>

            <button
              onClick={() => setActiveTab('portfolio')}
              className={`px-3.5 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'portfolio'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <DollarSign className="w-3.5 h-3.5" />
              Portfolio
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`px-3.5 py-1.5 font-medium rounded-lg transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'database'
                  ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              Historical DB
            </button>
          </nav>

          {/* Zone 3: Actions & Tools */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Timezone Selector */}
            <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-slate-900 border border-slate-800 rounded-lg text-xs text-slate-300">
              <Globe className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <select
                value={selectedTimezone}
                onChange={(e) => setSelectedTimezone(e.target.value)}
                className="bg-transparent border-none text-[11px] text-slate-200 focus:outline-none cursor-pointer"
                title="Select Match Kickoff Display Timezone"
              >
                <option value="local">Local Time</option>
                <option value="Africa/Lusaka">Lusaka (CAT, UTC+2)</option>
                <option value="UTC">UTC (Universal)</option>
                <option value="Europe/London">London (GMT/BST)</option>
                <option value="Europe/Paris">Paris / Madrid (CET)</option>
                <option value="America/New_York">New York (EST/EDT)</option>
              </select>
            </div>

            {/* Bet Slip Trigger */}
            <button
              onClick={() => setIsBetSlipOpen(true)}
              className="relative inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg shadow-sm whitespace-nowrap cursor-pointer transition"
              title="Open Paper Trading Bet Slip"
            >
              <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
              <span>Slip</span>
              {slipCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500 text-slate-950 text-[10px] font-mono font-bold">
                  {slipCount}
                </span>
              )}
            </button>

            {/* In-app PWA install button */}
            <PWAInstallButton />

            {/* Data Feeds & Health Dialog */}
            <button
              onClick={() => setIsFeedsModalOpen(true)}
              className="p-1.5 text-slate-400 hover:text-white bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition cursor-pointer"
              title="Data Feeds, Cloud Database & Firebase Status"
            >
              <Database className="w-4 h-4 text-emerald-400" />
            </button>

            {/* Firebase User Profile / Google Sign-In */}
            {user ? (
              <div className="flex items-center gap-1.5 pl-1">
                <div
                  className="flex items-center gap-1.5 px-2 py-1 bg-slate-900 border border-emerald-500/30 rounded-lg text-xs"
                  title={`Signed in with Firebase as ${user.email}`}
                >
                  {user.photoURL ? (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-4 h-4 rounded-full"
                    />
                  ) : (
                    <div className="w-4 h-4 rounded-full bg-emerald-500 text-slate-950 font-bold flex items-center justify-center text-[10px]">
                      {(user.displayName || user.email || 'U')[0].toUpperCase()}
                    </div>
                  )}
                  <span className="hidden sm:inline font-medium text-slate-300 max-w-[100px] truncate">
                    {user.displayName || user.email?.split('@')[0]}
                  </span>
                </div>
                <button
                  onClick={() => signOut()}
                  className="p-1.5 text-slate-400 hover:text-rose-400 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-lg transition cursor-pointer"
                  title="Sign out of Firebase"
                >
                  <LogOut className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => signIn()}
                disabled={authLoading}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-200 bg-slate-900 hover:bg-slate-800 border border-slate-700/80 rounded-lg shadow-sm whitespace-nowrap cursor-pointer transition hover:text-white"
                title="Sign in with Google to sync portfolio to Firestore"
              >
                <LogIn className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Sign In</span>
              </button>
            )}
          </div>
        </div>

        {/* Mobile Tab Strip */}
        <div className="md:hidden flex items-center gap-1 px-4 py-2 bg-slate-950 border-t border-slate-900 text-xs overflow-x-auto">
          {[
            { id: 'matches', label: 'Matches' },
            { id: 'live', label: `Live (${liveMatches.length})` },
            { id: 'value', label: 'Value (+EV)' },
            { id: 'standings', label: 'Standings & H2H' },
            { id: 'portfolio', label: 'Portfolio' },
            { id: 'database', label: 'Historical DB' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3 py-1 rounded-md text-xs whitespace-nowrap cursor-pointer ${
                activeTab === tab.id ? 'bg-emerald-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {/* Global Toast Notification */}
      {appNotice && (
        <div className="fixed bottom-6 right-6 z-50 p-3 bg-emerald-500 text-slate-950 font-semibold text-xs rounded-xl shadow-2xl flex items-center gap-2 animate-bounce">
          <CheckCircle2 className="w-4 h-4" />
          <span>{appNotice}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">

        {/* =========================================================================
            TAB 1: MATCHES & PREDICTIONS
        ========================================================================= */}
        {activeTab === 'matches' && (
          <div className="space-y-6">
            {/* Clean Sub-Navigation & Header Strip */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Football Matches &amp; Forecasts
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Poisson outcome probabilities, fair odds, and expected goals over verified global fixtures.
                </p>
              </div>

              {/* View Switcher: Upcoming Predictions vs All Matches Archive */}
              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs self-start sm:self-auto">
                <button
                  onClick={() => setMatchesSubView('upcoming')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    matchesSubView === 'upcoming'
                      ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Upcoming Predictions
                </button>
                <button
                  onClick={() => setMatchesSubView('all')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    matchesSubView === 'all'
                      ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  All Fixtures &amp; Results
                </button>
              </div>
            </div>

            {/* SUB-VIEW 1: UPCOMING PREDICTIONS QUEUE */}
            {matchesSubView === 'upcoming' && (
              <UpcomingPredictionQueue onInspectMatch={handleInspectMatch} />
            )}

            {/* SUB-VIEW 2: ALL FIXTURES & HISTORICAL RESULTS */}
            {matchesSubView === 'all' && (
              <div className="space-y-4">
                {/* Search & Competition Filter Controls */}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-slate-900/90 p-3 rounded-2xl border border-slate-800">
                  <div className="relative flex-1 max-w-md">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search club, competition, or venue..."
                      className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="flex items-center gap-2 overflow-x-auto text-xs">
                    <select
                      value={selectedComp}
                      onChange={(e) => setSelectedComp(e.target.value)}
                      className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
                    >
                      <option value="ALL">All Competitions ({competitions.length})</option>
                      {competitions.map((c) => (
                        <option key={c.id} value={c.code}>
                          {c.name} ({c.country})
                        </option>
                      ))}
                    </select>

                    <button
                      onClick={() => setStatusFilter('ALL')}
                      className={`px-3 py-2 rounded-xl font-medium transition whitespace-nowrap cursor-pointer ${
                        statusFilter === 'ALL'
                          ? 'bg-slate-800 text-white'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      All ({matches.length})
                    </button>
                    <button
                      onClick={() => setStatusFilter('SCHEDULED')}
                      className={`px-3 py-2 rounded-xl font-medium transition whitespace-nowrap cursor-pointer ${
                        statusFilter === 'SCHEDULED'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Upcoming
                    </button>
                    <button
                      onClick={() => setStatusFilter('FINISHED')}
                      className={`px-3 py-2 rounded-xl font-medium transition whitespace-nowrap cursor-pointer ${
                        statusFilter === 'FINISHED'
                          ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          : 'bg-slate-950 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      Results
                    </button>
                  </div>
                </div>

                {/* Matches Grid List */}
                {loading ? (
                  <div className="p-12 text-center text-slate-400 space-y-3">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
                    <p className="text-sm">Loading match fixtures from database...</p>
                  </div>
                ) : filteredMatches.length === 0 ? (
                  <div className="p-12 text-center bg-slate-900/50 rounded-2xl border border-slate-800 space-y-2">
                    <Info className="w-8 h-8 text-slate-500 mx-auto" />
                    <h3 className="text-sm font-semibold text-white">No fixtures found</h3>
                    <p className="text-xs text-slate-400">Try adjusting your search query or competition filter.</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredMatches.slice(0, 48).map((m) => (
                      <div
                        key={m.id}
                        className="p-4 bg-slate-900/80 hover:bg-slate-900 border border-slate-800 hover:border-slate-700/80 rounded-2xl transition flex flex-col justify-between space-y-3"
                      >
                        <div>
                          {/* Competition and Kickoff header */}
                          <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800 text-slate-400">
                            <span className="font-semibold text-slate-300 truncate max-w-[180px]">
                              {m.competitionName}
                            </span>
                            <span className="font-mono text-[11px] text-slate-400">
                              {formatKickoff(m.kickoffTime)}
                            </span>
                          </div>

                          {/* Teams & Scores */}
                          <div className="py-2.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-white text-sm">{m.homeTeam}</span>
                              <span className="font-mono font-bold text-base text-slate-200">
                                {m.homeScoreFullTime !== null && m.homeScoreFullTime !== undefined
                                  ? m.homeScoreFullTime
                                  : '—'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-white text-sm">{m.awayTeam}</span>
                              <span className="font-mono font-bold text-base text-slate-200">
                                {m.awayScoreFullTime !== null && m.awayScoreFullTime !== undefined
                                  ? m.awayScoreFullTime
                                  : '—'}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Action Row */}
                        <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
                          <span className="text-[11px] text-slate-500 font-mono">
                            {m.status === 'FINISHED' ? 'FT' : m.status === 'LIVE' ? 'In Play' : 'Scheduled'}
                          </span>
                          <button
                            onClick={() => handleInspectMatch(m)}
                            className="px-3 py-1 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-lg text-xs font-semibold transition flex items-center gap-1 cursor-pointer"
                          >
                            <Sparkles className="w-3 h-3 text-emerald-400" />
                            Analyze
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 2: LIVE SCORES, LIVE WEB FEED & IN-PLAY DASHBOARD
        ========================================================================= */}
        {activeTab === 'live' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                    Live Match Center &amp; Web Feed
                  </h1>
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                    {liveMatches.length} Active
                  </span>
                  {liveFeedSnapshot?.leaguesCovered > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                      {liveFeedSnapshot.leaguesCovered} Leagues Streamed
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Real-time verified match minutes, live events, team stats, and global web scoreboard synced every 8s (last updated {lastPollTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}).
                </p>
              </div>

              <button
                onClick={handleManualRefresh}
                disabled={isRefreshing}
                className="px-3.5 py-1.5 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-medium text-slate-300 rounded-xl transition flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
                Refresh Feed
              </button>
            </div>

            {/* Live Web Feed Source Strip */}
            {Array.isArray(liveFeedSnapshot?.feedSources) && liveFeedSnapshot.feedSources.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                {liveFeedSnapshot.feedSources.map((fs: any) => (
                  <div
                    key={fs.id}
                    className="px-3 py-2 bg-slate-900/80 border border-slate-800 rounded-xl flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="min-w-0">
                      <span className="font-semibold text-slate-200 block truncate">{fs.name}</span>
                      <span className="text-[11px] text-slate-400 block truncate">{fs.detail}</span>
                    </div>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold shrink-0 ${
                        fs.status === 'OPERATIONAL'
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : fs.status === 'STANDBY'
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                      }`}
                    >
                      {fs.status}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {liveMatches.length === 0 ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-3xl p-10 text-center space-y-3">
                <div className="w-11 h-11 rounded-2xl bg-slate-800 mx-auto flex items-center justify-center text-slate-400">
                  <Clock className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-white">No Matches Currently In Play</h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
                  Live scores, match clocks, events, and in-play probabilities stream automatically here as soon as fixtures kick off across tracked leagues.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {liveMatches.map((m) => (
                  <div
                    key={m.externalId || m.id}
                    className="p-5 bg-slate-900 border border-rose-500/40 rounded-2xl space-y-4 shadow-lg shadow-black/40"
                  >
                    <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-800">
                      <span className="font-semibold text-slate-300 truncate max-w-[220px]">
                        {m.competitionName}
                      </span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500 text-white flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                        {m.metadata?.displayClock ||
                          (typeof m.metadata?.minute === 'number'
                            ? `${m.metadata.minute}'`
                            : m.metadata?.period || 'LIVE')}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 items-center gap-4 py-1">
                      <div className="text-left font-bold text-base text-white">{m.homeTeam}</div>
                      <div className="text-center font-mono font-black text-3xl text-emerald-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                        {m.homeScoreFullTime ?? 0} : {m.awayScoreFullTime ?? 0}
                      </div>
                      <div className="text-right font-bold text-base text-white">{m.awayTeam}</div>
                    </div>

                    {/* Verified Live Team Stats when provided by feed */}
                    {m.metadata?.liveStats && (
                      <div className="grid grid-cols-4 gap-2 text-center bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80 text-[11px] font-mono">
                        <div>
                          <span className="text-slate-500 block text-[10px]">Possession</span>
                          <strong className="text-slate-200">
                            {m.metadata.liveStats.possession
                              ? `${m.metadata.liveStats.possession.home}% - ${m.metadata.liveStats.possession.away}%`
                              : '—'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Shots</span>
                          <strong className="text-slate-200">
                            {m.metadata.liveStats.shots
                              ? `${m.metadata.liveStats.shots.home} - ${m.metadata.liveStats.shots.away}`
                              : '—'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">On Target</span>
                          <strong className="text-slate-200">
                            {m.metadata.liveStats.shotsOnTarget
                              ? `${m.metadata.liveStats.shotsOnTarget.home} - ${m.metadata.liveStats.shotsOnTarget.away}`
                              : '—'}
                          </strong>
                        </div>
                        <div>
                          <span className="text-slate-500 block text-[10px]">Corners</span>
                          <strong className="text-slate-200">
                            {m.metadata.liveStats.corners
                              ? `${m.metadata.liveStats.corners.home} - ${m.metadata.liveStats.corners.away}`
                              : '—'}
                          </strong>
                        </div>
                      </div>
                    )}

                    {/* Verified Live Events Ticker */}
                    {Array.isArray(m.metadata?.events) && m.metadata.events.length > 0 && (
                      <div className="space-y-1 bg-slate-950/50 px-3 py-2 rounded-xl border border-slate-800/60 text-[11px]">
                        {m.metadata.events.slice(-3).map((ev: any) => (
                          <div key={ev.id} className="flex items-center justify-between gap-2 text-slate-300">
                            <span className="truncate">{ev.description}</span>
                            <span className="text-[10px] font-mono text-slate-500 shrink-0">
                              {ev.team === 'HOME' ? m.homeShortName : m.awayShortName}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Live In-Play Probability Bar */}
                    {m.metadata?.inPlayProbabilities && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-800">
                        <div className="flex justify-between text-[11px] text-slate-400 font-mono">
                          <span>Home: {(m.metadata.inPlayProbabilities.homeWin * 100).toFixed(0)}%</span>
                          <span>Draw: {(m.metadata.inPlayProbabilities.draw * 100).toFixed(0)}%</span>
                          <span>Away: {(m.metadata.inPlayProbabilities.awayWin * 100).toFixed(0)}%</span>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden flex bg-slate-950 border border-slate-800">
                          <div
                            style={{ width: `${m.metadata.inPlayProbabilities.homeWin * 100}%` }}
                            className="bg-emerald-500"
                          />
                          <div
                            style={{ width: `${m.metadata.inPlayProbabilities.draw * 100}%` }}
                            className="bg-amber-500"
                          />
                          <div
                            style={{ width: `${m.metadata.inPlayProbabilities.awayWin * 100}%` }}
                            className="bg-cyan-500"
                          />
                        </div>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-xs pt-1">
                      <span className="text-[11px] text-slate-500 font-mono">
                        {m.metadata?.liveStats?.liveXg
                          ? `xG: ${m.metadata.liveStats.liveXg.home} - ${m.metadata.liveStats.liveXg.away}`
                          : `Feed: ${m.metadata?.providerSource || 'live-web-feed'}`}
                      </span>
                      <button
                        onClick={() => handleInspectMatch(m)}
                        className="px-3 py-1 bg-slate-800 hover:bg-emerald-600 text-white rounded-lg text-xs font-semibold transition cursor-pointer"
                      >
                        Inspect Match
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Global Live Web Scoreboard & Dispatches */}
            {liveFeedSnapshot && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-2">
                {/* Upcoming & Recent Web Scoreboard Fixtures */}
                <div className="lg:col-span-7 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-emerald-400" />
                      <h3 className="text-sm font-bold text-white">Global Web Scoreboard</h3>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {liveFeedSnapshot.upcomingToday?.length || 0} Upcoming • {liveFeedSnapshot.recentResults?.length || 0} FT
                    </span>
                  </div>

                  <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                    {[...(liveFeedSnapshot.upcomingToday || []), ...(liveFeedSnapshot.recentResults || [])]
                      .slice(0, 14)
                      .map((item: any) => (
                        <div
                          key={item.externalId}
                          className="p-2.5 bg-slate-950/80 border border-slate-800/80 rounded-xl flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] text-emerald-400 font-semibold block truncate">
                              {item.competitionName}
                            </span>
                            <div className="font-semibold text-white truncate">
                              {item.homeTeam}{' '}
                              <span className="text-slate-400 font-mono">
                                {item.status === 'FINISHED'
                                  ? `${item.homeScoreFullTime ?? 0}-${item.awayScoreFullTime ?? 0}`
                                  : 'vs'}
                              </span>{' '}
                              {item.awayTeam}
                            </div>
                            <span className="text-[11px] text-slate-500 font-mono">
                              {item.status === 'FINISHED' ? 'FT' : formatKickoff(item.kickoffTime)}
                              {item.moneylineOdds
                                ? ` • Odds ${item.moneylineOdds.home}/${item.moneylineOdds.draw}/${item.moneylineOdds.away}`
                                : ''}
                            </span>
                          </div>
                          <button
                            onClick={() => handleInspectMatch(item)}
                            className="px-2.5 py-1 bg-slate-800 hover:bg-emerald-600 text-slate-200 hover:text-white rounded-lg text-[11px] font-semibold transition shrink-0 cursor-pointer"
                          >
                            Analyze
                          </button>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Live Football Web Dispatches */}
                <div className="lg:col-span-5 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <Flame className="w-4 h-4 text-amber-400" />
                      <h3 className="text-sm font-bold text-white">Live Football Dispatches</h3>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">
                      {liveFeedSnapshot.dispatches?.length || 0} Verified
                    </span>
                  </div>

                  <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                    {(liveFeedSnapshot.dispatches || []).map((art: any) => (
                      <a
                        key={art.id}
                        href={art.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block p-3 bg-slate-950/80 hover:bg-slate-950 border border-slate-800/80 hover:border-emerald-500/40 rounded-xl transition space-y-1"
                      >
                        <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                          <span className="text-emerald-400 font-semibold">{art.source}</span>
                          <span>
                            {new Date(art.publishedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="text-xs font-semibold text-white leading-snug line-clamp-2">
                          {art.title}
                        </p>
                      </a>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 3: VALUE BET SCANNER (+EV)
        ========================================================================= */}
        {activeTab === 'value' && (
          <ValueBetScanner onNotify={(msg) => setAppNotice(msg)} />
        )}

        {/* =========================================================================
            TAB 4: STANDINGS & HEAD-TO-HEAD
        ========================================================================= */}
        {activeTab === 'standings' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-800/80">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Standings &amp; Head-to-Head Comparison
                </h1>
                <p className="text-xs text-slate-400 mt-0.5">
                  Official league tables, team records, and direct historical clash statistics.
                </p>
              </div>

              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs self-start sm:self-auto">
                <button
                  onClick={() => setStandingsSubView('table')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    standingsSubView === 'table'
                      ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  League Tables
                </button>
                <button
                  onClick={() => setStandingsSubView('h2h')}
                  className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                    standingsSubView === 'h2h'
                      ? 'bg-emerald-500 text-slate-950 font-semibold shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Head-to-Head
                </button>
              </div>
            </div>

            {standingsSubView === 'table' ? (
              <LeagueStandingsView />
            ) : (
              <HeadToHeadView teamsList={teamsList} />
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 5: PORTFOLIO & BETTING SLIP
        ========================================================================= */}
        {activeTab === 'portfolio' && (
          <PortfolioDashboard
            onOpenBetSlip={() => setIsBetSlipOpen(true)}
            onNotify={(msg) => setAppNotice(msg)}
          />
        )}

        {/* =========================================================================
            TAB 6: WORLDWIDE HISTORICAL FOOTBALL DATABASE
        ========================================================================= */}
        {activeTab === 'database' && (
          <HistoricalCoverageDashboard />
        )}
      </main>

      {/* =========================================================================
          MATCH DETAIL INSPECTION MODAL (CLEAN & STRAIGHTFORWARD)
      ========================================================================= */}
      {activePrediction && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-6 shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-start justify-between pb-4 border-b border-slate-800">
              <div>
                <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider block">
                  {activePrediction.match.competition}
                </span>
                <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
                  {activePrediction.match.homeTeam} vs {activePrediction.match.awayTeam}
                </h2>
                <p className="text-xs text-slate-400 mt-1 font-mono">
                  Kickoff: {formatKickoff(activePrediction.match.kickoffTime)} • Venue: {activePrediction.match.venue || 'Stadium'}
                </p>
              </div>
              <button
                onClick={() => setActivePrediction(null)}
                className="w-8 h-8 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center font-bold cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Core Outcome Probabilities Cards */}
            <div>
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2.5">
                Outcome Probabilities &amp; Model Fair Odds
              </span>
              <div className="grid grid-cols-3 gap-3">
                {(() => {
                  const homeFair = activePrediction.fairOdds?.home || (activePrediction.prediction.homeWin > 0 ? Math.round((1 / activePrediction.prediction.homeWin) * 100) / 100 : 0);
                  const drawFair = activePrediction.fairOdds?.draw || (activePrediction.prediction.draw > 0 ? Math.round((1 / activePrediction.prediction.draw) * 100) / 100 : 0);
                  const awayFair = activePrediction.fairOdds?.away || (activePrediction.prediction.awayWin > 0 ? Math.round((1 / activePrediction.prediction.awayWin) * 100) / 100 : 0);
                  return (
                    <>
                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center space-y-1">
                        <span className="text-xs text-slate-400 font-medium block">Home Win</span>
                        <span className="text-2xl font-black text-emerald-400 font-mono block tabular-nums">
                          {(activePrediction.prediction.homeWin * 100).toFixed(1)}%
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono block">
                          Fair: {calcFairOdds(activePrediction.prediction.homeWin)}
                        </span>
                        {homeFair > 1 && (
                          <button
                            onClick={() =>
                              handleAddBetToSlip(
                                activePrediction.matchId || 1,
                                activePrediction.match.homeTeam,
                                activePrediction.match.awayTeam,
                                activePrediction.match.competition,
                                'MATCH_WINNER_HOME',
                                `${activePrediction.match.homeTeam} Win`,
                                homeFair,
                                activePrediction.prediction.homeWin
                              )
                            }
                            className="w-full mt-2 py-1 text-[11px] font-semibold bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 rounded-lg transition cursor-pointer"
                          >
                            + Paper @ {homeFair.toFixed(2)}
                          </button>
                        )}
                      </div>

                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center space-y-1">
                        <span className="text-xs text-slate-400 font-medium block">Draw</span>
                        <span className="text-2xl font-black text-amber-400 font-mono block tabular-nums">
                          {(activePrediction.prediction.draw * 100).toFixed(1)}%
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono block">
                          Fair: {calcFairOdds(activePrediction.prediction.draw)}
                        </span>
                        {drawFair > 1 && (
                          <button
                            onClick={() =>
                              handleAddBetToSlip(
                                activePrediction.matchId || 1,
                                activePrediction.match.homeTeam,
                                activePrediction.match.awayTeam,
                                activePrediction.match.competition,
                                'MATCH_WINNER_DRAW',
                                'Draw',
                                drawFair,
                                activePrediction.prediction.draw
                              )
                            }
                            className="w-full mt-2 py-1 text-[11px] font-semibold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 rounded-lg transition cursor-pointer"
                          >
                            + Paper @ {drawFair.toFixed(2)}
                          </button>
                        )}
                      </div>

                      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-center space-y-1">
                        <span className="text-xs text-slate-400 font-medium block">Away Win</span>
                        <span className="text-2xl font-black text-cyan-400 font-mono block tabular-nums">
                          {(activePrediction.prediction.awayWin * 100).toFixed(1)}%
                        </span>
                        <span className="text-[11px] text-slate-500 font-mono block">
                          Fair: {calcFairOdds(activePrediction.prediction.awayWin)}
                        </span>
                        {awayFair > 1 && (
                          <button
                            onClick={() =>
                              handleAddBetToSlip(
                                activePrediction.matchId || 1,
                                activePrediction.match.homeTeam,
                                activePrediction.match.awayTeam,
                                activePrediction.match.competition,
                                'MATCH_WINNER_AWAY',
                                `${activePrediction.match.awayTeam} Win`,
                                awayFair,
                                activePrediction.prediction.awayWin
                              )
                            }
                            className="w-full mt-2 py-1 text-[11px] font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 rounded-lg transition cursor-pointer"
                          >
                            + Paper @ {awayFair.toFixed(2)}
                          </button>
                        )}
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Expected Goals & Score Projection */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400 font-medium block">Expected Goals (xG)</span>
                <span className="text-lg font-bold text-emerald-400 font-mono block tabular-nums">
                  {activePrediction.expectedGoals.home.toFixed(2)} - {activePrediction.expectedGoals.away.toFixed(2)}
                </span>
                <span className="text-[11px] text-slate-500 font-mono block">
                  Total Match xG: {activePrediction.expectedGoals.total.toFixed(2)}
                </span>
              </div>

              <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-1">
                <span className="text-xs text-slate-400 font-medium block">Market Projections</span>
                <div className="flex items-center justify-between text-xs text-slate-300 pt-0.5">
                  <span>Over 2.5 Goals:</span>
                  <strong className="text-white font-mono">
                    {typeof activePrediction.markets?.over25 === 'number'
                      ? `${(activePrediction.markets.over25 * 100).toFixed(0)}%`
                      : 'N/A'}
                  </strong>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Both Teams to Score (BTTS):</span>
                  <strong className="text-white font-mono">
                    {typeof activePrediction.markets?.bttsYes === 'number'
                      ? `${(activePrediction.markets.bttsYes * 100).toFixed(0)}%`
                      : 'N/A'}
                  </strong>
                </div>
              </div>
            </div>

            {/* Model Quality & Reliability */}
            <div className="p-3 bg-slate-950/80 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Confidence: <strong className="text-white">{activePrediction.confidence.level}</strong></span>
                <span aria-hidden="true">·</span>
                <span>Data Quality: <strong className="text-white">{activePrediction.dataQuality.rating}</strong></span>
              </div>
              <span className="text-[11px] font-mono text-slate-500">
                {activePrediction.modelVersion}
              </span>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setActivePrediction(null)}
                className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          DATA FEEDS & CONNECTIVITY MODAL
      ========================================================================= */}
      {isFeedsModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-lg w-full p-6 space-y-6 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-400" />
                <h3 className="text-lg font-bold text-white">Data Feeds &amp; Database Health</h3>
              </div>
              <button
                onClick={() => setIsFeedsModalOpen(false)}
                className="w-7 h-7 rounded-full bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <div className="space-y-4 text-xs">
              {/* Database status */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">PostgreSQL Database</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    Connected
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-center pt-1 font-mono text-slate-300">
                  <div className="p-2 bg-slate-900/60 rounded-lg">
                    <span className="block text-slate-500 text-[10px]">Fixtures</span>
                    <strong className="text-white text-sm">
                      {healthInfo?.database?.records?.matches?.toLocaleString() ?? matches.length.toLocaleString()}
                    </strong>
                  </div>
                  <div className="p-2 bg-slate-900/60 rounded-lg">
                    <span className="block text-slate-500 text-[10px]">Clubs</span>
                    <strong className="text-white text-sm">
                      {healthInfo?.database?.records?.teams?.toLocaleString() ?? teamsList.length.toLocaleString()}
                    </strong>
                  </div>
                  <div className="p-2 bg-slate-900/60 rounded-lg">
                    <span className="block text-slate-500 text-[10px]">Leagues</span>
                    <strong className="text-white text-sm">
                      {healthInfo?.database?.records?.competitions?.toLocaleString() ?? competitions.length.toLocaleString()}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Firebase Cloud Infrastructure */}
              <div className="p-3.5 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">Firebase Firestore &amp; Auth</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                    {isFirebaseReady ? 'Connected' : 'Provisioned'}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-center pt-1 font-mono text-slate-300">
                  <div className="p-2 bg-slate-900/60 rounded-lg text-left">
                    <span className="block text-slate-500 text-[10px]">Project ID</span>
                    <strong className="text-white text-xs truncate block">oceanic-matrix-v83d0</strong>
                  </div>
                  <div className="p-2 bg-slate-900/60 rounded-lg text-left">
                    <span className="block text-slate-500 text-[10px]">Session Status</span>
                    <strong className="text-emerald-400 text-xs truncate block font-sans">
                      {user ? `Active (${user.email?.split('@')[0]})` : 'Guest (Google OAuth Ready)'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Connected Providers (live status from /api/data-sources) */}
              <div className="space-y-2">
                <span className="font-semibold text-slate-400 block">External Data Providers</span>
                {dataSources.length === 0 ? (
                  <div className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 text-slate-400 text-[11px]">
                    Loading live provider connectivity status...
                  </div>
                ) : (
                  dataSources.map((ds) => {
                    const isOnline = ds.status === 'OPERATIONAL';
                    const isDegraded = ds.status === 'DEGRADED';
                    return (
                      <div
                        key={ds.id || ds.name}
                        className="p-2.5 bg-slate-950 rounded-xl border border-slate-800 flex items-center justify-between gap-2"
                      >
                        <div className="min-w-0">
                          <span className="font-semibold text-white block truncate">{ds.name}</span>
                          <span className="text-slate-500 text-[11px] block truncate">
                            {ds.message || ds.coverage}
                          </span>
                        </div>
                        <span
                          className={`text-xs font-semibold shrink-0 ${
                            isOnline
                              ? 'text-emerald-400'
                              : isDegraded || !ds.authenticated
                              ? 'text-amber-400'
                              : 'text-rose-400'
                          }`}
                        >
                          {isOnline
                            ? 'Operational'
                            : isDegraded
                            ? 'Degraded'
                            : ds.authenticated
                            ? 'Offline'
                            : 'Not Configured'}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>

              {syncNotice && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs font-medium flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{syncNotice}</span>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-800">
              <button
                onClick={handleTriggerSync}
                disabled={syncing}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs rounded-xl transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing...' : 'Sync Global Fixtures'}</span>
              </button>

              <button
                onClick={() => setIsFeedsModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bet Slip Slide-Over Drawer */}
      <BetSlipDrawer
        isOpen={isBetSlipOpen}
        onClose={() => setIsBetSlipOpen(false)}
        onNotify={(msg) => setAppNotice(msg)}
      />
    </div>
  );
}
