import React, { useState, useEffect, useMemo } from 'react';
import {
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sparkles,
  Search,
  Globe,
  Lock,
  ChevronRight,
  Shield,
  Layers,
  ArrowRight,
  Filter,
  Activity,
  History,
  TrendingUp,
  Sliders,
  Play,
  Check,
} from 'lucide-react';
import { UpcomingMatchItem, UpcomingDashboardResponse, PredictionQueueStatus } from '../data/upcoming/upcomingEngine.ts';
import { EnsembleProbabilityTrendChart } from './EnsembleProbabilityTrendChart.tsx';
import { MatchProbabilityTrend } from '../data/upcoming/trendEngine.ts';
import { MatchTacticalDossierModal } from './MatchTacticalDossierModal.tsx';
import { PortfolioStore } from '../data/portfolio/portfolioStore.ts';

interface UpcomingPredictionQueueProps {
  onInspectMatch: (match: any) => void;
}

export function UpcomingPredictionQueue({ onInspectMatch }: UpcomingPredictionQueueProps) {
  const [dashboardData, setDashboardData] = useState<UpcomingDashboardResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [activeWindow, setActiveWindow] = useState<'ALL' | 'TODAY' | '1H' | '2H' | '3H' | '4H' | '5H' | 'TOMORROW'>('ALL');
  const [queueStatusFilter, setQueueStatusFilter] = useState<'ALL' | 'READY' | 'PENDING' | 'NOT_YET_GENERATED'>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedComp, setSelectedComp] = useState<string>('ALL');
  const [selectedTimezone, setSelectedTimezone] = useState<string>('local');
  const [actionNotice, setActionNotice] = useState<string>('');
  const [processingMatchId, setProcessingMatchId] = useState<number | null>(null);

  // Tactical Dossier Modal state
  const [tacticalDossierMatch, setTacticalDossierMatch] = useState<UpcomingMatchItem | null>(null);

  // Version History Modal state
  const [versionModalMatch, setVersionModalMatch] = useState<UpcomingMatchItem | null>(null);
  const [matchVersionsList, setMatchVersionsList] = useState<any[]>([]);
  const [modalTrendData, setModalTrendData] = useState<MatchProbabilityTrend | null>(null);
  const [loadingVersions, setLoadingVersions] = useState<boolean>(false);

  // Quick Request Prediction Box state
  const [onDemandSearch, setOnDemandSearch] = useState<string>('');
  const [selectedFixtureForPredict, setSelectedFixtureForPredict] = useState<number | null>(null);

  const fetchUpcomingData = async (hours?: number) => {
    try {
      const url = hours ? `/api/upcoming?hours=${hours}` : '/api/upcoming';
      const res = await fetch(url);
      const data: UpcomingDashboardResponse = await res.json();
      setDashboardData(data);
    } catch (err) {
      console.error('Failed to load upcoming matches data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUpcomingData();
    // Auto-refresh every 30 seconds for upcoming countdown accuracy
    const timer = setInterval(() => {
      fetchUpcomingData();
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  const handleManualRefresh = () => {
    setRefreshing(true);
    let hours: number | undefined;
    if (activeWindow === '1H') hours = 1;
    else if (activeWindow === '2H') hours = 2;
    else if (activeWindow === '3H') hours = 3;
    else if (activeWindow === '4H') hours = 4;
    else if (activeWindow === '5H') hours = 5;
    fetchUpcomingData(hours);
  };

  const handleSelectWindow = (window: 'ALL' | 'TODAY' | '1H' | '2H' | '3H' | '4H' | '5H' | 'TOMORROW') => {
    setActiveWindow(window);
    setLoading(true);
    let hours: number | undefined;
    if (window === '1H') hours = 1;
    else if (window === '2H') hours = 2;
    else if (window === '3H') hours = 3;
    else if (window === '4H') hours = 4;
    else if (window === '5H') hours = 5;
    fetchUpcomingData(hours);
  };

  // Generate on-demand prediction for a pending or not generated match
  const handleGeneratePrediction = async (matchId: number) => {
    try {
      setProcessingMatchId(matchId);
      setActionNotice('Running prediction engine (Dixon-Coles + Poisson + Dynamic Elo + Monte Carlo)...');
      const res = await fetch('/api/upcoming/predict-fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fixtureId: matchId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Prediction failed');

      setActionNotice(`Prediction calibrated successfully for match #${matchId}! Promoted to READY.`);
      await fetchUpcomingData();
    } catch (err: any) {
      console.error('Prediction trigger error:', err);
      setActionNotice(`Prediction error: ${err.message}`);
    } finally {
      setProcessingMatchId(null);
      setTimeout(() => setActionNotice(''), 6000);
    }
  };

  // Refresh existing prediction (creates v2, v3 without overwriting)
  const handleRefreshPrediction = async (matchId: number) => {
    try {
      setProcessingMatchId(matchId);
      setActionNotice('Generating refreshed prediction version with latest pre-match evidence...');
      const res = await fetch(`/api/upcoming/predictions/${matchId}/refresh`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Refresh failed');

      setActionNotice(`Prediction refreshed! New version created while preserving prior versions.`);
      await fetchUpcomingData();
    } catch (err: any) {
      console.error('Refresh error:', err);
      setActionNotice(`Refresh error: ${err.message}`);
    } finally {
      setProcessingMatchId(null);
      setTimeout(() => setActionNotice(''), 6000);
    }
  };

  // Open Version History Modal
  const handleViewVersions = async (match: UpcomingMatchItem) => {
    try {
      setVersionModalMatch(match);
      setModalTrendData(null);
      setLoadingVersions(true);
      const [versionsRes, trendRes] = await Promise.all([
        fetch(`/api/upcoming/predictions/${match.id}`).then((r) => r.json()),
        fetch(`/api/upcoming/predictions/${match.id}/trend`).then((r) => r.json()).catch(() => null),
      ]);
      setMatchVersionsList(versionsRes.versions || []);
      if (trendRes && !trendRes.error) {
        setModalTrendData(trendRes);
      }
    } catch (err) {
      console.error('Failed to load versions and trend:', err);
    } finally {
      setLoadingVersions(false);
    }
  };

  // Format kickoff time in user's selected timezone
  const formatKickoff = (isoString: string) => {
    try {
      const date = new Date(isoString);
      const timeOptions: Intl.DateTimeFormatOptions = {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      };
      const dateOptions: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
      };

      if (selectedTimezone === 'local') {
        const timeStr = date.toLocaleTimeString([], timeOptions);
        const dateStr = date.toLocaleDateString([], dateOptions);
        return `${timeStr} · ${dateStr}`;
      }

      timeOptions.timeZone = selectedTimezone;
      dateOptions.timeZone = selectedTimezone;
      const timeStr = date.toLocaleTimeString([], timeOptions);
      const dateStr = date.toLocaleDateString([], dateOptions);
      return `${timeStr} (${dateStr})`;
    } catch {
      return new Date(isoString).toLocaleString();
    }
  };

  // Filtered upcoming matches
  const filteredMatches = useMemo(() => {
    if (!dashboardData) return [];
    let list = dashboardData.matches;

    // Time window filter
    if (activeWindow === 'TODAY') {
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setUTCHours(23, 59, 59, 999);
      list = list.filter((m) => new Date(m.kickoffTime) <= endOfToday && new Date(m.kickoffTime) >= now);
    } else if (activeWindow === 'TOMORROW') {
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setUTCHours(23, 59, 59, 999);
      list = list.filter((m) => new Date(m.kickoffTime) > endOfToday);
    }

    // Queue status filter
    if (queueStatusFilter !== 'ALL') {
      list = list.filter((m) => m.queueStatus === queueStatusFilter);
    }

    // Competition filter
    if (selectedComp !== 'ALL') {
      list = list.filter((m) => m.competitionCode.toUpperCase() === selectedComp.toUpperCase());
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (m) =>
          m.homeTeam.toLowerCase().includes(q) ||
          m.awayTeam.toLowerCase().includes(q) ||
          m.competitionName.toLowerCase().includes(q)
      );
    }

    return list;
  }, [dashboardData, activeWindow, queueStatusFilter, selectedComp, searchQuery]);

  // Matches available for on-demand search selector
  const availableUpcomingForSearch = useMemo(() => {
    if (!dashboardData) return [];
    if (!onDemandSearch.trim()) return dashboardData.matches;
    const q = onDemandSearch.toLowerCase();
    return dashboardData.matches.filter(
      (m) =>
        m.homeTeam.toLowerCase().includes(q) ||
        m.awayTeam.toLowerCase().includes(q) ||
        `${m.homeTeam} vs ${m.awayTeam}`.toLowerCase().includes(q) ||
        m.competitionName.toLowerCase().includes(q)
    );
  }, [dashboardData, onDemandSearch]);

  const compsList = useMemo(() => {
    if (!dashboardData) return [];
    const set = new Set<string>();
    dashboardData.matches.forEach((m) => set.add(m.competitionCode));
    return Array.from(set);
  }, [dashboardData]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Controls */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-base tracking-tight text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-emerald-400" />
              Upcoming Discovery &amp; Prediction Queue
            </h2>
            <span className="text-xs font-mono text-emerald-400">
              football-data.org v4 feed
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Dynamic kickoff discovery <span aria-hidden="true">·</span> Automatic 2-hour window calibration <span aria-hidden="true">·</span> Pre-match kickoff lock
          </p>
        </div>

        {/* Timezone Selector & Refresh */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            <Globe className="w-3.5 h-3.5 text-slate-500" />
            <span className="text-xs font-medium text-slate-400">Timezone:</span>
            <select
              value={selectedTimezone}
              onChange={(e) => setSelectedTimezone(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 font-mono"
            >
              <option value="local">Local Browser</option>
              <option value="UTC">UTC (Universal)</option>
              <option value="Europe/London">London (GMT / BST)</option>
              <option value="Europe/Madrid">Madrid / Paris (CET)</option>
              <option value="America/New_York">New York (EDT / EST)</option>
              <option value="Africa/Cairo">Cairo (EEST)</option>
              <option value="Asia/Tokyo">Tokyo (JST)</option>
            </select>
          </div>

          <button
            onClick={handleManualRefresh}
            disabled={refreshing}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700/80 text-white transition-colors flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
            Refresh Queue
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs font-medium flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          {actionNotice}
        </div>
      )}

      {/* SECTION: PREDICTION QUEUE METRICS STRIP */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div
          onClick={() => setQueueStatusFilter('ALL')}
          className={`p-4 rounded-xl border cursor-pointer transition-colors ${
            queueStatusFilter === 'ALL'
              ? 'bg-slate-900 border-emerald-500/80 shadow-md'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-medium">Total in Queue</span>
            <Layers className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            {dashboardData?.queueSummary.total ?? 0}
          </div>
          <span className="text-[11px] text-slate-500">Upcoming Fixtures</span>
        </div>

        <div
          onClick={() => setQueueStatusFilter('READY')}
          className={`p-4 rounded-xl border cursor-pointer transition-colors ${
            queueStatusFilter === 'READY'
              ? 'bg-emerald-950/40 border-emerald-500/90 shadow-md'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-emerald-400 mb-1">
            <span className="font-medium">Ready</span>
            <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
            {dashboardData?.queueSummary.ready ?? 0}
          </div>
          <span className="text-[11px] text-slate-500">Prediction Calibrated</span>
        </div>

        <div
          onClick={() => setQueueStatusFilter('PENDING')}
          className={`p-4 rounded-xl border cursor-pointer transition-colors ${
            queueStatusFilter === 'PENDING'
              ? 'bg-amber-950/40 border-amber-500/90 shadow-md'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-amber-400 mb-1">
            <span className="font-medium">Pending</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 font-mono tabular-nums">
            {dashboardData?.queueSummary.pending ?? 0}
          </div>
          <span className="text-[11px] text-slate-500">In 5-Hour Active Horizon</span>
        </div>

        <div
          onClick={() => setQueueStatusFilter('NOT_YET_GENERATED')}
          className={`p-4 rounded-2xl border cursor-pointer transition-all ${
            queueStatusFilter === 'NOT_YET_GENERATED'
              ? 'bg-slate-800 border-slate-600 shadow-lg'
              : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
          }`}
        >
          <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
            <span className="font-semibold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-slate-500" />
              Not Yet Generated
            </span>
            <Lock className="w-3.5 h-3.5 text-slate-500" />
          </div>
          <div className="text-2xl font-black text-slate-300 font-mono">
            {dashboardData?.queueSummary.notYetGenerated ?? 0}
          </div>
          <span className="text-[11px] text-slate-500">Later Kickoffs / Tomorrow</span>
        </div>
      </div>

      {/* SECTION: TIME-WINDOW HORIZON SELECTOR */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 sm:p-4 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            DYNAMIC KICKOFF TIME WINDOWS
          </span>
          <span className="text-slate-500 font-mono text-[11px]">
            Calculated dynamically from current system time
          </span>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
          <button
            onClick={() => handleSelectWindow('ALL')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === 'ALL'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            All Upcoming ({dashboardData?.windowsSummary.totalUpcoming ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('TODAY')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === 'TODAY'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Today ({dashboardData?.windowsSummary.today ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('1H')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === '1H'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Next 1 Hour ({dashboardData?.windowsSummary.next1Hour ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('2H')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === '2H'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Next 2 Hours ({dashboardData?.windowsSummary.next2Hours ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('3H')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === '3H'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Next 3 Hours ({dashboardData?.windowsSummary.next3Hours ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('4H')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === '4H'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Next 4 Hours ({dashboardData?.windowsSummary.next4Hours ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('5H')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === '5H'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Next 5 Hours ({dashboardData?.windowsSummary.next5Hours ?? 0})
          </button>
          <button
            onClick={() => handleSelectWindow('TOMORROW')}
            className={`px-3 py-1.5 rounded-xl font-medium transition-all whitespace-nowrap ${
              activeWindow === 'TOMORROW'
                ? 'bg-emerald-600 text-white shadow-md'
                : 'bg-slate-950 text-slate-400 hover:text-white border border-slate-800'
            }`}
          >
            Tomorrow ({dashboardData?.windowsSummary.tomorrow ?? 0})
          </button>
        </div>
      </div>

      {/* SECTION: ON-DEMAND REQUEST PREDICTION TOOL */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h4 className="text-sm font-bold text-white flex items-center gap-2">
              <Sliders className="w-4 h-4 text-emerald-400" />
              REQUEST ON-DEMAND PREDICTION
            </h4>
            <p className="text-xs text-slate-400">
              Search real fixtures (e.g. &ldquo;Arsenal vs Chelsea&rdquo;) or select any upcoming match to run instant calibration.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-500">API: POST /api/predict</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
          <div className="md:col-span-2 space-y-1">
            <label className="text-xs font-semibold text-slate-300">Search Fixture or Team Name</label>
            <div className="relative">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
              <input
                type="text"
                value={onDemandSearch}
                onChange={(e) => setOnDemandSearch(e.target.value)}
                placeholder="Search e.g. Arsenal vs Chelsea, Real Madrid, Bayern..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1">Select Discovered Fixture</label>
            <select
              value={selectedFixtureForPredict ?? ''}
              onChange={(e) => setSelectedFixtureForPredict(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500"
            >
              <option value="">-- Choose an upcoming fixture --</option>
              {availableUpcomingForSearch.map((fix) => (
                <option key={fix.id} value={fix.id}>
                  {fix.homeTeam} vs {fix.awayTeam} ({fix.competitionCode} · {fix.startsInFormatted})
                </option>
              ))}
            </select>
          </div>
        </div>

        {selectedFixtureForPredict && (
          <div className="pt-2 flex items-center justify-between">
            <span className="text-xs text-emerald-400 font-medium">
              Fixture #{selectedFixtureForPredict} selected for automated verification and calibration
            </span>
            <button
              onClick={() => handleGeneratePrediction(selectedFixtureForPredict)}
              disabled={processingMatchId === selectedFixtureForPredict}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 shadow-md shadow-emerald-950/40"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {processingMatchId === selectedFixtureForPredict ? 'Calculating Prediction...' : 'PREDICT MATCH NOW'}
            </button>
          </div>
        )}
      </div>

      {/* FILTER CONTROLS: SEARCH & COMPETITION */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter matches in list..."
              className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <select
            value={selectedComp}
            onChange={(e) => setSelectedComp(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-xl px-2.5 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-emerald-500"
          >
            <option value="ALL">All Competitions</option>
            {compsList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
          <span>Showing {filteredMatches.length} fixtures in queue</span>
        </div>
      </div>

      {/* SECTION: MATCH PREDICTION QUEUE CARDS */}
      {loading ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
          <p className="text-xs">Loading upcoming discovery queue &amp; synchronizing kickoff times...</p>
        </div>
      ) : filteredMatches.length === 0 ? (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400 space-y-3">
          <AlertCircle className="w-8 h-8 mx-auto text-slate-600" />
          <p className="text-sm font-semibold text-slate-300">No matches found in selected queue window.</p>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Try switching the time horizon tab or selecting &ldquo;All Upcoming&rdquo; above.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredMatches.map((match) => {
            const isProcessing = processingMatchId === match.id;
            const pred = match.prediction;

            return (
              <div
                key={match.id}
                className={`border rounded-2xl p-5 transition-all space-y-4 ${
                  match.queueStatus === 'READY'
                    ? 'bg-slate-900/95 border-slate-800 hover:border-emerald-500/40'
                    : match.queueStatus === 'PENDING'
                    ? 'bg-slate-900/90 border-slate-800/90 hover:border-amber-500/40'
                    : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Match Header Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-emerald-400 uppercase tracking-wide">
                      {match.competitionName}
                    </span>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs text-slate-400 font-mono">{match.round}</span>
                    <span className="text-slate-600">·</span>
                    <span className="text-xs text-slate-400">{match.venue}</span>
                  </div>

                  {/* Kickoff and Countdown */}
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <span className="text-xs font-mono font-bold text-slate-300 block">
                        Kickoff: {formatKickoff(match.kickoffTime)}
                      </span>
                      <span className="text-[11px] font-mono text-emerald-400 block">
                        Starts in: <strong className="text-white">{match.startsInFormatted}</strong>
                      </span>
                    </div>

                    {/* Queue Status Badge */}
                    <div>
                      {match.queueStatus === 'READY' ? (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5 shadow-sm shadow-emerald-950/20">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          Prediction Ready
                        </span>
                      ) : match.queueStatus === 'PENDING' ? (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
                          Prediction Pending
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1.5">
                          <Lock className="w-3.5 h-3.5 text-slate-500" />
                          Not Yet Generated
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Team Matchup & Prediction Display */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
                  {/* Teams info */}
                  <div className="lg:col-span-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-base sm:text-lg font-bold text-white tracking-tight">
                        {match.homeTeam}
                      </span>
                      <span className="text-xs font-mono text-slate-500">HOME</span>
                    </div>
                    <div className="text-xs text-slate-500 text-center font-mono font-bold py-0.5 bg-slate-950/60 rounded border border-slate-800/80">
                      VS
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-base sm:text-lg font-bold text-white tracking-tight">
                        {match.awayTeam}
                      </span>
                      <span className="text-xs font-mono text-slate-500">AWAY</span>
                    </div>
                  </div>

                  {/* Prediction Values or Pending Actions */}
                  <div className="lg:col-span-8">
                    {match.queueStatus === 'READY' && pred ? (
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 space-y-3">
                        {/* Probabilities Row */}
                        <div className="grid grid-cols-3 gap-2 text-center">
                          <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase font-mono">Home Win</span>
                            <span className="text-base font-black text-emerald-400 font-mono">
                              {(pred.probabilities.homeWin * 100).toFixed(1)}%
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Fair: {pred.fairOdds.home.toFixed(2)}
                            </span>
                          </div>

                          <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase font-mono">Draw</span>
                            <span className="text-base font-black text-amber-400 font-mono">
                              {(pred.probabilities.draw * 100).toFixed(1)}%
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Fair: {pred.fairOdds.draw.toFixed(2)}
                            </span>
                          </div>

                          <div className="bg-slate-900/80 p-2 rounded-lg border border-slate-800/80">
                            <span className="text-[10px] text-slate-400 block uppercase font-mono">Away Win</span>
                            <span className="text-base font-black text-cyan-400 font-mono">
                              {(pred.probabilities.awayWin * 100).toFixed(1)}%
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono block">
                              Fair: {pred.fairOdds.away.toFixed(2)}
                            </span>
                          </div>
                        </div>

                        {/* Extra intelligence details: Expected Goals, Likely Score, Confidence, Data Quality */}
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1 border-t border-slate-900 font-mono">
                          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
                            <span>
                              xG: <strong className="text-slate-200">{pred.expectedGoals.home.toFixed(2)} - {pred.expectedGoals.away.toFixed(2)}</strong> (Tot: {pred.expectedGoals.total.toFixed(2)})
                            </span>
                            <span>
                              Score: <strong className="text-emerald-400">{pred.mostLikelyScore}</strong>
                            </span>
                            <span>
                              Quality: <strong className="text-slate-200">{pred.dataQuality.rating} ({pred.dataQuality.score.toFixed(2)})</strong>
                            </span>
                            <span>
                              Conf: <strong className="text-slate-200">{pred.confidenceLevel}</strong>
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleViewVersions(match)}
                              className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-sans font-semibold flex items-center gap-1 transition-all"
                              title="View Ensemble Probability changes over time as data sources were ingested"
                            >
                              <TrendingUp className="w-3 h-3 text-emerald-400" />
                              {pred.totalVersionsCount > 1 ? `${pred.totalVersionsCount} Versions` : 'Probability Trend'}
                            </button>

                            <button
                              onClick={() => handleRefreshPrediction(match.id)}
                              disabled={isProcessing}
                              className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded font-sans font-semibold flex items-center gap-1 transition-all"
                              title="Refreshes with latest pre-match evidence, storing a new prediction version"
                            >
                              <RefreshCw className={`w-3 h-3 ${isProcessing ? 'animate-spin' : ''}`} />
                              Refresh (v{pred.totalVersionsCount + 1})
                            </button>

                            <button
                              onClick={() => setTacticalDossierMatch(match)}
                              className="px-2.5 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 rounded font-sans font-semibold flex items-center gap-1 transition-all cursor-pointer"
                              title="Inspect tactical form, 15-minute goal timing & simulate lineup absence impacts"
                            >
                              <Sliders className="w-3 h-3" />
                              Tactical &amp; Lineups
                            </button>

                            <button
                              onClick={() =>
                                onInspectMatch({
                                  id: match.id,
                                  homeTeam: match.homeTeam,
                                  awayTeam: match.awayTeam,
                                  competitionName: match.competitionName,
                                  competitionCode: match.competitionCode,
                                  kickoffTime: match.kickoffTime,
                                  venue: match.venue,
                                })
                              }
                              className="px-3 py-1 text-[11px] bg-emerald-600 hover:bg-emerald-500 text-white rounded font-sans font-bold flex items-center gap-1 transition-all shadow-sm cursor-pointer"
                            >
                              <Sparkles className="w-3 h-3" />
                              Prediction Dossier
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : match.queueStatus === 'PENDING' ? (
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="space-y-0.5 text-center sm:text-left">
                          <div className="flex items-center gap-1.5 text-amber-400 font-semibold text-xs">
                            <Clock className="w-3.5 h-3.5" />
                            Kickoff within active 5-hour prediction window
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Automatic prediction will finalize prior to kickoff, or generate on-demand right now.
                          </p>
                        </div>

                        <button
                          onClick={() => handleGeneratePrediction(match.id)}
                          disabled={isProcessing}
                          className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                          {isProcessing ? 'Running Ensemble Engine...' : '⚡ Generate Prediction Now'}
                        </button>
                      </div>
                    ) : (
                      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
                        <div className="space-y-0.5 text-center sm:text-left">
                          <div className="flex items-center gap-1.5 text-slate-400 font-semibold text-xs">
                            <Lock className="w-3.5 h-3.5 text-slate-500" />
                            Kickoff &gt; 5 hours away ({match.startsInFormatted})
                          </div>
                          <p className="text-[11px] text-slate-500">
                            Awaiting confirmed starting rosters before automated lock, or request early prediction.
                          </p>
                        </div>

                        <button
                          onClick={() => handleGeneratePrediction(match.id)}
                          disabled={isProcessing}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs rounded-xl border border-slate-700 transition-all flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${isProcessing ? 'animate-spin' : ''}`} />
                          {isProcessing ? 'Calculating...' : 'Request Early Prediction'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VERSION HISTORY & PROBABILITY TREND MODAL */}
      {versionModalMatch && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-4xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-base text-white flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-emerald-400" />
                  Prediction Version Ledger &amp; Ensemble Probability Trend
                </h3>
                <p className="text-xs text-slate-400">
                  {versionModalMatch.homeTeam} vs {versionModalMatch.awayTeam} · Preserved without overwriting
                </p>
              </div>
              <button
                onClick={() => setVersionModalMatch(null)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Visual Trend Chart */}
            {modalTrendData ? (
              <EnsembleProbabilityTrendChart
                matchId={versionModalMatch.id}
                trendData={modalTrendData}
                onRefreshTrend={async () => {
                  const res = await fetch(`/api/upcoming/predictions/${versionModalMatch.id}/trend`);
                  const data = await res.json();
                  if (data && !data.error) setModalTrendData(data);
                }}
              />
            ) : loadingVersions ? (
              <div className="py-8 text-center text-slate-400 font-mono text-xs flex items-center justify-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
                Calculating chronological probability trend from ingested sources...
              </div>
            ) : null}

            {loadingVersions ? (
              <div className="py-4 text-center text-slate-400">Loading version audit history...</div>
            ) : matchVersionsList.length === 0 ? (
              <div className="py-8 text-center text-slate-400">No previous versions found.</div>
            ) : (
              <div className="space-y-3">
                {matchVersionsList.map((ver, idx) => (
                  <div
                    key={ver.id || idx}
                    className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 font-mono font-bold rounded">
                          Version {ver.versionIndex || matchVersionsList.length - idx}
                        </span>
                        <span className="text-slate-400 font-mono text-[11px]">{ver.modelVersion}</span>
                      </div>
                      <span className="text-slate-500 font-mono text-[11px]">
                        Timestamp: {new Date(ver.predictionTimestamp).toLocaleString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center font-mono py-1">
                      <div className="bg-slate-900 p-2 rounded">
                        <span className="text-slate-400 text-[10px] block">Home Win</span>
                        <span className="text-emerald-400 font-bold">
                          {(ver.probabilities.homeWin * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded">
                        <span className="text-slate-400 text-[10px] block">Draw</span>
                        <span className="text-amber-400 font-bold">
                          {(ver.probabilities.draw * 100).toFixed(1)}%
                        </span>
                      </div>
                      <div className="bg-slate-900 p-2 rounded">
                        <span className="text-slate-400 text-[10px] block">Away Win</span>
                        <span className="text-cyan-400 font-bold">
                          {(ver.probabilities.awayWin * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                      <span>
                        xG: {ver.expectedGoals.home.toFixed(2)} - {ver.expectedGoals.away.toFixed(2)}
                      </span>
                      <span>Most Likely Score: {ver.mostLikelyScore}</span>
                      <span>Confidence: {(ver.confidenceScore * 100).toFixed(0)}%</span>
                      <span className="text-emerald-400">Immutable Snapshot Sealed</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setVersionModalMatch(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold"
              >
                Close Ledger
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tactical Dossier & Lineup Handicap Modal */}
      {tacticalDossierMatch && (
        <MatchTacticalDossierModal
          match={tacticalDossierMatch}
          onClose={() => setTacticalDossierMatch(null)}
          onAddedToSlip={(msg) => setActionNotice(msg)}
        />
      )}
    </div>
  );
}
