import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  Activity,
  Layers,
  Clock,
  Shield,
  Sparkles,
  Info,
  CheckCircle2,
  Lock,
  RefreshCw,
  Sliders,
  ChevronRight,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Filter,
} from 'lucide-react';
import { IngestionMilestone, MatchProbabilityTrend } from '../data/upcoming/trendEngine.ts';

interface EnsembleProbabilityTrendChartProps {
  trendData: MatchProbabilityTrend;
  matchId?: number;
  onRefreshTrend?: () => Promise<void> | void;
  compact?: boolean;
}

export function EnsembleProbabilityTrendChart({
  trendData,
  matchId,
  onRefreshTrend,
  compact = false,
}: EnsembleProbabilityTrendChartProps) {
  const [selectedMilestoneId, setSelectedMilestoneId] = useState<string | null>(null);
  const [outcomeFilter, setOutcomeFilter] = useState<'ALL' | 'HOME' | 'DRAW' | 'AWAY'>('ALL');
  const [metricMode, setMetricMode] = useState<'PROBABILITY' | 'ODDS' | 'XG'>('PROBABILITY');
  const [ingestingSource, setIngestingSource] = useState<boolean>(false);
  const [ingestNotice, setIngestNotice] = useState<string>('');
  const [customTrend, setCustomTrend] = useState<MatchProbabilityTrend | null>(null);

  const activeTrend = customTrend || trendData;
  const milestones = activeTrend.milestones || [];

  // Default selection to the latest milestone if not selected
  const activeMilestone = useMemo(() => {
    if (selectedMilestoneId) {
      const found = milestones.find((m) => m.id === selectedMilestoneId);
      if (found) return found;
    }
    return milestones[milestones.length - 1] || null;
  }, [milestones, selectedMilestoneId]);

  // Chart coordinate math
  const chartWidth = 760;
  const chartHeight = compact ? 220 : 300;
  const paddingLeft = 52;
  const paddingRight = 36;
  const paddingTop = 28;
  const paddingBottom = 48;

  const innerWidth = chartWidth - paddingLeft - paddingRight;
  const innerHeight = chartHeight - paddingTop - paddingBottom;

  // Compute point positions
  const count = milestones.length;
  const stepX = count > 1 ? innerWidth / (count - 1) : innerWidth / 2;

  const points = useMemo(() => {
    return milestones.map((m, idx) => {
      const x = paddingLeft + (count > 1 ? idx * stepX : innerWidth / 2);
      
      let yHome: number;
      let yDraw: number;
      let yAway: number;

      if (metricMode === 'PROBABILITY') {
        yHome = paddingTop + innerHeight * (1 - m.probabilities.homeWin);
        yDraw = paddingTop + innerHeight * (1 - m.probabilities.draw);
        yAway = paddingTop + innerHeight * (1 - m.probabilities.awayWin);
      } else if (metricMode === 'ODDS') {
        // Fair odds mapped from 1.0 to 10.0
        const maxOdds = 8.0;
        const normH = Math.min(1, Math.max(0, (m.fairOdds.home - 1) / (maxOdds - 1)));
        const normD = Math.min(1, Math.max(0, (m.fairOdds.draw - 1) / (maxOdds - 1)));
        const normA = Math.min(1, Math.max(0, (m.fairOdds.away - 1) / (maxOdds - 1)));
        yHome = paddingTop + innerHeight * normH;
        yDraw = paddingTop + innerHeight * normD;
        yAway = paddingTop + innerHeight * normA;
      } else {
        // xG mode mapped from 0 to 3.5 goals
        const maxXg = 3.5;
        yHome = paddingTop + innerHeight * (1 - Math.min(1, m.expectedGoals.home / maxXg));
        yDraw = paddingTop + innerHeight * (1 - Math.min(1, m.expectedGoals.total / (maxXg * 1.5)));
        yAway = paddingTop + innerHeight * (1 - Math.min(1, m.expectedGoals.away / maxXg));
      }

      return {
        milestone: m,
        x,
        yHome,
        yDraw,
        yAway,
      };
    });
  }, [milestones, count, stepX, innerWidth, innerHeight, metricMode]);

  // Construct SVG paths
  const homePath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.yHome}` : `${acc} L ${p.x} ${p.yHome}`;
    }, '');
  }, [points]);

  const drawPath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.yDraw}` : `${acc} L ${p.x} ${p.yDraw}`;
    }, '');
  }, [points]);

  const awayPath = useMemo(() => {
    if (points.length === 0) return '';
    return points.reduce((acc, p, idx) => {
      return idx === 0 ? `M ${p.x} ${p.yAway}` : `${acc} L ${p.x} ${p.yAway}`;
    }, '');
  }, [points]);

  // Area under Home path for gradient fill
  const homeAreaPath = useMemo(() => {
    if (points.length === 0) return '';
    const firstX = points[0].x;
    const lastX = points[points.length - 1].x;
    const bottomY = paddingTop + innerHeight;
    return `${homePath} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;
  }, [homePath, points, innerHeight]);

  // Ingest on-demand updated source simulation
  const handleTriggerIngest = async (sourceType: 'BREAKING_ABSENCE' | 'MARKET_ODDS_SHIFT' | 'LINEUP_CONFIRMED') => {
    const targetId = matchId || activeTrend.matchId;
    if (!targetId) {
      setIngestNotice('No fixture ID attached for live database ingestion.');
      return;
    }

    try {
      setIngestingSource(true);
      setIngestNotice(`Ingesting ${sourceType.replace(/_/g, ' ')} feed into evidence snapshot...`);

      const res = await fetch('/api/predict/ingest-source', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: targetId,
          sourceType,
          absenceTeam: 'AWAY',
          absencePlayer: sourceType === 'BREAKING_ABSENCE' ? 'Key Starting Center-Back' : undefined,
          marketOddsHome: sourceType === 'MARKET_ODDS_SHIFT' ? 1.78 : undefined,
          marketOddsDraw: sourceType === 'MARKET_ODDS_SHIFT' ? 3.60 : undefined,
          marketOddsAway: sourceType === 'MARKET_ODDS_SHIFT' ? 4.50 : undefined,
          notes: `Real-time user trigger: Ingested ${sourceType} into calibrated multi-model ledger.`,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ingest failed');

      if (data.trend) {
        setCustomTrend(data.trend);
        const lastM = data.trend.milestones[data.trend.milestones.length - 1];
        if (lastM) setSelectedMilestoneId(lastM.id);
      }

      setIngestNotice(`Successfully ingested ${sourceType.replace(/_/g, ' ')}! New ensemble point plotted on timeline.`);
      if (onRefreshTrend) await onRefreshTrend();
    } catch (err: any) {
      console.error('Ingest error:', err);
      setIngestNotice(`Ingest error: ${err.message}`);
    } finally {
      setIngestingSource(false);
      setTimeout(() => setIngestNotice(''), 7000);
    }
  };

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 space-y-6">
      {/* Header with Title and Mode Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-4">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <h3 className="text-lg font-bold text-white tracking-tight">
              Ensemble Probability Trend Timeline
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Tracks real-time shifts in multi-model consensus (Dixon-Coles + Monte Carlo + Elo) as progressive data feeds
            are ingested.
          </p>
        </div>

        {/* View / Metric Selectors */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Outcome Filter */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setOutcomeFilter('ALL')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                outcomeFilter === 'ALL' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              1X2 All
            </button>
            <button
              onClick={() => setOutcomeFilter('HOME')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                outcomeFilter === 'HOME' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
              Home
            </button>
            <button
              onClick={() => setOutcomeFilter('DRAW')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                outcomeFilter === 'DRAW' ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              Draw
            </button>
            <button
              onClick={() => setOutcomeFilter('AWAY')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all flex items-center gap-1 ${
                outcomeFilter === 'AWAY' ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/40' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              Away
            </button>
          </div>

          {/* Metric Toggle */}
          <div className="flex items-center bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
            <button
              onClick={() => setMetricMode('PROBABILITY')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                metricMode === 'PROBABILITY' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Prob %
            </button>
            <button
              onClick={() => setMetricMode('ODDS')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                metricMode === 'ODDS' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Fair Odds
            </button>
            <button
              onClick={() => setMetricMode('XG')}
              className={`px-2.5 py-1 rounded-lg font-semibold transition-all ${
                metricMode === 'XG' ? 'bg-slate-800 text-white shadow-sm' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              xGoals
            </button>
          </div>
        </div>
      </div>

      {/* Delta Stat Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">Baseline Elo Prior</span>
            <span className="text-[10px] text-slate-500 font-mono">T-48h</span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-lg font-black text-white font-mono">
              {(activeTrend.baselineEnsemble.homeWin * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400 font-mono">Home Win</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-0.5">
            Initial season ratings &amp; league priors
          </span>
        </div>

        <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">Current Calibrated Lock</span>
            <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
              <Lock className="w-2.5 h-2.5" /> Sealed
            </span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-lg font-black text-emerald-400 font-mono">
              {(activeTrend.currentEnsemble.homeWin * 100).toFixed(1)}%
            </span>
            <span className="text-xs text-slate-300 font-mono">Home Win</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-0.5">
            After {activeTrend.totalDataSourcesIngested} progressive evidence ingestions
          </span>
        </div>

        <div className="bg-slate-950 p-3.5 rounded-2xl border border-slate-800">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-slate-400">Net Evidence Shift</span>
            <span className="text-[10px] text-slate-500 font-mono">Delta</span>
          </div>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className={`text-lg font-black font-mono flex items-center gap-1 ${
                activeTrend.netShift.homeWin >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {activeTrend.netShift.homeWin >= 0 ? (
                <ArrowUpRight className="w-4 h-4" />
              ) : (
                <ArrowDownRight className="w-4 h-4" />
              )}
              {activeTrend.netShift.homeWin > 0 ? '+' : ''}
              {activeTrend.netShift.homeWin.toFixed(1)}%
            </span>
            <span className="text-xs text-slate-400 font-mono">Home Shift</span>
          </div>
          <span className="text-[10px] text-slate-500 block mt-0.5 font-mono">
            Draw: {activeTrend.netShift.draw > 0 ? '+' : ''}
            {activeTrend.netShift.draw.toFixed(1)}% · Away: {activeTrend.netShift.awayWin > 0 ? '+' : ''}
            {activeTrend.netShift.awayWin.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Main Interactive SVG Trend Chart */}
      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 relative overflow-hidden">
        {/* Chart Legend Strip */}
        <div className="flex items-center justify-between text-xs pb-3 mb-2 border-b border-slate-800/80">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
              <span className="w-3 h-0.5 bg-emerald-400 rounded-full inline-block"></span>
              <strong className="text-emerald-400 font-sans">{activeTrend.homeTeam} (Home)</strong>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
              <span className="w-3 h-0.5 bg-amber-400 rounded-full inline-block"></span>
              <strong className="text-amber-400 font-sans">Draw</strong>
            </div>
            <div className="flex items-center gap-1.5 text-slate-300 font-mono text-[11px]">
              <span className="w-3 h-0.5 bg-cyan-400 rounded-full inline-block"></span>
              <strong className="text-cyan-400 font-sans">{activeTrend.awayTeam} (Away)</strong>
            </div>
          </div>
          <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
            Hover or click nodes to inspect evidence
          </span>
        </div>

        {/* SVG Canvas */}
        <div className="w-full overflow-x-auto scrollbar-none">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            className="w-full min-w-[620px] select-none"
            style={{ height: chartHeight }}
          >
            <defs>
              <linearGradient id="homeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#10b981" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
              </linearGradient>
              <filter id="glowEmerald" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Horizontal Grid Lines & Y-Axis Labels */}
            {[0.2, 0.4, 0.6, 0.8].map((pct) => {
              const y = paddingTop + innerHeight * (1 - pct);
              return (
                <g key={pct}>
                  <line
                    x1={paddingLeft}
                    y1={y}
                    x2={paddingLeft + innerWidth}
                    y2={y}
                    stroke="#1e293b"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                  <text
                    x={paddingLeft - 8}
                    y={y + 3}
                    textAnchor="end"
                    fill="#64748b"
                    fontSize="10"
                    fontFamily="monospace"
                  >
                    {metricMode === 'PROBABILITY'
                      ? `${(pct * 100).toFixed(0)}%`
                      : metricMode === 'ODDS'
                      ? `${(1 + pct * 7).toFixed(1)}x`
                      : `${(pct * 3.5).toFixed(1)}g`}
                  </text>
                </g>
              );
            })}

            {/* Baseline 0% line */}
            <line
              x1={paddingLeft}
              y1={paddingTop + innerHeight}
              x2={paddingLeft + innerWidth}
              y2={paddingTop + innerHeight}
              stroke="#334155"
              strokeWidth="1"
            />

            {/* Area under Home path if All or Home is visible */}
            {(outcomeFilter === 'ALL' || outcomeFilter === 'HOME') && homeAreaPath && (
              <path d={homeAreaPath} fill="url(#homeGradient)" />
            )}

            {/* Home Win Line */}
            {(outcomeFilter === 'ALL' || outcomeFilter === 'HOME') && (
              <path
                d={homePath}
                fill="none"
                stroke="#10b981"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Draw Line */}
            {(outcomeFilter === 'ALL' || outcomeFilter === 'DRAW') && (
              <path
                d={drawPath}
                fill="none"
                stroke="#f59e0b"
                strokeWidth="2.25"
                strokeDasharray="5 3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Away Win Line */}
            {(outcomeFilter === 'ALL' || outcomeFilter === 'AWAY') && (
              <path
                d={awayPath}
                fill="none"
                stroke="#06b6d4"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}

            {/* Vertical Marker Lines and Interactive Points for each Milestone */}
            {points.map((p, idx) => {
              const isSelected = activeMilestone?.id === p.milestone.id;
              const isLast = idx === points.length - 1;

              return (
                <g key={p.milestone.id}>
                  {/* Vertical dashed timeline guide */}
                  <line
                    x1={p.x}
                    y1={paddingTop}
                    x2={p.x}
                    y2={paddingTop + innerHeight}
                    stroke={isSelected ? '#10b981' : '#1e293b'}
                    strokeWidth={isSelected ? '1.5' : '1'}
                    strokeDasharray={isSelected ? 'none' : '3 3'}
                    opacity={isSelected ? 0.75 : 0.4}
                  />

                  {/* X-axis milestone label */}
                  <text
                    x={p.x}
                    y={paddingTop + innerHeight + 18}
                    textAnchor="middle"
                    fill={isSelected ? '#f8fafc' : '#94a3b8'}
                    fontSize="10"
                    fontWeight={isSelected ? 'bold' : 'normal'}
                    fontFamily="monospace"
                  >
                    {p.milestone.relativeTime}
                  </text>

                  {/* Secondary Stage indicator below */}
                  <text
                    x={p.x}
                    y={paddingTop + innerHeight + 32}
                    textAnchor="middle"
                    fill={isSelected ? '#10b981' : '#64748b'}
                    fontSize="9"
                    fontFamily="sans-serif"
                  >
                    {isLast ? 'Locked' : `Stage ${idx + 1}`}
                  </text>

                  {/* Home Circle Node */}
                  {(outcomeFilter === 'ALL' || outcomeFilter === 'HOME') && (
                    <circle
                      cx={p.x}
                      cy={p.yHome}
                      r={isSelected ? 6 : 4.5}
                      fill={isSelected ? '#10b981' : '#0f172a'}
                      stroke="#10b981"
                      strokeWidth={isSelected ? 3 : 2}
                      className="cursor-pointer transition-all"
                      onClick={() => setSelectedMilestoneId(p.milestone.id)}
                    />
                  )}

                  {/* Draw Circle Node */}
                  {(outcomeFilter === 'ALL' || outcomeFilter === 'DRAW') && (
                    <circle
                      cx={p.x}
                      cy={p.yDraw}
                      r={isSelected ? 5 : 3.5}
                      fill={isSelected ? '#f59e0b' : '#0f172a'}
                      stroke="#f59e0b"
                      strokeWidth="2"
                      className="cursor-pointer transition-all"
                      onClick={() => setSelectedMilestoneId(p.milestone.id)}
                    />
                  )}

                  {/* Away Circle Node */}
                  {(outcomeFilter === 'ALL' || outcomeFilter === 'AWAY') && (
                    <circle
                      cx={p.x}
                      cy={p.yAway}
                      r={isSelected ? 6 : 4.5}
                      fill={isSelected ? '#06b6d4' : '#0f172a'}
                      stroke="#06b6d4"
                      strokeWidth={isSelected ? 3 : 2}
                      className="cursor-pointer transition-all"
                      onClick={() => setSelectedMilestoneId(p.milestone.id)}
                    />
                  )}

                  {/* Clickable vertical hit area for mobile/mouse */}
                  <rect
                    x={p.x - 18}
                    y={paddingTop}
                    width={36}
                    height={innerHeight + 36}
                    fill="transparent"
                    className="cursor-pointer"
                    onClick={() => setSelectedMilestoneId(p.milestone.id)}
                  />
                </g>
              );
            })}
          </svg>
        </div>
      </div>

      {/* Selected Milestone Inspection Dossier Card */}
      {activeMilestone && (
        <div className="bg-slate-950 p-5 rounded-2xl border border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-800 gap-2">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {activeMilestone.relativeTime}
                </span>
                <h4 className="text-sm font-bold text-white">
                  {activeMilestone.sourceName}
                </h4>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {activeMilestone.sourceDescription}
              </p>
            </div>

            <div className="flex items-center gap-3 text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-500" />
                {new Date(activeMilestone.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span className="flex items-center gap-1">
                <Shield className="w-3.5 h-3.5 text-emerald-400" />
                Data Quality: <strong className="text-white">{activeMilestone.dataQuality}</strong>
              </span>
            </div>
          </div>

          {/* Probabilities & Shift breakdown */}
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">Home Win</span>
              <span className="text-xl font-black text-emerald-400 font-mono block mt-0.5">
                {(activeMilestone.probabilities.homeWin * 100).toFixed(1)}%
              </span>
              <div className="flex items-center justify-center gap-1 mt-1 text-[11px] font-mono">
                <span className="text-slate-400">Odds: {activeMilestone.fairOdds.home.toFixed(2)}</span>
                {activeMilestone.deltaFromPrev && (
                  <span
                    className={
                      activeMilestone.deltaFromPrev.homeWin >= 0
                        ? 'text-emerald-400 font-bold'
                        : 'text-rose-400 font-bold'
                    }
                  >
                    ({activeMilestone.deltaFromPrev.homeWin > 0 ? '+' : ''}
                    {activeMilestone.deltaFromPrev.homeWin}%)
                  </span>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">Draw</span>
              <span className="text-xl font-black text-amber-400 font-mono block mt-0.5">
                {(activeMilestone.probabilities.draw * 100).toFixed(1)}%
              </span>
              <div className="flex items-center justify-center gap-1 mt-1 text-[11px] font-mono">
                <span className="text-slate-400">Odds: {activeMilestone.fairOdds.draw.toFixed(2)}</span>
                {activeMilestone.deltaFromPrev && (
                  <span
                    className={
                      activeMilestone.deltaFromPrev.draw >= 0
                        ? 'text-amber-400 font-bold'
                        : 'text-slate-400 font-bold'
                    }
                  >
                    ({activeMilestone.deltaFromPrev.draw > 0 ? '+' : ''}
                    {activeMilestone.deltaFromPrev.draw}%)
                  </span>
                )}
              </div>
            </div>

            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800">
              <span className="text-[10px] text-slate-400 uppercase font-mono block">Away Win</span>
              <span className="text-xl font-black text-cyan-400 font-mono block mt-0.5">
                {(activeMilestone.probabilities.awayWin * 100).toFixed(1)}%
              </span>
              <div className="flex items-center justify-center gap-1 mt-1 text-[11px] font-mono">
                <span className="text-slate-400">Odds: {activeMilestone.fairOdds.away.toFixed(2)}</span>
                {activeMilestone.deltaFromPrev && (
                  <span
                    className={
                      activeMilestone.deltaFromPrev.awayWin >= 0
                        ? 'text-emerald-400 font-bold'
                        : 'text-cyan-400 font-bold'
                    }
                  >
                    ({activeMilestone.deltaFromPrev.awayWin > 0 ? '+' : ''}
                    {activeMilestone.deltaFromPrev.awayWin}%)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Key Ingested Evidence Highlight */}
          <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800/80 flex items-start gap-3">
            <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              <span className="font-semibold text-white block">Ingested Evidence &amp; Model Driver</span>
              <p className="text-slate-300 leading-relaxed font-sans">{activeMilestone.keyEvidence}</p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-slate-400 pt-1">
                <span>Expected Goals: Home {activeMilestone.expectedGoals.home} vs Away {activeMilestone.expectedGoals.away} (Tot: {activeMilestone.expectedGoals.total})</span>
                <span>·</span>
                <span>Model Confidence: {(activeMilestone.confidenceScore * 100).toFixed(0)}%</span>
                <span>·</span>
                <span className="text-emerald-400">{activeMilestone.modelVersion}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Interactive Evidence Ingestion Action Bar */}
      <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              Live Evidence Ingestion Sandbox
            </span>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Trigger new pre-match data feeds in real time. The engine recalculates the ensemble and seals a new version
              in PostgreSQL.
            </p>
          </div>

          {ingestingSource && (
            <span className="text-xs text-emerald-400 font-mono flex items-center gap-1.5 animate-pulse">
              <RefreshCw className="w-3 h-3 animate-spin" /> Ingesting feed into ledger...
            </span>
          )}
        </div>

        {ingestNotice && (
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 rounded-xl text-xs font-medium">
            {ingestNotice}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 pt-1">
          <button
            onClick={() => handleTriggerIngest('BREAKING_ABSENCE')}
            disabled={ingestingSource}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-emerald-500/60 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
            + Ingest Key Absence (-0.32 xGA)
          </button>

          <button
            onClick={() => handleTriggerIngest('MARKET_ODDS_SHIFT')}
            disabled={ingestingSource}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-emerald-500/60 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm"
          >
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            + Ingest Sharp Market Move (1.78 Odds)
          </button>

          <button
            onClick={() => handleTriggerIngest('LINEUP_CONFIRMED')}
            disabled={ingestingSource}
            className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-200 border border-slate-700/80 hover:border-emerald-500/60 rounded-xl text-xs font-semibold transition-all inline-flex items-center gap-1.5 shadow-sm"
          >
            <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" />
            + Ingest Confirmed XI Lineup
          </button>
        </div>
      </div>

      {/* Sequential Milestone Timeline History List */}
      <div className="space-y-2">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 block mb-2">
          Chronological Ingestion Ledger ({milestones.length} Data Sources Sealed)
        </span>
        <div className="space-y-2">
          {milestones.map((m, idx) => {
            const isSelected = activeMilestone?.id === m.id;
            return (
              <div
                key={m.id}
                onClick={() => setSelectedMilestoneId(m.id)}
                className={`p-3 rounded-xl border text-xs cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                  isSelected
                    ? 'bg-slate-800/80 border-emerald-500/50 shadow-sm'
                    : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-emerald-400 font-bold bg-slate-900 px-2 py-0.5 rounded border border-slate-800 text-[11px]">
                    {m.relativeTime}
                  </span>
                  <div>
                    <strong className="text-white text-xs block">{m.sourceName}</strong>
                    <span className="text-[11px] text-slate-400 block line-clamp-1">{m.keyEvidence}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 font-mono shrink-0">
                  <span className="text-emerald-400 font-bold">
                    H {(m.probabilities.homeWin * 100).toFixed(1)}%
                  </span>
                  <span className="text-amber-400 font-bold">
                    D {(m.probabilities.draw * 100).toFixed(1)}%
                  </span>
                  <span className="text-cyan-400 font-bold">
                    A {(m.probabilities.awayWin * 100).toFixed(1)}%
                  </span>

                  {m.deltaFromPrev && (
                    <span
                      className={`text-[11px] ${
                        m.deltaFromPrev.homeWin >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {m.deltaFromPrev.homeWin > 0 ? '+' : ''}
                      {m.deltaFromPrev.homeWin.toFixed(1)}%
                    </span>
                  )}

                  <ChevronRight className={`w-4 h-4 ${isSelected ? 'text-emerald-400' : 'text-slate-600'}`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
