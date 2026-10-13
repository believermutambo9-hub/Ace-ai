import React, { useState, useEffect } from 'react';
import {
  DollarSign,
  TrendingUp,
  Percent,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  PlusCircle,
  Shield,
  Layers,
  ArrowUpRight,
  ArrowDownRight,
  Sliders,
  Check,
  X,
  Trash2,
} from 'lucide-react';
import { PortfolioStore, PortfolioState, TrackedBet } from '../data/portfolio/portfolioStore.ts';

interface PortfolioDashboardProps {
  onOpenBetSlip: () => void;
  onNotify?: (msg: string) => void;
}

export const PortfolioDashboard: React.FC<PortfolioDashboardProps> = ({ onOpenBetSlip, onNotify }) => {
  const [portfolio, setPortfolio] = useState<PortfolioState>(PortfolioStore.getState());
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'OPEN' | 'WON' | 'LOST' | 'VOID'>('ALL');
  const [isEditingBankroll, setIsEditingBankroll] = useState<boolean>(false);
  const [newBankrollInput, setNewBankrollInput] = useState<string>('');

  useEffect(() => {
    const unsub = PortfolioStore.subscribe((state) => {
      setPortfolio(state);
    });
    setPortfolio(PortfolioStore.getState());
    return () => unsub();
  }, []);

  const metrics = PortfolioStore.getPortfolioMetrics(portfolio);

  const filteredBets = portfolio.trackedBets.filter((bet) => {
    if (filterStatus === 'ALL') return true;
    return bet.status === filterStatus;
  });

  const handleUpdateBankroll = () => {
    const val = parseFloat(newBankrollInput);
    if (!isNaN(val) && val > 0) {
      PortfolioStore.setBankroll(val);
      setIsEditingBankroll(false);
      setNewBankrollInput('');
      if (onNotify) onNotify(`Bankroll updated to $${val.toFixed(2)}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-semibold text-xs tracking-wider uppercase">
              Paper Trading & Capital Management
            </span>
            <span className="text-slate-600 text-xs">·</span>
            <span className="text-slate-400 text-xs">Fractional Kelly Bankroll Tracking</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight mt-0.5">
            Quantitative Portfolio & Bankroll Terminal
          </h1>
          <p className="text-xs text-slate-400 mt-1 max-w-2xl">
            Simulate and audit your systematic betting strategy with mathematical rigor. Tracks historical yield, ROI %, drawdown, and automated edge realization.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onOpenBetSlip}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer shadow-lg"
          >
            <PlusCircle className="w-3.5 h-3.5" />
            <span>Open Bet Slip ({portfolio.slip.length})</span>
          </button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Current Bankroll
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-white">
              ${portfolio.bankroll.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">liquid</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Net Profit / Loss
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className={`text-2xl font-bold font-mono ${
                metrics.totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {metrics.totalNetProfit >= 0 ? '+' : ''}${metrics.totalNetProfit.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            System ROI %
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className={`text-2xl font-bold font-mono ${
                metrics.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {metrics.roi >= 0 ? '+' : ''}{metrics.roi}%
            </span>
            <span className="text-xs text-slate-500">yield</span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Win Rate
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-sky-400">
              {metrics.winRate}%
            </span>
            <span className="text-xs text-slate-500">
              {metrics.wonCount}W - {metrics.lostCount}L
            </span>
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-800/90 rounded-xl p-4 col-span-2 lg:col-span-1">
          <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider block">
            Open Exposure
          </span>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-bold font-mono text-amber-400">
              ${metrics.openExposure.toFixed(2)}
            </span>
            <span className="text-xs text-slate-500">{metrics.openBetsCount} active</span>
          </div>
        </div>
      </div>

      {/* Bankroll Settings Bar */}
      <div className="bg-slate-900/70 border border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="text-slate-400 font-semibold">Bankroll Config:</span>
          {isEditingBankroll ? (
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Enter amount"
                value={newBankrollInput}
                onChange={(e) => setNewBankrollInput(e.target.value)}
                className="bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-white font-mono w-28 text-xs"
              />
              <button
                onClick={handleUpdateBankroll}
                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded cursor-pointer"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditingBankroll(false)}
                className="px-2 py-1 text-slate-400 cursor-pointer"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="font-mono text-emerald-400 font-bold">${portfolio.bankroll.toFixed(2)}</span>
              <button
                onClick={() => setIsEditingBankroll(true)}
                className="text-slate-400 hover:text-white underline cursor-pointer"
              >
                Edit Capital
              </button>
            </div>
          )}
        </div>

        <button
          onClick={() => {
            if (confirm('Reset portfolio to initial $1,000 capital?')) {
              PortfolioStore.resetPortfolio(1000);
              if (onNotify) onNotify('Portfolio reset to initial $1,000 baseline.');
            }
          }}
          className="flex items-center gap-1.5 text-slate-400 hover:text-rose-400 transition cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset Portfolio</span>
        </button>
      </div>

      {/* Bets Ledger Section */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-slate-950/40">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-white">System Betting Ledger</h3>
            <span className="text-xs text-slate-500 font-mono">({portfolio.trackedBets.length} total wagers)</span>
          </div>

          {/* Filter Segmented Control */}
          <div className="inline-flex rounded-lg bg-slate-950 p-0.5 border border-slate-800 text-xs">
            {(['ALL', 'OPEN', 'WON', 'LOST', 'VOID'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                  filterStatus === st
                    ? 'bg-slate-800 text-emerald-400'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Ledger Table */}
        {filteredBets.length === 0 ? (
          <div className="p-12 text-center text-slate-500 text-xs space-y-2">
            <Layers className="w-8 h-8 text-slate-700 mx-auto" />
            <p className="font-semibold text-slate-400">No Bets Found Matching Filter</p>
            <p>Add selections from Upcoming Queue or Value Bet Scanner to track wagers.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/80 text-[11px] text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="p-3.5">Date & Time</th>
                  <th className="p-3.5">Fixture</th>
                  <th className="p-3.5">Market & Selection</th>
                  <th className="p-3.5 font-mono">Odds</th>
                  <th className="p-3.5 font-mono">Stake ($)</th>
                  <th className="p-3.5 font-mono">Return / P&L</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300">
                {filteredBets.map((bet) => (
                  <tr key={bet.id} className="hover:bg-slate-900/40">
                    <td className="p-3.5 text-slate-400 font-sans text-[11px]">
                      {new Date(bet.placedAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="p-3.5 font-sans font-semibold text-white">
                      <div>{bet.homeTeam} vs {bet.awayTeam}</div>
                      <span className="text-[10px] text-emerald-400 font-normal">{bet.competition}</span>
                    </td>
                    <td className="p-3.5 font-sans">
                      <span className="text-slate-200 font-medium">{bet.selectionLabel}</span>
                      <span className="block text-[10px] text-slate-500 font-mono">
                        Model P({Math.round(bet.modelProbability * 100)}%) · +{bet.edgePercent}% Edge
                      </span>
                    </td>
                    <td className="p-3.5 text-emerald-400 font-bold">{bet.odds.toFixed(2)}</td>
                    <td className="p-3.5 text-white">${bet.stake.toFixed(2)}</td>
                    <td className="p-3.5">
                      {bet.status === 'WON' ? (
                        <span className="text-emerald-400 font-bold">+${bet.profit?.toFixed(2)}</span>
                      ) : bet.status === 'LOST' ? (
                        <span className="text-rose-400 font-bold">-${bet.stake.toFixed(2)}</span>
                      ) : bet.status === 'VOID' ? (
                        <span className="text-slate-400">$0.00 (Refund)</span>
                      ) : (
                        <span className="text-slate-400">Pot: ${bet.potentialPayout.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="p-3.5 font-sans">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                          bet.status === 'WON'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : bet.status === 'LOST'
                            ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                            : bet.status === 'VOID'
                            ? 'bg-slate-800 text-slate-400'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {bet.status}
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-sans">
                      {bet.status === 'OPEN' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => PortfolioStore.settleBet(bet.id, 'WON')}
                            className="px-2 py-1 rounded bg-emerald-950/60 hover:bg-emerald-900 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold cursor-pointer"
                          >
                            Won
                          </button>
                          <button
                            onClick={() => PortfolioStore.settleBet(bet.id, 'LOST')}
                            className="px-2 py-1 rounded bg-rose-950/60 hover:bg-rose-900 text-rose-400 border border-rose-500/30 text-[10px] font-bold cursor-pointer"
                          >
                            Lost
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => PortfolioStore.deleteTrackedBet(bet.id)}
                          className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                          title="Delete from history"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
