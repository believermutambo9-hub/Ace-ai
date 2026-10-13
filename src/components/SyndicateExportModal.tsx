import React from 'react';
import { X, Download, Printer, FileText, CheckCircle2 } from 'lucide-react';
import { MarketOpportunity } from '../data/valueBets/valueBetEngine.ts';
import { UpcomingMatchItem } from '../data/upcoming/upcomingEngine.ts';

interface SyndicateExportModalProps {
  opportunities: MarketOpportunity[];
  matches: UpcomingMatchItem[];
  onClose: () => void;
}

export const SyndicateExportModal: React.FC<SyndicateExportModalProps> = ({
  opportunities,
  matches,
  onClose,
}) => {
  const downloadCSV = () => {
    const headers = [
      'Match ID',
      'Kickoff Time',
      'Competition',
      'Home Team',
      'Away Team',
      'Market Type',
      'Selection',
      'Model Win Prob (%)',
      'Model Fair Odds',
      'Consensus Bookmaker Odds',
      'Market Edge (%)',
      'Expected Value Unit',
      'Quarter Kelly (%)',
      'Half Kelly (%)',
      'Full Kelly (%)',
      'Data Quality',
    ];

    const rows = opportunities.map((opp) => [
      opp.matchId,
      opp.kickoffTime,
      `"${opp.competition}"`,
      `"${opp.homeTeam}"`,
      `"${opp.awayTeam}"`,
      opp.marketType,
      `"${opp.selectionLabel}"`,
      Math.round(opp.modelProbability * 100),
      opp.modelFairOdds.toFixed(2),
      opp.bookmakerOdds.toFixed(2),
      `+${opp.edgePercent}%`,
      opp.expectedValueUnit.toFixed(3),
      `${opp.quarterKellyPercent}%`,
      `${opp.halfKellyPercent}%`,
      `${Math.round(opp.kellyStakeFraction * 1000) / 10}%`,
      opp.dataQuality,
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `KickProphet_Syndicate_Report_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4 overflow-y-auto print:p-0 print:bg-white">
      <div className="relative w-full max-w-3xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl p-6 print:border-none print:shadow-none print:bg-white print:text-black">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-800 print:border-black">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 print:hidden">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white print:text-black">
                Matchday Syndicate Briefing Dossier
              </h2>
              <p className="text-xs text-slate-400 print:text-gray-600">
                Institutional quantitative predictions, Poisson xG expectations & Kelly bankroll allocations.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 print:hidden cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Preview */}
        <div className="mt-5 space-y-4 max-h-[60vh] overflow-y-auto pr-1 text-xs">
          <div className="grid grid-cols-3 gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800/80 print:bg-gray-50 print:border-gray-300">
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Total Opportunities</span>
              <span className="text-lg font-bold font-mono text-emerald-400 print:text-emerald-700">
                {opportunities.length}
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Model Framework</span>
              <span className="text-sm font-semibold text-slate-200 print:text-black">
                Dixon-Coles & Poisson
              </span>
            </div>
            <div>
              <span className="text-[10px] text-slate-500 uppercase block">Simulation Runs</span>
              <span className="text-sm font-semibold text-slate-200 print:text-black">
                10,000 Monte Carlo
              </span>
            </div>
          </div>

          <div className="border border-slate-800 rounded-xl overflow-hidden print:border-gray-300">
            <table className="w-full text-left">
              <thead className="bg-slate-900/80 text-[11px] text-slate-400 font-semibold border-b border-slate-800 print:bg-gray-100 print:text-black">
                <tr>
                  <th className="p-2.5">Fixture</th>
                  <th className="p-2.5">Pick</th>
                  <th className="p-2.5 font-mono">Model Prob</th>
                  <th className="p-2.5 font-mono">Bookmaker</th>
                  <th className="p-2.5 font-mono text-emerald-400 print:text-emerald-700">Edge %</th>
                  <th className="p-2.5 font-mono">Kelly (Half)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-slate-300 print:divide-gray-200 print:text-black">
                {opportunities.slice(0, 15).map((opp) => (
                  <tr key={opp.id} className="hover:bg-slate-900/30">
                    <td className="p-2.5 font-sans font-medium text-white print:text-black">
                      {opp.homeTeam} vs {opp.awayTeam}
                    </td>
                    <td className="p-2.5 font-sans">{opp.selectionLabel}</td>
                    <td className="p-2.5">{Math.round(opp.modelProbability * 100)}%</td>
                    <td className="p-2.5">{opp.bookmakerOdds.toFixed(2)}</td>
                    <td className="p-2.5 text-emerald-400 font-bold print:text-emerald-700">+{opp.edgePercent}%</td>
                    <td className="p-2.5 text-slate-400">{opp.halfKellyPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {opportunities.length > 15 && (
            <p className="text-center text-[11px] text-slate-500 italic">
              Showing first 15 of {opportunities.length} edges. Complete records included in CSV download.
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between print:hidden">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-white transition cursor-pointer"
          >
            Close
          </button>
          <div className="flex items-center gap-2.5">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print Dossier</span>
            </button>
            <button
              onClick={downloadCSV}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition cursor-pointer shadow-lg"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download CSV File</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
