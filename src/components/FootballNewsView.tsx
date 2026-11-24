import React, { useState, useEffect } from 'react';
import { Newspaper, ExternalLink, RefreshCw, AlertCircle, Clock, ShieldCheck, Tag } from 'lucide-react';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface FootballNewsArticle {
  id: string;
  title: string;
  summary: string;
  source: string;
  category: string;
  publishedAt: string;
  retrievedAt: string;
  url: string;
}

export const FootballNewsView: React.FC = () => {
  const [articles, setArticles] = useState<FootballNewsArticle[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchFilter, setSearchFilter] = useState<string>('');

  const fetchNews = async () => {
    try {
      setLoading(true);
      setError(null);
      const json = await ErrorReportingService.fetchJson<{ articles?: FootballNewsArticle[] }>(
        '/api/news',
        undefined,
        { source: 'FootballNewsView.fetchNews' }
      );
      setArticles(json.articles || []);
    } catch (err: any) {
      setError(err?.message || 'Failed to load football news');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNews();
  }, []);

  const categories = ['ALL', 'Global & Premier League', 'European Leagues', 'Analysis & Tactical'];

  const filtered = articles.filter((a) => {
    const matchesCategory =
      selectedCategory === 'ALL' ||
      a.category.toLowerCase() === selectedCategory.toLowerCase();
    const matchesSearch =
      !searchFilter ||
      a.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      a.summary.toLowerCase().includes(searchFilter.toLowerCase()) ||
      a.source.toLowerCase().includes(searchFilter.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900 p-5 rounded-2xl border border-slate-800">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-emerald-400 font-mono text-xs">
            <Newspaper className="w-4 h-4" />
            <span>SOURCED FOOTBALL INTELLIGENCE &amp; PRESS DISPATCHES</span>
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">Verified Football News</h2>
          <p className="text-xs text-slate-400">
            Real articles from BBC Sport, Sky Sports, The Guardian, and UEFA with working publication links.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Search news &amp; keywords..."
            className="px-3 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 w-48 sm:w-60"
          />
          <button
            onClick={fetchNews}
            disabled={loading}
            className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl transition-all cursor-pointer"
            title="Refresh News Feed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setSelectedCategory(cat)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all whitespace-nowrap cursor-pointer ${
              selectedCategory === cat
                ? 'bg-emerald-500 text-slate-950 font-bold border-emerald-400 shadow-sm'
                : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* News Articles Grid */}
      {loading ? (
        <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center text-slate-400 space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto text-emerald-400" />
          <p className="text-xs font-mono">Aggregating verified football news dispatches...</p>
        </div>
      ) : error ? (
        <div className="bg-slate-900 p-8 rounded-2xl border border-slate-800 text-center text-rose-400 space-y-2">
          <AlertCircle className="w-6 h-6 mx-auto" />
          <p className="text-xs">{error}</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-900 p-12 rounded-2xl border border-slate-800 text-center text-slate-400 space-y-2">
          <p className="text-xs">No articles matching your current filter.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map((item) => (
            <article
              key={item.id}
              className="bg-slate-900 p-5 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all flex flex-col justify-between space-y-4 group shadow-md"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="px-2.5 py-0.5 rounded-full bg-slate-950 border border-slate-800 text-emerald-400 font-semibold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" />
                    {item.source}
                  </span>
                  <span className="text-slate-500 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {new Date(item.publishedAt).toLocaleDateString()}{' '}
                    {new Date(item.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <h3 className="font-bold text-base text-white group-hover:text-emerald-300 transition-colors leading-snug">
                  {item.title}
                </h3>

                <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">
                  {item.summary}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <span className="text-[11px] text-slate-400 font-mono flex items-center gap-1">
                  <Tag className="w-3 h-3 text-slate-500" />
                  {item.category}
                </span>

                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 hover:bg-emerald-500 hover:text-slate-950 text-emerald-400 font-semibold text-xs transition-colors border border-slate-800"
                >
                  <span>Read Article</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};
