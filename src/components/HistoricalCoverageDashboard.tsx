import React, { useState, useEffect } from 'react';
import {
  Database,
  Globe,
  Layers,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  RotateCcw,
  RefreshCw,
  Search,
  Filter,
  ShieldCheck,
  Activity,
  HardDrive,
  FileSpreadsheet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface CoverageSummary {
  totalMatches: number;
  completedMatches: number;
  upcomingMatches: number;
  countriesCount: number;
  competitionsCount: number;
  seasonsCount: number;
  earliestMatchDate: string | null;
  latestMatchDate: string | null;
  scoresAvailableCount: number;
  detailedStatsCount: number;
  xgAvailableCount: number;
  oddsAvailableCount: number;
  lineupsAvailableCount: number;
  scoresPercentage: number;
  detailedStatsPercentage: number;
  xgPercentage: number;
  oddsPercentage: number;
  providersBreakdown: Array<{
    providerSource: string;
    matchesCount: number;
    competitionsCount: number;
    earliest: string | null;
    latest: string | null;
  }>;
  competitionsBreakdown: Array<{
    competitionCode: string;
    competitionName: string;
    country: string;
    matchesCount: number;
    earliest: string | null;
    latest: string | null;
  }>;
}

interface InventoryItem {
  id: number;
  providerSource: string;
  country: string;
  competitionCode: string;
  competitionName: string;
  competitionType: string;
  seasonCode: string;
  earliestMatchDate: string | null;
  latestMatchDate: string | null;
  matchesDiscovered: number;
  matchesImported: number;
  matchesMissing: number;
  hasScores: boolean;
  hasStats: boolean;
  hasXg: boolean;
  hasOdds: boolean;
  hasLineups: boolean;
  syncStatus: string;
  lastSyncAt: string | null;
}

interface BackfillJob {
  id: number;
  jobType: string;
  providerSource: string;
  competitionCode: string;
  seasonCode: string;
  status: string;
  totalDiscovered: number;
  processedCount: number;
  insertedCount: number;
  updatedCount: number;
  failedCount: number;
  checkpointData: any;
  startedAt: string | null;
  completedAt: string | null;
}

export const HistoricalCoverageDashboard: React.FC = () => {
  const { getIdToken } = useAuth();
  const [summary, setSummary] = useState<CoverageSummary | null>(null);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [jobs, setJobs] = useState<BackfillJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [providerFilter, setProviderFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [integrityAudit, setIntegrityAudit] = useState<any>(null);
  const [auditLoading, setAuditLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'inventory' | 'jobs' | 'integrity'>('inventory');

  // Backfill form state
  const [targetProvider, setTargetProvider] = useState<string>('open-football');
  const [targetComp, setTargetComp] = useState<string>('ALL');
  const [isDryRun, setIsDryRun] = useState<boolean>(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fetchCoverage = async () => {
    try {
      setRefreshing(true);
      const [sumData, invData, jobsData] = await Promise.all([
        ErrorReportingService.fetchJson<{ summary: CoverageSummary }>('/api/historical/coverage', undefined, {
          source: 'HistoricalCoverageDashboard.fetchCoverage',
          fallbackValue: null as any,
        }),
        ErrorReportingService.fetchJson<{ inventory: InventoryItem[] }>('/api/historical/inventory', undefined, {
          source: 'HistoricalCoverageDashboard.fetchCoverage',
          fallbackValue: null as any,
        }),
        ErrorReportingService.fetchJson<{ jobs: BackfillJob[] }>('/api/historical/backfill/jobs', undefined, {
          source: 'HistoricalCoverageDashboard.fetchCoverage',
          fallbackValue: null as any,
        }),
      ]);

      if (sumData?.summary) {
        setSummary(sumData.summary);
      }
      if (invData?.inventory) {
        setInventory(invData.inventory);
      }
      if (jobsData?.jobs) {
        setJobs(jobsData.jobs);
      }
    } catch (err) {
      console.error('Failed to load coverage telemetry:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchCoverage();
  }, []);

  const handleRunIntegrityAudit = async () => {
    setAuditLoading(true);
    try {
      const data = await ErrorReportingService.fetchJson<{ audit: any }>(
        '/api/historical/integrity',
        undefined,
        { source: 'HistoricalCoverageDashboard.handleRunIntegrityAudit' }
      );
      if (data?.audit) {
        setIntegrityAudit(data.audit);
      }
    } catch (err) {
      console.error('Integrity audit failed:', err);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleStartBackfill = async () => {
    try {
      const token = await getIdToken();
      if (!token) {
        setActionNotice('Admin authentication required: sign in with an authorized account to dispatch backfill jobs.');
        return;
      }
      const res = await ErrorReportingService.apiFetch(
        '/api/historical/backfill/start',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            providerSource: targetProvider,
            competitionCode: targetComp === 'ALL' ? undefined : targetComp,
            dryRun: isDryRun,
          }),
        },
        { source: 'HistoricalCoverageDashboard.handleStartBackfill' }
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setActionNotice(`Backfill job #${data.jobId} created and dispatched successfully.`);
        fetchCoverage();
      } else {
        setActionNotice(`Error (${res.status}): ${data?.error || 'Failed to dispatch backfill job'}`);
      }
    } catch (err: any) {
      setActionNotice(`Error: ${err?.message || 'Failed to dispatch job'}`);
    }
  };

  const handleJobAction = async (jobId: number, action: 'pause' | 'resume' | 'cancel') => {
    try {
      const token = await getIdToken();
      if (!token) {
        setActionNotice('Admin authentication required to manage backfill jobs.');
        return;
      }
      const res = await ErrorReportingService.apiFetch(
        `/api/historical/backfill/${jobId}/${action}`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
        { source: 'HistoricalCoverageDashboard.handleJobAction' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionNotice(`Error (${res.status}): ${data?.error || `Failed to ${action} job #${jobId}`}`);
        return;
      }
      setActionNotice(`Job #${jobId} ${action}d successfully.`);
      fetchCoverage();
    } catch (err: any) {
      setActionNotice(`Error: ${err?.message || `Failed to ${action} job`}`);
    }
  };

  const handlePauseJob = (jobId: number) => handleJobAction(jobId, 'pause');
  const handleResumeJob = (jobId: number) => handleJobAction(jobId, 'resume');
  const handleCancelJob = (jobId: number) => handleJobAction(jobId, 'cancel');

  const filteredInventory = inventory.filter((item) => {
    const matchesProvider = providerFilter === 'ALL' || item.providerSource === providerFilter;
    const matchesSearch =
      item.competitionName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.country.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.seasonCode.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesProvider && matchesSearch;
  });

  if (loading && !summary) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
          <p className="text-sm font-mono text-zinc-400">Loading Worldwide Historical Football Database...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 shadow-xl backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">Worldwide Historical Football Database</h2>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Authentic multi-season match records &amp; evidence across {summary ? summary.countriesCount : '—'} nations, leagues &amp; cups
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchCoverage}
            disabled={refreshing}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-zinc-300 bg-zinc-800 hover:bg-zinc-700/80 rounded-xl transition-colors border border-zinc-700/60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-400' : ''}`} />
            Refresh
          </button>
          <button
            onClick={() => {
              setActiveTab('integrity');
              handleRunIntegrityAudit();
            }}
            disabled={auditLoading}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-emerald-400 bg-emerald-950/40 hover:bg-emerald-900/50 rounded-xl transition-colors border border-emerald-500/30"
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Run Integrity Audit
          </button>
        </div>
      </div>

      {actionNotice && (
        <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/30 text-emerald-300 text-xs font-mono flex items-center justify-between">
          <span>{actionNotice}</span>
          <button onClick={() => setActionNotice(null)} className="text-zinc-400 hover:text-white ml-4">
            ×
          </button>
        </div>
      )}

      {/* Top Global Stat Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-xs font-medium">Genuine Matches</span>
              <Database className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">{summary.totalMatches.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Verified records in PostgreSQL</div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-xs font-medium">Completed</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="text-2xl font-bold text-emerald-400 font-mono">{summary.completedMatches.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Scores & outcomes verified</div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-xs font-medium">Upcoming Queue</span>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-cyan-400 font-mono">{summary.upcomingMatches.toLocaleString()}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Predictive fixtures scheduled</div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-xs font-medium">Competitions</span>
              <Layers className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">{summary.competitionsCount}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">{summary.seasonsCount} historical seasons</div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-xs font-medium">Countries</span>
              <Globe className="w-4 h-4 text-indigo-400" />
            </div>
            <div className="text-2xl font-bold text-white font-mono">{summary.countriesCount}</div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Europe, Americas & Global</div>
          </div>

          <div className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
            <div className="flex items-center justify-between text-zinc-400 mb-1">
              <span className="text-xs font-medium">Earliest Date</span>
              <Calendar className="w-4 h-4 text-violet-400" />
            </div>
            <div className="text-sm font-bold text-zinc-200 font-mono mt-1">
              {summary.earliestMatchDate ? new Date(summary.earliestMatchDate).toLocaleDateString('en-GB') : 'N/A'}
            </div>
            <div className="text-[10px] text-zinc-500 font-mono mt-1">Continuous historical depth</div>
          </div>
        </div>
      )}

      {/* Completeness & Provenance Breakdown */}
      {summary && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800">
            <h3 className="text-sm font-semibold text-white mb-3.5 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-emerald-400" />
              Verified Field-Level Completeness
            </h3>
            <div className="space-y-3 font-mono text-xs">
              <div>
                <div className="flex justify-between text-zinc-300 mb-1">
                  <span>Verified Full-Time Scores</span>
                  <span className="text-emerald-400 font-bold">
                    {summary.scoresAvailableCount.toLocaleString()} ({summary.scoresPercentage}%)
                  </span>
                </div>
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-2 rounded-full" style={{ width: `${summary.scoresPercentage}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-zinc-300 mb-1">
                  <span>Detailed In-Match Statistics</span>
                  <span className="text-cyan-400 font-bold">{summary.detailedStatsCount.toLocaleString()} matches</span>
                </div>
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-cyan-500 h-2 rounded-full" style={{ width: `${summary.detailedStatsPercentage}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-zinc-300 mb-1">
                  <span>Expected Goals (xG / npxG)</span>
                  <span className="text-indigo-400 font-bold">{summary.xgAvailableCount.toLocaleString()} matches</span>
                </div>
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-indigo-500 h-2 rounded-full" style={{ width: `${summary.xgPercentage}%` }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-zinc-300 mb-1">
                  <span>Historical Bookmaker Quotes</span>
                  <span className="text-amber-400 font-bold">{summary.oddsAvailableCount.toLocaleString()} matches</span>
                </div>
                <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-2 rounded-full" style={{ width: `${summary.oddsPercentage}%` }} />
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800">
            <h3 className="text-sm font-semibold text-white mb-3.5 flex items-center gap-2">
              <HardDrive className="w-4 h-4 text-cyan-400" />
              Source Provenance & Provider Distribution
            </h3>
            <div className="space-y-2.5">
              {summary.providersBreakdown.map((p) => (
                <div
                  key={p.providerSource}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-800/50 border border-zinc-700/40 text-xs font-mono"
                >
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span className="font-bold text-zinc-200">{p.providerSource}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-white font-bold">{p.matchesCount.toLocaleString()}</span>
                    <span className="text-zinc-400 text-[10px] ml-1.5">matches</span>
                    <span className="text-zinc-500 text-[10px] ml-2">({p.competitionsCount} comps)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'inventory'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Competition Coverage Inventory ({inventory.length})
        </button>
        <button
          onClick={() => setActiveTab('jobs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'jobs'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Resumable Backfill Jobs ({jobs.length})
        </button>
        <button
          onClick={() => {
            setActiveTab('integrity');
            if (!integrityAudit) handleRunIntegrityAudit();
          }}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-colors ${
            activeTab === 'integrity'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          Database Integrity & Audit
        </button>
      </div>

      {/* Tab 1: Coverage Inventory */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="w-4 h-4 absolute left-3 top-3 text-zinc-500" />
              <input
                type="text"
                placeholder="Search competition, country or season..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-emerald-500 font-mono"
              />
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Filter className="w-4 h-4 text-zinc-500" />
              <select
                value={providerFilter}
                onChange={(e) => setProviderFilter(e.target.value)}
                className="bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 font-mono focus:outline-none focus:border-emerald-500"
              >
                <option value="ALL">All Providers</option>
                <option value="open-football">OpenFootball Archive</option>
                <option value="football-data-org">Football-Data.org</option>
                <option value="api-football-v3">API-Football v3</option>
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-800/80 text-zinc-400 border-b border-zinc-700/60">
                <tr>
                  <th className="p-3">Competition</th>
                  <th className="p-3">Country</th>
                  <th className="p-3">Season</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3 text-right">Imported</th>
                  <th className="p-3 text-center">Scores</th>
                  <th className="p-3 text-center">Stats</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-300">
                {filteredInventory.map((item) => (
                  <tr key={`${item.providerSource}-${item.competitionCode}-${item.seasonCode}`} className="hover:bg-zinc-800/30">
                    <td className="p-3 font-bold text-white">
                      {item.competitionName} ({item.competitionCode})
                    </td>
                    <td className="p-3 text-zinc-400">{item.country}</td>
                    <td className="p-3 text-emerald-400 font-semibold">{item.seasonCode}</td>
                    <td className="p-3">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-300 border border-zinc-700">
                        {item.providerSource}
                      </span>
                    </td>
                    <td className="p-3 text-right font-bold text-white">{item.matchesImported}</td>
                    <td className="p-3 text-center">
                      {item.hasScores ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 inline" />
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      {item.hasStats ? (
                        <CheckCircle2 className="w-4 h-4 text-cyan-400 inline" />
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="p-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-950/60 text-emerald-300 border border-emerald-500/30">
                        {item.syncStatus}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 2: Resumable Backfill Jobs */}
      {activeTab === 'jobs' && (
        <div className="space-y-5">
          {/* Initiate New Backfill Job Card */}
          <div className="p-5 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Play className="w-4 h-4 text-emerald-400" />
              Launch Controlled Historical Backfill Task
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-mono text-zinc-400 block mb-1">Provider Source</label>
                <select
                  value={targetProvider}
                  onChange={(e) => setTargetProvider(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                >
                  <option value="open-football">OpenFootball Archive (High-speed multi-season)</option>
                  <option value="football-data-org">Football-Data.org (Live & Tier 1)</option>
                  <option value="api-football-v3">API-Football v3 (Americas & International)</option>
                  <option value="all">All Providers (Combined Catalog)</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] font-mono text-zinc-400 block mb-1">Target Competition</label>
                <select
                  value={targetComp}
                  onChange={(e) => setTargetComp(e.target.value)}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
                >
                  <option value="ALL">All Competitions in Catalog</option>
                  <option value="PL">Premier League (England)</option>
                  <option value="PD">La Liga (Spain)</option>
                  <option value="SA">Serie A (Italy)</option>
                  <option value="BL1">Bundesliga (Germany)</option>
                  <option value="FL1">Ligue 1 (France)</option>
                  <option value="DED">Eredivisie (Netherlands)</option>
                  <option value="PPL">Primeira Liga (Portugal)</option>
                  <option value="MLS">Major League Soccer (USA)</option>
                  <option value="BSA">Campeonato Brasileiro Série A (Brazil)</option>
                  <option value="ARG">Argentine Primera División (Argentina)</option>
                </select>
              </div>

              <div className="flex flex-col justify-end">
                <div className="flex items-center gap-3 mb-2">
                  <label className="flex items-center gap-2 text-xs text-zinc-300 font-mono cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isDryRun}
                      onChange={(e) => setIsDryRun(e.target.checked)}
                      className="rounded bg-zinc-800 border-zinc-700 text-emerald-500"
                    />
                    Dry Run Mode (Validate only)
                  </label>
                </div>
                <button
                  onClick={handleStartBackfill}
                  className="w-full px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  Dispatch Backfill Job
                </button>
              </div>
            </div>
          </div>

          {/* Existing Jobs Table */}
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-zinc-800/80 text-zinc-400 border-b border-zinc-700/60">
                <tr>
                  <th className="p-3">Job ID</th>
                  <th className="p-3">Type</th>
                  <th className="p-3">Provider</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Processed</th>
                  <th className="p-3 text-right">Inserted</th>
                  <th className="p-3 text-right">Updated</th>
                  <th className="p-3 text-center">Controls</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800 text-zinc-300">
                {jobs.map((j) => (
                  <tr key={j.id} className="hover:bg-zinc-800/30">
                    <td className="p-3 font-bold text-white">#{j.id}</td>
                    <td className="p-3 text-zinc-400">{j.jobType}</td>
                    <td className="p-3 text-zinc-300">{j.providerSource}</td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          j.status === 'COMPLETED'
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30'
                            : j.status === 'RUNNING'
                            ? 'bg-cyan-950 text-cyan-400 border border-cyan-500/30 animate-pulse'
                            : j.status === 'PAUSED'
                            ? 'bg-amber-950 text-amber-400 border border-amber-500/30'
                            : 'bg-zinc-800 text-zinc-400'
                        }`}
                      >
                        {j.status}
                      </span>
                    </td>
                    <td className="p-3 text-right font-mono">{j.processedCount}</td>
                    <td className="p-3 text-right font-mono text-emerald-400">{j.insertedCount}</td>
                    <td className="p-3 text-right font-mono text-cyan-400">{j.updatedCount}</td>
                    <td className="p-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {j.status === 'RUNNING' && (
                          <button
                            onClick={() => handlePauseJob(j.id)}
                            title="Pause Job"
                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-amber-400"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(j.status === 'PAUSED' || j.status === 'FAILED') && (
                          <button
                            onClick={() => handleResumeJob(j.id)}
                            title="Resume from Checkpoint"
                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-emerald-400"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(j.status === 'RUNNING' || j.status === 'PAUSED') && (
                          <button
                            onClick={() => handleCancelJob(j.id)}
                            title="Cancel Job"
                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-rose-400"
                          >
                            <AlertTriangle className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Database Integrity Audit */}
      {activeTab === 'integrity' && (
        <div className="p-6 rounded-2xl bg-zinc-900/90 border border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              Database Integrity Verification
            </h3>
            <button
              onClick={handleRunIntegrityAudit}
              disabled={auditLoading}
              className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs font-mono text-emerald-400 rounded-lg flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3 h-3 ${auditLoading ? 'animate-spin' : ''}`} />
              Re-run Audit
            </button>
          </div>

          {integrityAudit ? (
            <div className="space-y-4 font-mono text-xs">
              <div
                className={`p-4 rounded-xl border ${
                  integrityAudit.healthy
                    ? 'bg-emerald-950/40 border-emerald-500/30 text-emerald-300'
                    : 'bg-amber-950/40 border-amber-500/30 text-amber-300'
                }`}
              >
                <div className="font-bold mb-1">{integrityAudit.summary}</div>
                <div className="text-[11px] opacity-80">
                  Total matches checked: {integrityAudit.totalMatchesChecked.toLocaleString()}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60">
                  <div className="text-zinc-400 mb-1">Duplicate Candidates</div>
                  <div className="text-lg font-bold text-white">{integrityAudit.duplicateSuspects}</div>
                </div>

                <div className="p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60">
                  <div className="text-zinc-400 mb-1">Orphaned Statistics</div>
                  <div className="text-lg font-bold text-white">{integrityAudit.orphanedStatistics}</div>
                </div>

                <div className="p-3 rounded-xl bg-zinc-800/60 border border-zinc-700/60">
                  <div className="text-zinc-400 mb-1">Score Mismatches</div>
                  <div className="text-lg font-bold text-white">{integrityAudit.scoreMismatches}</div>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-xs text-zinc-500 font-mono">Running database integrity analysis...</div>
          )}
        </div>
      )}
    </div>
  );
};
