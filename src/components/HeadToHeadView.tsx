import React, { useState, useEffect } from 'react';
import { Swords, RefreshCw, AlertCircle, Calendar, Trophy, TrendingUp, ShieldCheck } from 'lucide-react';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface TeamItem {
  id: number;
  canonicalName: string;
  shortName: string;
  country: string;
}

interface H2HData {
  teamA: TeamItem;
  teamB: TeamItem;
  h2hSummary: {
    directH2HFound: boolean;
    totalH2HMatches: number;
    homeWins: number;
    draws: number;
    awayWins: number;
    avgHomeGoals: number;
    avgAwayGoals: number;
    recentMeetings: Array<{
      date: string;
      homeScore: number;
      awayScore: number;
      homeTeamId: number;
      awayTeamId: number;
    }>;
  };
  teamAForm?: {
    pointsPerGame: number;
    goalsScoredAvg: number;
    goalsConcededAvg: number;
    cleanSheetRate: number;
    formString: string;
  };
  teamBForm?: {
    pointsPerGame: number;
    goalsScoredAvg: number;
    goalsConcededAvg: number;
    cleanSheetRate: number;
    formString: string;
  };
}

export const HeadToHeadView: React.FC<{ teamsList: TeamItem[] }> = ({ teamsList }) => {
  const [teamAId, setTeamAId] = useState<number>(teamsList[0]?.id || 1);
  const [teamBId, setTeamBId] = useState<number>(teamsList[1]?.id || 2);
  const [h2h, setH2h] = useState<H2HData | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchH2H = async (idA: number, idB: number) => {
    if (idA === idB) return;
    try {
      setLoading(true);
      setError(null);
      const json = await ErrorReportingService.fetchJson<H2HData>(
        `/api/h2h?teamA=${idA}&teamB=${idB}`,
        undefined,
        { source: 'HeadToHeadView.fetchH2H' }
      );
      setH2h(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load H2H comparison');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (teamsList.length === 0) return;
    if (!teamsList.some((t) => t.id === teamAId)) {
      setTeamAId(teamsList[0].id);
    }
    if (!teamsList.some((t) => t.id === teamBId) || teamBId === teamAId) {
      const alt = teamsList.find((t) => t.id !== teamAId) || teamsList[0];
      if (alt) setTeamBId(alt.id);
    }
  }, [teamsList]);

  useEffect(() => {
    if (teamAId && teamBId && teamAId !== teamBId) {
      fetchH2H(teamAId, teamBId);
    }
  }, [teamAId, teamBId]);

  return (
    <div className="space-y-6">
      {/* Header & Matchup Selectors */}
      <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs">
              <Swords className="w-4 h-4" />
              <span>DIRECT HISTORICAL HEAD-TO-HEAD</span>
            </div>
            <h2 className="text-xl font-bold text-white tracking-tight mt-1">
              Historical Clash &amp; Record Inspector
            </h2>
            <p className="text-xs text-slate-400">
              Query genuine past meetings, goal differentials, and venue advantages from verified historical match records.
            </p>
          </div>
        </div>

        {/* Club Selectors Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Club A (Home Perspective)</label>
            <select
              value={teamAId}
              onChange={(e) => setTeamAId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-semibold text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {teamsList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.canonicalName} ({t.country})
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Club B (Away Perspective)</label>
            <select
              value={teamBId}
              onChange={(e) => setTeamBId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm font-semibold text-slate-100 focus:outline-none focus:border-emerald-500"
            >
              {teamsList.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.canonicalName} ({t.country})
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center text-slate-400 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
          <p className="text-xs font-mono">Aggregating historical clashes and form indexes...</p>
        </div>
      ) : error ? (
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 text-center text-rose-400 space-y-2">
          <AlertCircle className="w-6 h-6 mx-auto" />
          <p className="text-xs">{error}</p>
        </div>
      ) : h2h ? (
        <div className="space-y-6">
          {/* Matchup Summary Card */}
          <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 space-y-6 shadow-xl">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-center text-center">
              {/* Team A */}
              <div className="space-y-2">
                <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto text-emerald-400 font-extrabold text-lg">
                  {h2h.teamA.shortName.substring(0, 3).toUpperCase()}
                </div>
                <h3 className="font-bold text-base text-white">{h2h.teamA.canonicalName}</h3>
                <span className="text-xs text-slate-400">{h2h.teamA.country}</span>
                <div className="pt-2 text-xs font-mono text-emerald-400">
                  Wins: <span className="font-bold text-sm">{h2h.h2hSummary.homeWins}</span>
                </div>
              </div>

              {/* Center VS / Clash Ratio */}
              <div className="space-y-3 bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
                <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest block">
                  Total Direct Matches
                </span>
                <span className="text-3xl font-extrabold font-mono text-white">
                  {h2h.h2hSummary.totalH2HMatches}
                </span>
                <div className="text-xs font-mono text-amber-400">
                  Draws: <span className="font-bold">{h2h.h2hSummary.draws}</span>
                </div>
                <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden flex">
                  <div
                    className="bg-emerald-500 h-full"
                    style={{
                      width: `${
                        h2h.h2hSummary.totalH2HMatches > 0
                          ? (h2h.h2hSummary.homeWins / h2h.h2hSummary.totalH2HMatches) * 100
                          : 33
                      }%`,
                    }}
                  />
                  <div
                    className="bg-amber-500 h-full"
                    style={{
                      width: `${
                        h2h.h2hSummary.totalH2HMatches > 0
                          ? (h2h.h2hSummary.draws / h2h.h2hSummary.totalH2HMatches) * 100
                          : 34
                      }%`,
                    }}
                  />
                  <div
                    className="bg-cyan-500 h-full"
                    style={{
                      width: `${
                        h2h.h2hSummary.totalH2HMatches > 0
                          ? (h2h.h2hSummary.awayWins / h2h.h2hSummary.totalH2HMatches) * 100
                          : 33
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Team B */}
              <div className="space-y-2">
                <div className="w-16 h-16 rounded-2xl bg-slate-950 border border-slate-800 flex items-center justify-center mx-auto text-cyan-400 font-extrabold text-lg">
                  {h2h.teamB.shortName.substring(0, 3).toUpperCase()}
                </div>
                <h3 className="font-bold text-base text-white">{h2h.teamB.canonicalName}</h3>
                <span className="text-xs text-slate-400">{h2h.teamB.country}</span>
                <div className="pt-2 text-xs font-mono text-cyan-400">
                  Wins: <span className="font-bold text-sm">{h2h.h2hSummary.awayWins}</span>
                </div>
              </div>
            </div>

            {/* Performance Indicators */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4 border-t border-slate-800/80">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 text-center">
                <span className="text-[10px] text-slate-400 block font-mono">Avg Goals / Match</span>
                <span className="text-base font-bold text-white font-mono">
                  {(h2h.h2hSummary.avgHomeGoals + h2h.h2hSummary.avgAwayGoals).toFixed(2)}
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 text-center">
                <span className="text-[10px] text-slate-400 block font-mono">{h2h.teamA.shortName} Form</span>
                <span className="text-base font-bold text-emerald-400 font-mono">
                  {h2h.teamAForm?.formString || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 text-center">
                <span className="text-[10px] text-slate-400 block font-mono">{h2h.teamB.shortName} Form</span>
                <span className="text-base font-bold text-cyan-400 font-mono">
                  {h2h.teamBForm?.formString || 'N/A'}
                </span>
              </div>
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800/80 text-center">
                <span className="text-[10px] text-slate-400 block font-mono">Evidence Integrity</span>
                <span className="text-base font-bold text-emerald-400 font-mono">Verified DB</span>
              </div>
            </div>
          </div>

          {/* Past Meetings Ledger */}
          <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
            <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
              <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                Recent Direct Head-to-Head Encounters
              </span>
              <span className="text-[11px] text-slate-400 font-mono">
                {h2h.h2hSummary.recentMeetings.length} Recorded Clashes
              </span>
            </div>

            {h2h.h2hSummary.recentMeetings.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No direct head-to-head match records found between these clubs in database.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {h2h.h2hSummary.recentMeetings.map((m, idx) => (
                  <div key={idx} className="p-4 flex items-center justify-between hover:bg-slate-800/30 text-xs">
                    <div className="flex items-center gap-2 text-slate-400 font-mono text-[11px]">
                      <Calendar className="w-3.5 h-3.5 text-slate-500" />
                      <span>{new Date(m.date).toLocaleDateString()}</span>
                    </div>

                    <div className="flex items-center gap-3 font-semibold font-sans">
                      <span className={m.homeTeamId === h2h.teamA.id ? 'text-white' : 'text-slate-300'}>
                        {m.homeTeamId === h2h.teamA.id ? h2h.teamA.shortName : h2h.teamB.shortName}
                      </span>
                      <span className="px-2.5 py-1 bg-slate-950 border border-slate-800 rounded font-mono font-bold text-white">
                        {m.homeScore} - {m.awayScore}
                      </span>
                      <span className={m.awayTeamId === h2h.teamB.id ? 'text-white' : 'text-slate-300'}>
                        {m.awayTeamId === h2h.teamB.id ? h2h.teamB.shortName : h2h.teamA.shortName}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};
