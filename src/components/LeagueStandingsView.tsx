import React, { useState, useEffect } from 'react';
import { Trophy, Shield, RefreshCw, AlertCircle, ChevronRight, TrendingUp } from 'lucide-react';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface StandingsRow {
  position: number;
  teamId: number;
  teamName: string;
  shortName: string;
  tla?: string | null;
  crest?: string | null;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
  form: Array<'W' | 'D' | 'L'>;
}

interface CompetitionStandingsResponse {
  competitionId: number;
  competitionCode: string;
  competitionName: string;
  country: string;
  seasonCode: string;
  lastUpdated: string;
  totalTeams: number;
  standings: StandingsRow[];
}

interface LeagueStandingsViewProps {
  onSelectTeam?: (teamName: string) => void;
}

const DEFAULT_LEAGUES = [
  { code: 'PL', name: 'Premier League', country: 'England' },
  { code: 'PD', name: 'La Liga', country: 'Spain' },
  { code: 'SA', name: 'Serie A', country: 'Italy' },
  { code: 'BL1', name: 'Bundesliga', country: 'Germany' },
  { code: 'FL1', name: 'Ligue 1', country: 'France' },
  { code: 'DED', name: 'Eredivisie', country: 'Netherlands' },
  { code: 'PPL', name: 'Primeira Liga', country: 'Portugal' },
  { code: 'MLS', name: 'Major League Soccer', country: 'USA' },
  { code: 'BSA', name: 'Série A', country: 'Brazil' },
  { code: 'ARG', name: 'Primera División', country: 'Argentina' },
];

const SEASONS = ['AUTO', '2025-2026', '2024-2025', '2023-2024', '2022-2023', '2021-2022'];

export const LeagueStandingsView: React.FC<LeagueStandingsViewProps> = ({ onSelectTeam }) => {
  const [leagues, setLeagues] = useState(DEFAULT_LEAGUES);
  const [selectedComp, setSelectedComp] = useState<string>('PL');
  const [selectedSeason, setSelectedSeason] = useState<string>('AUTO');
  const [data, setData] = useState<CompetitionStandingsResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ErrorReportingService.fetchJson<Array<{ code: string; name: string; country: string; totalMatches?: number }>>(
      '/api/competitions',
      undefined,
      { source: 'LeagueStandingsView.fetchCompetitions', fallbackValue: [] }
    )
      .then((list) => {
        if (Array.isArray(list) && list.length > 0) {
          const withMatches = list.filter((c) => (c.totalMatches || 0) > 0);
          if (withMatches.length > 0) {
            setLeagues(withMatches.map((c) => ({ code: c.code, name: c.name, country: c.country })));
          }
        }
      })
      .catch(() => {});
  }, []);

  const fetchStandings = async (comp: string, season: string) => {
    try {
      setLoading(true);
      setError(null);
      const query = season === 'AUTO' ? `competition=${comp}` : `competition=${comp}&season=${season}`;
      const json = await ErrorReportingService.fetchJson<CompetitionStandingsResponse>(
        `/api/standings?${query}`,
        undefined,
        { source: 'LeagueStandingsView.fetchStandings' }
      );
      setData(json);
    } catch (err: any) {
      setError(err?.message || 'Failed to load league standings');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStandings(selectedComp, selectedSeason);
  }, [selectedComp, selectedSeason]);

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 p-5 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs">
            <Trophy className="w-4 h-4" />
            <span>OFFICIAL LEAGUE TABLES &amp; FORM{data?.seasonCode ? ` · ${data.seasonCode}` : ''}</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            {data?.competitionName || 'League'} Standings
          </h2>
          <p className="text-xs text-slate-400">
            Computed from verified match results in PostgreSQL with goal differentials, points, and 5-game form.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Season Selector */}
          <select
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(e.target.value)}
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs font-semibold text-slate-200 focus:outline-none focus:border-emerald-500"
          >
            {SEASONS.map((s) => (
              <option key={s} value={s}>
                {s === 'AUTO' ? 'Latest Available Season' : `${s} Season`}
              </option>
            ))}
          </select>

          <button
            onClick={() => fetchStandings(selectedComp, selectedSeason)}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer"
            title="Refresh Standings"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* League Selection Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
        {leagues.map((l) => (
          <button
            key={l.code}
            onClick={() => setSelectedComp(l.code)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap cursor-pointer ${
              selectedComp === l.code
                ? 'bg-emerald-500 text-slate-950 font-bold border-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {l.name}
          </button>
        ))}
      </div>

      {/* Standings Table Card */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        {loading ? (
          <div className="p-12 text-center text-slate-400 space-y-3">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
            <p className="text-xs font-mono">Calculating live standings from match results...</p>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-rose-400 space-y-2">
            <AlertCircle className="w-6 h-6 mx-auto" />
            <p className="text-xs">{error}</p>
          </div>
        ) : !data || data.standings.length === 0 ? (
          <div className="p-12 text-center text-slate-400">
            <p className="text-xs">No finished matches recorded for this season yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950/70 text-slate-400 text-[11px] uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="py-3 px-3 w-10 text-center">#</th>
                  <th className="py-3 px-3">Club</th>
                  <th className="py-3 px-2 text-center" title="Matches Played">MP</th>
                  <th className="py-3 px-2 text-center" title="Wins">W</th>
                  <th className="py-3 px-2 text-center" title="Draws">D</th>
                  <th className="py-3 px-2 text-center" title="Losses">L</th>
                  <th className="py-3 px-2 text-center hidden sm:table-cell" title="Goals For">GF</th>
                  <th className="py-3 px-2 text-center hidden sm:table-cell" title="Goals Against">GA</th>
                  <th className="py-3 px-2 text-center" title="Goal Difference">GD</th>
                  <th className="py-3 px-3 text-center font-bold text-emerald-400" title="Points">Pts</th>
                  <th className="py-3 px-3 text-center hidden md:table-cell">Form (Last 5)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {data.standings.map((row) => (
                  <tr
                    key={row.teamId}
                    className="hover:bg-slate-800/40 transition-colors group cursor-pointer"
                    onClick={() => onSelectTeam && onSelectTeam(row.teamName)}
                  >
                    <td className="py-3 px-3 text-center">
                      <span
                        className={`inline-block w-5 h-5 rounded text-center leading-5 text-[10px] font-bold ${
                          row.position <= 4
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : row.position >= data.standings.length - 2
                            ? 'bg-rose-500/20 text-rose-400'
                            : 'text-slate-400'
                        }`}
                      >
                        {row.position}
                      </span>
                    </td>
                    <td className="py-3 px-3 font-sans font-semibold text-white group-hover:text-emerald-300 transition-colors flex items-center gap-2">
                      <div className="w-6 h-6 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-mono text-emerald-400 font-bold shrink-0">
                        {row.tla || row.shortName.substring(0, 3).toUpperCase()}
                      </div>
                      <span className="truncate max-w-[140px] sm:max-w-none">{row.teamName}</span>
                    </td>
                    <td className="py-3 px-2 text-center text-slate-300">{row.played}</td>
                    <td className="py-3 px-2 text-center text-slate-300 font-semibold">{row.won}</td>
                    <td className="py-3 px-2 text-center text-slate-400">{row.drawn}</td>
                    <td className="py-3 px-2 text-center text-slate-400">{row.lost}</td>
                    <td className="py-3 px-2 text-center text-slate-400 hidden sm:table-cell">{row.goalsFor}</td>
                    <td className="py-3 px-2 text-center text-slate-400 hidden sm:table-cell">{row.goalsAgainst}</td>
                    <td className="py-3 px-2 text-center font-bold">
                      <span
                        className={
                          row.goalDifference > 0
                            ? 'text-emerald-400'
                            : row.goalDifference < 0
                            ? 'text-rose-400'
                            : 'text-slate-400'
                        }
                      >
                        {row.goalDifference > 0 ? `+${row.goalDifference}` : row.goalDifference}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-center font-mono font-extrabold text-sm text-emerald-400">
                      {row.points}
                    </td>
                    <td className="py-3 px-3 text-center hidden md:table-cell">
                      <div className="flex items-center justify-center gap-1">
                        {row.form.map((res, i) => (
                          <span
                            key={i}
                            className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center ${
                              res === 'W'
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : res === 'D'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
                                : 'bg-rose-500/20 text-rose-400 border border-rose-500/40'
                            }`}
                          >
                            {res}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="p-3 bg-slate-950/60 border-t border-slate-800 text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-emerald-400 inline-block" /> Top 4 (UCL Qualification)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-rose-400 inline-block" /> Bottom 3 (Relegation Zone)
            </span>
          </div>
          <span>Updated: {data?.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : 'Live'}</span>
        </div>
      </div>
    </div>
  );
};
