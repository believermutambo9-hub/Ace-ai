import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Percent,
  Filter,
  Download,
  Printer,
  PlusCircle,
  Shield,
  Layers,
  ArrowUpRight,
  Sliders,
  Sparkles,
  Info,
  Calendar,
  Clock,
  Check,
} from 'lucide-react';
import { UpcomingMatchItem, UpcomingDashboardResponse } from '../data/upcoming/upcomingEngine.ts';
import { scanValueBetsFromMatches, MarketOpportunity } from '../data/valueBets/valueBetEngine.ts';
import { PortfolioStore } from '../data/portfolio/portfolioStore.ts';
import { MatchTacticalDossierModal } from './MatchTacticalDossierModal.tsx';
import { SyndicateExportModal } from './SyndicateExportModal.tsx';

interface ValueBetScannerProps {
  onNotify?: (msg: string) => void;
}

export const ValueBetScanner: React.FC<ValueBetScannerProps> = ({ onNotify }) => {
  const [matches, setMatches] = useState<UpcomingMatchItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [minEdge, setMinEdge] = useState<number>(3.0);
  const [marketFilter, setMarketFilter] = useState<string>('ALL');
  const [minOdds, setMinOdds] = useState<number>(1.2);
  const [kellyMode, setKellyMode] = useState<'QUARTER' | 'HALF' | 'FULL'>('HALF');
  const [bankroll, setBankroll] = useState<number>(1000);
  const [selectedMatchForDossier, setSelectedMatchForDossier] = useState<UpcomingMatchItem | null>(null);
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());

  // Load matches
  useEffect(() => {
    const fetchMatches = async () => {
      try {
        const res = await fetch('/api/upcoming');
        const data: UpcomingDashboardResponse = await res.json();
        setMatches(data.matches || []);
      } catch (e) {
        console.error('Failed to load upcoming fixtures for scanner', e);
      } finally {
        setLoading(false);
      }
    };
    fetchMatches();

    const unsub = PortfolioStore.subscribe((state) => {
      setBankroll(state.bankroll);
    });
    setBankroll(PortfolioStore.getState().bankroll);
    return () => unsub();
  }, []);

  // Compute all value bets
  const rawOpportunities = useMemo(() => {
    return scanValueBetsFromMatches(matches);
  }, [matches]);

  // Filter opportunities
  const filteredOpportunities = useMemo(() => {
    return rawOpportunities.filter((opp) => {
      if (opp.edgePercent < minEdge) return false;
      if (opp.bookmakerOdds < minOdds) return false;
      if (marketFilter !== 'ALL' && opp.marketType !== marketFilter) return false;
      return true;
    });
  }, [rawOpportunities, minEdge, minOdds, marketFilter]);

  // Summary Metrics
  const avgEdge = useMemo(() => {
    if (filteredOpportunities.length === 0) return 0;
    const sum = filteredOpportunities.reduce((acc, o) => acc + o.edgePercent, 0);
    return Math.round((sum / filteredOpportunities.length) * 10) / 10;
  }, [filteredOpportunities]);

  const topEdge = filteredOpportunities[0];

  const handleAddToSlip = (opp: MarketOpportunity) => {
    const kellyPct =
      kellyMode === 'QUARTER'
        ? opp.quarterKellyPercent
        : kellyMode === 'HALF'
        ? opp.halfKellyPercent
        : opp.kellyStakeFraction * 100;

    const added = PortfolioStore.addToSlip({
      matchId: opp.matchId,
      homeTeam: opp.homeTeam,
      awayTeam: opp.awayTeam,
      competition: opp.competition,
      kickoffTime: opp.kickoffTime,
      marketType: opp.marketType,
      selection: opp.selection,
      selectionLabel: opp.selectionLabel,
      modelProbability: opp.modelProbability,
      bookmakerOdds: opp.bookmakerOdds,
      edgePercent: opp.edgePercent,
      recommendedKellyPercent: kellyPct,
    });

    if (added) {
      setAddedIds((prev) => new Set([...prev, opp.id]));
      if (onNotify) onNotify(`Added ${opp.selectionLabel} (+${opp.edgePercent}% Edge) to Bet Slip`);
    }
  };

  const getKellyStakeDollars = (opp: MarketOpportunity): number => {
    const pct =
      kellyMode === 'QUARTER'
        ? opp.quarterKellyPercent
        : kellyMode === 'HALF'
        ? opp.halfKellyPercent
        : opp.kellyStakeFraction * 100;
    return Math.round(bankroll * (pct / 100) * 10) / 10;
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls Strip */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-semibold text-xs tracking-wider uppercase">
              Quantitative Edge Detector
            </span>
            <span className="text-slate-600 text-xs">·</span>
            <span className="text-slate-400 text-xs">Kelly Criterion Staking</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
            Market Edge & Value Bet Scanner
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Detects discrepancies where model win probability exceeds consensus market implied odds. Computes optimal bankroll stake via fractional Kelly Criterion.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700/80 text-xs font-semibold transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>Export Syndicate Brief</span>
          </button>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Edges Identified
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-emerald-400">
              {filteredOpportunities.length}
            </span>
            <span className="text-xs text-slate-500">opportunities</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Average Market Edge
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-white">
              +{avgEdge}%
            </span>
            <span className="text-xs text-emerald-400 font-medium">+EV expected</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Top Value Pick
          </span>
          <div className="flex items-baseline gap-2 mt-1 truncate">
            {topEdge ? (
              <span className="text-base font-bold font-mono text-emerald-400 truncate">
                +{topEdge.edgePercent}% ({topEdge.selection})
              </span>
            ) : (
              <span className="text-xs text-slate-500">Scanning...</span>
            )}
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Active Bankroll
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-sky-400">
              ${bankroll.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">portfolio</span>
          </div>
        </div>
      </div>

      {/* Filter & Kelly Sizing Bar */}
      <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Min Edge Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">Min Edge:</span>
            <select
              value={minEdge}
              onChange={(e) => setMinEdge(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-white font-mono cursor-pointer"
            >
              <option value={0}>Any (+0%)</option>
              <option value={3}>+3% Edge</option>
              <option value={5}>+5% Edge</option>
              <option value={8}>+8% Edge</option>
              <option value={12}>+12% Edge</option>
            </select>
          </div>

          {/* Market Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">Market:</span>
            <select
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-white cursor-pointer"
            >
              <option value="ALL">All Markets</option>
              <option value="1X2">Match Outcome (1X2)</option>
              <option value="TOTAL_GOALS_2_5">Over / Under 2.5</option>
              <option value="BTTS">Both Teams to Score</option>
              <option value="DOUBLE_CHANCE">Double Chance</option>
            </select>
          </div>

          {/* Min Odds Filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 font-medium">Min Odds:</span>
            <select
              value={minOdds}
              onChange={(e) => setMinOdds(Number(e.target.value))}
              className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-white font-mono cursor-pointer"
            >
              <option value={1.2}>1.20+</option>
              <option value={1.5}>1.50+</option>
              <option value={1.8}>1.80+</option>
              <option value={2.0}>2.00+</option>
            </select>
          </div>
        </div>

        {/* Kelly Mode Segmented Switch */}
        <div className="flex items-center gap-2">
          <span className="text-slate-400 font-medium">Kelly Sizing:</span>
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
            <button
              onClick={() => setKellyMode('QUARTER')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                kellyMode === 'QUARTER'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Quarter Kelly (Conservative)"
            >
              Quarter (f/4)
            </button>
            <button
              onClick={() => setKellyMode('HALF')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                kellyMode === 'HALF'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Half Kelly (Recommended balanced risk)"
            >
              Half (f/2)
            </button>
            <button
              onClick={() => setKellyMode('FULL')}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition cursor-pointer ${
                kellyMode === 'FULL'
                  ? 'bg-slate-800 text-emerald-400'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Full Kelly (Aggressive)"
            >
              Full (f*)
            </button>
          </div>
        </div>
      </div>

      {/* Opportunities List */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          Scanning live data feeds and mathematical probability models...
        </div>
      ) : filteredOpportunities.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Shield className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-white">No Edges Found Above Current Threshold</h3>
          <p className="text-xs text-slate-400 mt-1">
            Try adjusting your Minimum Edge or Market filters above to view broader opportunities.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filteredOpportunities.map((opp) => {
            const isAdded = addedIds.has(opp.id);
            const stakeDollars = getKellyStakeDollars(opp);
            const parentMatch = matches.find((m) => m.id === opp.matchId);

            return (
              <div
                key={opp.id}
                className="bg-slate-900/80 border border-slate-800 hover:border-slate-700/80 rounded-xl p-4 space-y-3 transition flex flex-col justify-between"
              >
                <div>
                  {/* Top League & Matchup */}
                  <div className="flex items-center justify-between text-xs text-slate-400 pb-2 border-b border-slate-800/60">
                    <span className="font-semibold text-emerald-400 truncate max-w-[160px]">
                      {opp.competition}
                    </span>
                    <span className="font-mono text-[11px] text-slate-500">
                      {new Date(opp.kickoffTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>

                  <h3 className="text-sm font-bold text-white mt-2 truncate">
                    {opp.homeTeam} vs {opp.awayTeam}
                  </h3>

                  {/* Pick & Edge Badge */}
                  <div className="mt-2.5 p-2.5 rounded-lg bg-slate-950/80 border border-slate-800/80 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                        Market Selection
                      </span>
                      <span className="text-xs font-semibold text-slate-200">
                        {opp.selectionLabel}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-500 uppercase tracking-wider block">
                        Market Edge
                      </span>
                      <span className="text-xs font-bold font-mono text-emerald-400">
                        +{opp.edgePercent}%
                      </span>
                    </div>
                  </div>

                  {/* Probabilities Comparison */}
                  <div className="grid grid-cols-2 gap-2 mt-2.5 text-xs">
                    <div className="bg-slate-950/40 p-2 rounded border border-slate-800/40">
                      <span className="text-[10px] text-slate-500 block">Model Fair Odds</span>
                      <span className="font-mono font-semibold text-white">
                        {opp.modelFairOdds.toFixed(2)} ({Math.round(opp.modelProbability * 100)}%)
                      </span>
                    </div>
                    <div className="bg-slate-950/40 p-2 rounded border border-slate-800/40">
                      <span className="text-[10px] text-slate-500 block">Bookmaker Odds</span>
                      <span className="font-mono font-semibold text-emerald-400">
                        {opp.bookmakerOdds.toFixed(2)} ({Math.round(opp.impliedMarketProb * 100)}%)
                      </span>
                    </div>
                  </div>

                  {/* Kelly Recommendation */}
                  <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400 bg-emerald-950/20 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                    <span>
                      Kelly Stake (
                      {kellyMode === 'QUARTER'
                        ? opp.quarterKellyPercent
                        : kellyMode === 'HALF'
                        ? opp.halfKellyPercent
                        : opp.kellyStakeFraction * 100}
                      %):
                    </span>
                    <span className="font-mono font-bold text-emerald-300">
                      ${stakeDollars.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60 mt-3">
                  <button
                    onClick={() => handleAddToSlip(opp)}
                    disabled={isAdded}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      isAdded
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                    }`}
                  >
                    {isAdded ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>In Slip</span>
                      </>
                    ) : (
                      <>
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span>Add to Slip</span>
                      </>
                    )}
                  </button>

                  {parentMatch && (
                    <button
                      onClick={() => setSelectedMatchForDossier(parentMatch)}
                      className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition cursor-pointer"
                      title="Inspect Tactical Dossier & Absence Impact"
                    >
                      Dossier
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Match Tactical Dossier Modal */}
      {selectedMatchForDossier && (
        <MatchTacticalDossierModal
          match={selectedMatchForDossier}
          onClose={() => setSelectedMatchForDossier(null)}
          onAddedToSlip={(msg) => onNotify && onNotify(msg)}
        />
      )}

      {/* Syndicate Export Modal */}
      {showExportModal && (
        <SyndicateExportModal
          opportunities={filteredOpportunities}
          matches={matches}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
};
