import React, { useState, useEffect } from 'react';
import { Star, Shield, Calendar, ArrowRight, Trash2, Search, Bell } from 'lucide-react';

interface TeamItem {
  id: number;
  canonicalName: string;
  shortName: string;
  country: string;
}

interface MatchItem {
  id: number;
  homeTeam: string;
  awayTeam: string;
  kickoffTime: string;
  competitionName: string;
  status: string;
  homeScoreFullTime?: number | null;
  awayScoreFullTime?: number | null;
}

export const FavouritesView: React.FC<{
  teamsList: TeamItem[];
  allMatches: MatchItem[];
  onSelectMatch?: (match: MatchItem) => void;
}> = ({ teamsList, allMatches, onSelectMatch }) => {
  const [favouriteTeamIds, setFavouriteTeamIds] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem('pitchintel_favourite_teams');
      return saved ? JSON.parse(saved) : [1, 2]; // Default Arsenal & Chelsea
    } catch {
      return [1, 2];
    }
  });

  const [searchClub, setSearchClub] = useState<string>('');

  useEffect(() => {
    try {
      localStorage.setItem('pitchintel_favourite_teams', JSON.stringify(favouriteTeamIds));
    } catch (e) {
      console.warn('Failed to save favourites', e);
    }
  }, [favouriteTeamIds]);

  const toggleFavourite = (id: number) => {
    setFavouriteTeamIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const favouriteTeams = teamsList.filter((t) => favouriteTeamIds.includes(t.id));
  const favouriteNamesLower = new Set(
    favouriteTeams.flatMap((t) => [
      t.canonicalName.toLowerCase(),
      t.shortName.toLowerCase(),
    ])
  );

  // Filter fixtures involving favourite teams
  const trackedMatches = allMatches.filter(
    (m) =>
      favouriteNamesLower.has(m.homeTeam.toLowerCase()) ||
      favouriteNamesLower.has(m.awayTeam.toLowerCase())
  );

  const searchedClubs = teamsList.filter(
    (t) =>
      searchClub &&
      (t.canonicalName.toLowerCase().includes(searchClub.toLowerCase()) ||
        t.shortName.toLowerCase().includes(searchClub.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 p-5 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs">
            <Star className="w-4 h-4 fill-emerald-400" />
            <span>MY TRACKED CLUBS &amp; FIXTURE RADAR</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Favourites Watchlist</h2>
          <p className="text-xs text-slate-400">
            Pin your favourite worldwide football clubs to track their kickoffs, predictions, and live match alerts.
          </p>
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
          <input
            type="text"
            value={searchClub}
            onChange={(e) => setSearchClub(e.target.value)}
            placeholder="Add club to favourites..."
            className="pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-64"
          />
          {searchClub && searchedClubs.length > 0 && (
            <div className="absolute right-0 top-11 w-64 bg-slate-950 border border-slate-800 rounded-xl p-2 shadow-2xl z-20 space-y-1 max-h-48 overflow-y-auto">
              {searchedClubs.slice(0, 5).map((club) => (
                <button
                  key={club.id}
                  onClick={() => {
                    toggleFavourite(club.id);
                    setSearchClub('');
                  }}
                  className="w-full text-left p-2 hover:bg-slate-900 rounded-lg text-xs flex items-center justify-between group cursor-pointer"
                >
                  <span className="text-white group-hover:text-emerald-400 font-medium">
                    {club.canonicalName}
                  </span>
                  <Star
                    className={`w-3.5 h-3.5 ${
                      favouriteTeamIds.includes(club.id)
                        ? 'fill-emerald-400 text-emerald-400'
                        : 'text-slate-500'
                    }`}
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pinned Clubs Strip */}
      <div className="bg-slate-900 p-5 rounded-2xl border border-slate-800 space-y-3">
        <div className="flex items-center justify-between text-xs font-mono text-slate-400">
          <span>Tracked Clubs ({favouriteTeams.length})</span>
          <span className="text-emerald-400">Live Sync Active</span>
        </div>

        {favouriteTeams.length === 0 ? (
          <p className="text-xs text-slate-500 py-4 text-center">
            No clubs pinned yet. Use the search bar above to track clubs.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2.5">
            {favouriteTeams.map((team) => (
              <div
                key={team.id}
                className="flex items-center gap-2 px-3 py-2 bg-slate-950 rounded-xl border border-slate-800 text-xs group"
              >
                <div className="w-5 h-5 rounded-full bg-slate-800 text-emerald-400 font-mono font-bold flex items-center justify-center text-[10px]">
                  {team.shortName.substring(0, 2).toUpperCase()}
                </div>
                <span className="font-semibold text-white">{team.canonicalName}</span>
                <span className="text-[10px] text-slate-500 font-mono">({team.country})</span>
                <button
                  onClick={() => toggleFavourite(team.id)}
                  className="ml-1 text-slate-500 hover:text-rose-400 p-0.5 cursor-pointer"
                  title="Remove from favourites"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tracked Fixtures Feed */}
      <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden shadow-xl">
        <div className="p-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs font-bold text-white uppercase tracking-wider font-mono">
            Tracked Club Matches &amp; Kickoffs
          </span>
          <span className="text-[11px] text-slate-400 font-mono">
            {trackedMatches.length} Fixtures Ingested
          </span>
        </div>

        {trackedMatches.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            No fixtures found for your pinned clubs in current database schedule.
          </div>
        ) : (
          <div className="divide-y divide-slate-800/60">
            {trackedMatches.slice(0, 15).map((m) => (
              <div
                key={m.id}
                onClick={() => onSelectMatch && onSelectMatch(m)}
                className="p-4 hover:bg-slate-800/30 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="text-[11px] font-mono text-slate-400 flex items-center gap-1.5 w-32">
                    <Calendar className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>{new Date(m.kickoffTime).toLocaleDateString()}</span>
                  </div>

                  <div className="space-y-0.5">
                    <span className="text-[10px] text-emerald-400 font-mono block">
                      {m.competitionName}
                    </span>
                    <div className="font-semibold text-white font-sans text-sm flex items-center gap-2">
                      <span>{m.homeTeam}</span>
                      <span className="text-slate-500 font-mono font-normal">vs</span>
                      <span>{m.awayTeam}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                      m.status === 'LIVE'
                        ? 'bg-rose-500/20 text-rose-400 border border-rose-500/40 animate-pulse'
                        : m.status === 'FINISHED'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-emerald-500/20 text-emerald-400'
                    }`}
                  >
                    {m.status === 'FINISHED' && m.homeScoreFullTime !== null
                      ? `${m.homeScoreFullTime} - ${m.awayScoreFullTime}`
                      : m.status}
                  </span>

                  <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-emerald-400" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
