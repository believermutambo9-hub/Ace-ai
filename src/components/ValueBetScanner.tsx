import React, { useState, useEffect, useMemo } from 'react';
import {
  TrendingUp,
  Percent,
  Filter,
  Download,
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
  AlertCircle,
  BarChart2,
} from 'lucide-react';
import type { UpcomingMatchItem, UpcomingDashboardResponse } from '../types/football.ts';
import { scanValueBetsFromMatches, MarketOpportunity } from '../data/valueBets/valueBetEngine.ts';
import { PortfolioStore } from '../data/portfolio/portfolioStore.ts';
import { MatchTacticalDossierModal } from './MatchTacticalDossierModal.tsx';
import { SyndicateExportModal } from './SyndicateExportModal.tsx';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface ValueBetScannerProps {
  onNotify?: (msg: string) => void;
}

export const ValueBetScanner: React.FC<ValueBetScannerProps> = ({ onNotify }) => {
  const [matches, setMatches] = useState<UpcomingMatchItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<'VERIFIED_VALUE' | 'THEORETICAL_FAIR'>('THEORETICAL_FAIR');
  const [minEdge, setMinEdge] = useState<number>(2.0);
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
        const data = await ErrorReportingService.fetchJson<UpcomingDashboardResponse>(
          '/api/upcoming',
          undefined,
          { source: 'ValueBetScanner.fetchMatches' }
        );
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

  // Compute all opportunities with strict odds separation
  const allOpportunities = useMemo(() => {
    return scanValueBetsFromMatches(matches);
  }, [matches]);

  const verifiedMarketOpportunities = useMemo(() => {
    return allOpportunities.filter((opp) => {
      if (!opp.hasRealMarketOdds || opp.edgePercent === null || opp.bookmakerOdds === null) return false;
      if (opp.edgePercent < minEdge) return false;
      if (opp.bookmakerOdds < minOdds) return false;
      if (marketFilter !== 'ALL' && opp.marketType !== marketFilter) return false;
      return true;
    });
  }, [allOpportunities, minEdge, minOdds, marketFilter]);

  const theoreticalOpportunities = useMemo(() => {
    return allOpportunities.filter((opp) => {
      if (opp.modelFairOdds < minOdds) return false;
      if (marketFilter !== 'ALL' && opp.marketType !== marketFilter) return false;
      return true;
    });
  }, [allOpportunities, minOdds, marketFilter]);

  const displayedOpportunities = activeTab === 'VERIFIED_VALUE'
    ? verifiedMarketOpportunities
    : theoreticalOpportunities;

  // Automatically switch to verified if available
  useEffect(() => {
    if (verifiedMarketOpportunities.length > 0 && activeTab !== 'VERIFIED_VALUE') {
      setActiveTab('VERIFIED_VALUE');
    }
  }, [verifiedMarketOpportunities.length]);

  // Summary Metrics
  const avgEdge = useMemo(() => {
    if (verifiedMarketOpportunities.length === 0) return 0;
    const sum = verifiedMarketOpportunities.reduce((acc, o) => acc + (o.edgePercent || 0), 0);
    return Math.round((sum / verifiedMarketOpportunities.length) * 10) / 10;
  }, [verifiedMarketOpportunities]);

  const topEdge = verifiedMarketOpportunities[0];

  const handleAddToSlip = (opp: MarketOpportunity) => {
    const isReal = opp.hasRealMarketOdds && opp.bookmakerOdds !== null;
    const oddsToUse = isReal ? opp.bookmakerOdds! : opp.modelFairOdds;
    const edgeToUse = isReal && opp.edgePercent !== null ? opp.edgePercent : 0;

    const kellyPct = isReal
      ? kellyMode === 'QUARTER'
        ? opp.quarterKellyPercent || 0
        : kellyMode === 'HALF'
        ? opp.halfKellyPercent || 0
        : (opp.kellyStakeFraction || 0) * 100
      : 1.0; // conservative 1% default on unquoted paper trades

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
      bookmakerOdds: oddsToUse,
      edgePercent: edgeToUse,
      recommendedKellyPercent: kellyPct,
    });

    if (added) {
      setAddedIds((prev) => new Set([...prev, opp.id]));
      if (onNotify) {
        if (isReal) {
          onNotify(`Added ${opp.selectionLabel} (+${edgeToUse}% Edge) to Bet Slip`);
        } else {
          onNotify(`Added ${opp.selectionLabel} (Theoretical Fair Odds @ ${oddsToUse.toFixed(2)}) to Paper Slip`);
        }
      }
    }
  };

  const getKellyStakeDollars = (opp: MarketOpportunity): number | null => {
    if (!opp.hasRealMarketOdds) return null;
    const pct =
      kellyMode === 'QUARTER'
        ? opp.quarterKellyPercent || 0
        : kellyMode === 'HALF'
        ? opp.halfKellyPercent || 0
        : (opp.kellyStakeFraction || 0) * 100;
    return Math.round(bankroll * (pct / 100) * 10) / 10;
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls Strip */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-semibold text-xs tracking-wider uppercase">
              Quantitative Edge & Pricing Engine
            </span>
            <span className="text-slate-600 text-xs">·</span>
            <span className="text-slate-400 text-xs">Kelly Criterion Staking</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
            Market Edge & Value Bet Scanner
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Strictly separates verified market bookmaker odds from theoretical model fair prices (1/P).
            Zero simulated or fake bookmaker lines are generated.
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

      {/* Strict Pricing Integrity Banner */}
      <div className="bg-sky-950/30 border border-sky-800/40 rounded-xl p-3.5 flex items-start gap-3">
        <Info className="w-5 h-5 text-sky-400 shrink-0 mt-0.5" />
        <div className="text-xs text-slate-300 space-y-1">
          <p className="font-semibold text-sky-200">
            Strict Data Integrity Guarantee: Genuine Odds vs. Theoretical Fair Prices
          </p>
          <p className="text-slate-400 leading-relaxed">
            Theoretical model fair odds are calculated directly from Poisson distributions and Dixon-Coles parameters (1/P).
            PitchIntel never synthesizes artificial bookmaker odds from model probabilities. When live bookmaker feeds are unquoted for upcoming fixtures, fair odds are shown transparently with zero market edge claims.
          </p>
        </div>
      </div>

      {/* KPI Cards Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Verified Market Edges
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-emerald-400">
              {verifiedMarketOpportunities.length}
            </span>
            <span className="text-xs text-slate-500">live quotes</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Theoretical Propositions
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-sky-400">
              {theoreticalOpportunities.length}
            </span>
            <span className="text-xs text-slate-500">model prices</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Average Verified Edge
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-white">
              {verifiedMarketOpportunities.length > 0 ? `+${avgEdge}%` : 'Unquoted'}
            </span>
            <span className="text-xs text-slate-500">
              {verifiedMarketOpportunities.length > 0 ? '+EV expected' : 'baseline'}
            </span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Active Bankroll
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-amber-400">
              ${bankroll.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">paper trade</span>
          </div>
        </div>
      </div>

      {/* Tab Switcher & Filter Bar */}
      <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 space-y-3">
        {/* Mode Selector */}
        <div className="flex items-center gap-2 border-b border-slate-800/80 pb-3">
          <button
            onClick={() => setActiveTab('VERIFIED_VALUE')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'VERIFIED_VALUE'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <span>Verified Market Value Bets ({verifiedMarketOpportunities.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('THEORETICAL_FAIR')}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'THEORETICAL_FAIR'
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 shadow-sm'
                : 'text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800'
            }`}
          >
            <BarChart2 className="w-3.5 h-3.5 text-sky-400" />
            <span>Theoretical Model Fair Odds ({theoreticalOpportunities.length})</span>
          </button>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            {activeTab === 'VERIFIED_VALUE' && (
              <div className="flex items-center gap-1.5">
                <span className="text-slate-400 font-medium">Min Edge:</span>
                <select
                  value={minEdge}
                  onChange={(e) => setMinEdge(Number(e.target.value))}
                  className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-white font-mono cursor-pointer"
                >
                  <option value={0}>Any (+0%)</option>
                  <option value={2}>+2% Edge</option>
                  <option value={5}>+5% Edge</option>
                  <option value={8}>+8% Edge</option>
                </select>
              </div>
            )}

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

          {activeTab === 'VERIFIED_VALUE' && (
            <div className="flex items-center gap-2">
              <span className="text-slate-400 font-medium">Kelly Sizing:</span>
              <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800">
                {(['QUARTER', 'HALF', 'FULL'] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setKellyMode(mode)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                      kellyMode === mode
                        ? 'bg-slate-800 text-emerald-400 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mode === 'QUARTER' ? '1/4 Kelly' : mode === 'HALF' ? '1/2 Kelly' : 'Full Kelly'}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Opportunities List */}
      {loading ? (
        <div className="p-12 text-center text-slate-400 text-sm">
          Loading upcoming fixtures and evaluating mathematical model distributions...
        </div>
      ) : displayedOpportunities.length === 0 ? (
        <div className="p-12 text-center bg-slate-900/40 border border-slate-800 rounded-2xl">
          <Shield className="w-8 h-8 text-slate-600 mx-auto mb-2" />
          <h3 className="text-sm font-semibold text-white">
            {activeTab === 'VERIFIED_VALUE'
              ? 'No Verified Market Edges Found'
              : 'No Model Propositions Found Above Current Filters'}
          </h3>
          <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
            {activeTab === 'VERIFIED_VALUE'
              ? 'External bookmaker odds feeds are currently unquoted for these scheduled fixtures. Switch to "Theoretical Model Fair Odds" to inspect pure statistical pricing.'
              : 'Try adjusting your Minimum Odds or Market filters above to inspect more fixtures.'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {displayedOpportunities.map((opp) => {
            const isAdded = addedIds.has(opp.id);
            const isReal = opp.hasRealMarketOdds && opp.bookmakerOdds !== null;
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

                  {/* Pick & Edge / Pricing Badge */}
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
                        {isReal ? 'Market Edge' : 'Pricing Type'}
                      </span>
                      {isReal ? (
                        <span className="text-xs font-bold font-mono text-emerald-400">
                          +{opp.edgePercent}%
                        </span>
                      ) : (
                        <span className="text-[11px] font-medium font-mono text-sky-400">
                          Model Fair (1/P)
                        </span>
                      )}
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
                      <span className="text-[10px] text-slate-500 block">
                        {isReal ? `${opp.bookmakerName || 'Bookmaker'} Odds` : 'Bookmaker Feed'}
                      </span>
                      {isReal ? (
                        <span className="font-mono font-semibold text-emerald-400">
                          {opp.bookmakerOdds!.toFixed(2)} ({Math.round(opp.impliedMarketProb! * 100)}%)
                        </span>
                      ) : (
                        <span className="font-mono text-slate-400 italic text-[11px]">
                          Unquoted
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Staking or Status Note */}
                  {isReal && stakeDollars !== null ? (
                    <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400 bg-emerald-950/20 border border-emerald-500/20 rounded-lg px-2.5 py-1.5">
                      <span>
                        Kelly Stake (
                        {kellyMode === 'QUARTER'
                          ? opp.quarterKellyPercent
                          : kellyMode === 'HALF'
                          ? opp.halfKellyPercent
                          : (opp.kellyStakeFraction || 0) * 100}
                        %):
                      </span>
                      <span className="font-mono font-bold text-emerald-300">
                        ${stakeDollars.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <div className="mt-2.5 text-[11px] text-slate-400 bg-slate-950/40 border border-slate-800/50 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-500"></span>
                      <span className="truncate">{opp.marketStatusNote}</span>
                    </div>
                  )}
                </div>

                {/* Card Actions */}
                <div className="flex items-center gap-2 pt-2 border-t border-slate-800/60 mt-3">
                  <button
                    onClick={() => handleAddToSlip(opp)}
                    disabled={isAdded}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      isAdded
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                        : isReal
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
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
                        <span>{isReal ? 'Add to Slip' : 'Paper Trade Slip'}</span>
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
          opportunities={displayedOpportunities}
          matches={matches}
          onClose={() => setShowExportModal(false)}
        />
      )}
    </div>
  );
};
