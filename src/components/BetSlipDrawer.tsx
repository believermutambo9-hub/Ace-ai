import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  TrendingUp,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Percent,
  Layers,
  ArrowRight,
  Shield,
  RotateCcw,
  Check,
  Ban,
  Sliders,
} from 'lucide-react';
import { PortfolioStore, PortfolioState, BetSlipItem, TrackedBet } from '../data/portfolio/portfolioStore.ts';

interface BetSlipDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onNotify?: (msg: string) => void;
}

export const BetSlipDrawer: React.FC<BetSlipDrawerProps> = ({ isOpen, onClose, onNotify }) => {
  const [portfolio, setPortfolio] = useState<PortfolioState>(PortfolioStore.getState());
  const [activeTab, setActiveTab] = useState<'SLIP' | 'PORTFOLIO'>('SLIP');
  const [customBankrollInput, setCustomBankrollInput] = useState<string>('');
  const [isEditingBankroll, setIsEditingBankroll] = useState<boolean>(false);

  useEffect(() => {
    const unsub = PortfolioStore.subscribe((state) => {
      setPortfolio(state);
    });
    setPortfolio(PortfolioStore.getState());
    return () => unsub();
  }, []);

  if (!isOpen) return null;

  const metrics = PortfolioStore.getPortfolioMetrics(portfolio);
  const totalSlipStake = portfolio.slip.reduce((acc, item) => acc + item.stake, 0);
  const totalSlipPayout = portfolio.slip.reduce((acc, item) => acc + item.stake * item.bookmakerOdds, 0);
  const totalPotentialProfit = totalSlipPayout - totalSlipStake;

  const handlePlaceBets = () => {
    if (portfolio.bankroll < totalSlipStake) {
      if (onNotify) onNotify(`Insufficient bankroll ($${portfolio.bankroll.toFixed(2)}) for total stake ($${totalSlipStake.toFixed(2)}).`);
      return;
    }

    const count = PortfolioStore.placeAllSlipBets();
    if (count > 0) {
      if (onNotify) onNotify(`Successfully placed ${count} paper wager(s)!`);
      setActiveTab('PORTFOLIO');
    }
  };

  const handleSaveBankroll = () => {
    const val = parseFloat(customBankrollInput);
    if (!isNaN(val) && val > 0) {
      PortfolioStore.setBankroll(val);
      setIsEditingBankroll(false);
      setCustomBankrollInput('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md bg-slate-950 border-l border-slate-800 h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Top Header */}
        <div className="p-4 border-b border-slate-800/80 bg-slate-900/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <DollarSign className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Bet Slip & Bankroll</h2>
              <div className="flex items-center gap-1.5 text-xs text-slate-400">
                <span>Bankroll:</span>
                <span className="font-mono font-bold text-emerald-400">${portfolio.bankroll.toFixed(2)}</span>
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="flex border-b border-slate-800/80 bg-slate-950 px-4 pt-2 shrink-0">
          <button
            onClick={() => setActiveTab('SLIP')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'SLIP'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span>Active Slip</span>
            {portfolio.slip.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-mono">
                {portfolio.slip.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('PORTFOLIO')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 transition cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'PORTFOLIO'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-white'
            }`}
          >
            <span>Portfolio History</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 text-[10px] font-mono">
              {metrics.totalBetsCount}
            </span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {activeTab === 'SLIP' ? (
            /* SLIP TAB */
            portfolio.slip.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs space-y-2">
                <DollarSign className="w-8 h-8 mx-auto text-slate-700" />
                <p className="font-semibold text-slate-400">Your Bet Slip is Empty</p>
                <p>Click "+ Add to Slip" on any prediction or Value Bet to calculate positions.</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-400 pb-1">
                  <span>Selections ({portfolio.slip.length})</span>
                  <button
                    onClick={() => PortfolioStore.clearSlip()}
                    className="text-rose-400 hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>Clear All</span>
                  </button>
                </div>

                {portfolio.slip.map((item) => (
                  <div
                    key={item.id}
                    className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-2.5"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] text-emerald-400 font-semibold uppercase block">
                          {item.competition}
                        </span>
                        <h4 className="text-xs font-bold text-white">
                          {item.homeTeam} vs {item.awayTeam}
                        </h4>
                        <span className="text-xs text-slate-300 font-medium mt-0.5 block">
                          {item.selectionLabel}
                        </span>
                      </div>
                      <button
                        onClick={() => PortfolioStore.removeFromSlip(item.id)}
                        className="text-slate-500 hover:text-rose-400 p-1 cursor-pointer"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 text-xs bg-slate-950/60 p-2 rounded-lg border border-slate-800/60 font-mono">
                      <div>
                        <span className="text-[10px] text-slate-500 block">Odds</span>
                        <span className="text-emerald-400 font-bold">{item.bookmakerOdds.toFixed(2)}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">P(Win)</span>
                        <span className="text-slate-300">{Math.round(item.modelProbability * 100)}%</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-500 block">Edge</span>
                        <span className="text-emerald-400 font-bold">+{item.edgePercent}%</span>
                      </div>
                    </div>

                    {/* Stake Input */}
                    <div className="flex items-center justify-between pt-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 font-medium">Stake ($):</span>
                        <input
                          type="number"
                          min="1"
                          max={portfolio.bankroll}
                          value={item.stake}
                          onChange={(e) =>
                            PortfolioStore.updateSlipStake(item.id, Number(e.target.value))
                          }
                          className="w-20 bg-slate-950 border border-slate-800 rounded px-2 py-1 text-white font-mono text-xs focus:border-emerald-500 outline-none"
                        />
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-slate-500 block">Potential Return</span>
                        <span className="font-mono font-bold text-white text-xs">
                          ${(item.stake * item.bookmakerOdds).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* PORTFOLIO TAB */
            <div className="space-y-4">
              {/* Metrics Summary Strip */}
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 block uppercase">Net Profit/Loss</span>
                  <span
                    className={`text-base font-bold font-mono ${
                      metrics.totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {metrics.totalNetProfit >= 0 ? '+' : ''}${metrics.totalNetProfit.toFixed(2)}
                  </span>
                </div>
                <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 block uppercase">ROI %</span>
                  <span
                    className={`text-base font-bold font-mono ${
                      metrics.roi >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {metrics.roi >= 0 ? '+' : ''}{metrics.roi}%
                  </span>
                </div>
                <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 block uppercase">Win Rate</span>
                  <span className="text-base font-bold font-mono text-white">
                    {metrics.winRate}% ({metrics.wonCount}W - {metrics.lostCount}L)
                  </span>
                </div>
                <div className="bg-slate-900/80 p-3 rounded-xl border border-slate-800">
                  <span className="text-[10px] text-slate-500 block uppercase">Open Exposure</span>
                  <span className="text-base font-bold font-mono text-amber-400">
                    ${metrics.openExposure.toFixed(2)} ({metrics.openBetsCount})
                  </span>
                </div>
              </div>

              {/* Bankroll Management Controls */}
              <div className="bg-slate-900/60 p-3 rounded-xl border border-slate-800/80 space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-semibold">Bankroll Management</span>
                  <button
                    onClick={() => PortfolioStore.resetPortfolio(1000)}
                    className="text-slate-500 hover:text-white flex items-center gap-1 cursor-pointer"
                    title="Reset to $1,000 baseline"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset</span>
                  </button>
                </div>
                {isEditingBankroll ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      placeholder="e.g. 1500"
                      value={customBankrollInput}
                      onChange={(e) => setCustomBankrollInput(e.target.value)}
                      className="flex-1 bg-slate-950 border border-slate-800 rounded px-2.5 py-1 text-white text-xs font-mono"
                    />
                    <button
                      onClick={handleSaveBankroll}
                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 rounded text-white text-xs font-semibold cursor-pointer"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setIsEditingBankroll(false)}
                      className="px-2 py-1 text-slate-400 text-xs cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400">Current Capital:</span>
                    <button
                      onClick={() => setIsEditingBankroll(true)}
                      className="text-emerald-400 font-mono font-bold hover:underline cursor-pointer"
                    >
                      ${portfolio.bankroll.toFixed(2)} (Edit)
                    </button>
                  </div>
                )}
              </div>

              {/* Tracked Bets List */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Tracked Bets ({portfolio.trackedBets.length})
                </h4>

                {portfolio.trackedBets.length === 0 ? (
                  <p className="text-xs text-slate-500 italic py-4 text-center">
                    No bets placed yet. Add selections to slip to begin paper trading.
                  </p>
                ) : (
                  portfolio.trackedBets.map((bet) => (
                    <div
                      key={bet.id}
                      className="p-3 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2 text-xs"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[10px] text-emerald-400 font-semibold uppercase block">
                            {bet.competition}
                          </span>
                          <span className="font-bold text-white block">
                            {bet.homeTeam} vs {bet.awayTeam}
                          </span>
                          <span className="text-slate-300 font-medium">{bet.selectionLabel}</span>
                        </div>
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
                      </div>

                      <div className="flex items-center justify-between font-mono text-[11px] text-slate-400 pt-1 border-t border-slate-800/60">
                        <span>Stake: ${bet.stake.toFixed(2)} @ {bet.odds.toFixed(2)}</span>
                        <span>
                          {bet.status === 'WON' ? (
                            <span className="text-emerald-400 font-bold">+${bet.profit?.toFixed(2)}</span>
                          ) : bet.status === 'LOST' ? (
                            <span className="text-rose-400 font-bold">-${bet.stake.toFixed(2)}</span>
                          ) : (
                            <span className="text-slate-300">Ret: ${bet.potentialPayout.toFixed(2)}</span>
                          )}
                        </span>
                      </div>

                      {/* Manual Settlement controls for OPEN bets */}
                      {bet.status === 'OPEN' && (
                        <div className="flex items-center gap-1.5 pt-1.5 border-t border-slate-800/40">
                          <button
                            onClick={() => PortfolioStore.settleBet(bet.id, 'WON')}
                            className="flex-1 py-1 rounded bg-emerald-950/40 hover:bg-emerald-900/60 text-emerald-400 border border-emerald-500/30 font-semibold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>Won</span>
                          </button>
                          <button
                            onClick={() => PortfolioStore.settleBet(bet.id, 'LOST')}
                            className="flex-1 py-1 rounded bg-rose-950/40 hover:bg-rose-900/60 text-rose-400 border border-rose-500/30 font-semibold text-[10px] flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <X className="w-3 h-3" />
                            <span>Lost</span>
                          </button>
                          <button
                            onClick={() => PortfolioStore.settleBet(bet.id, 'VOID')}
                            className="py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] cursor-pointer"
                          >
                            Void
                          </button>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer for Active Slip */}
        {activeTab === 'SLIP' && portfolio.slip.length > 0 && (
          <div className="p-4 border-t border-slate-800/80 bg-slate-900/90 space-y-3 shrink-0">
            <div className="space-y-1.5 text-xs font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Total Staked:</span>
                <span className="text-white">${totalSlipStake.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Potential Payout:</span>
                <span className="text-emerald-400 font-bold">${totalSlipPayout.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Net Potential Profit:</span>
                <span className="text-emerald-400 font-bold">+${totalPotentialProfit.toFixed(2)}</span>
              </div>
            </div>

            <button
              onClick={handlePlaceBets}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition cursor-pointer shadow-lg shadow-emerald-950/40 flex items-center justify-center gap-2"
            >
              <span>Place Paper Wagers (${totalSlipStake.toFixed(2)})</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
