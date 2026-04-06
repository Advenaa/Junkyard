import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { EmptyState } from '../components/EmptyState';
import { TypeBadge } from '../components/TypeBadge';

type SearchScope = 'all' | 'summary' | 'report';

interface SearchResult {
  id: string;
  resultType?: 'summary' | 'report';
  source?: string | null;
  sourceId?: string | null;
  body: string;
  createdAt: number;
  reportType?: 'daily' | 'flash' | 'pulse' | null;
  date?: string | null;
  eventChains?: string[];
}

interface SearchResponse {
  results: SearchResult[];
}

const DAYS_OPTIONS = [
  { label: '7 days', value: 7 },
  { label: '14 days', value: 14 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '365 days', value: 365 },
];

const SCOPE_OPTIONS: Array<{ label: string; value: SearchScope }> = [
  { label: 'All', value: 'all' },
  { label: 'Summaries', value: 'summary' },
  { label: 'Reports', value: 'report' },
];

const SOURCE_COLORS: Record<string, string> = {
  discord: 'bg-accent/20 text-accent',
  twitter: 'bg-accent-orange/20 text-accent-orange',
  rss: 'bg-accent-green/20 text-accent-green',
  news: 'bg-border text-text-secondary',
};

function SourceBadge({ source }: { source: string }) {
  const color = SOURCE_COLORS[source] ?? 'bg-border text-text-secondary';
  return <span className={`px-2 py-0.5 rounded text-xs font-mono uppercase ${color}`}>{source}</span>;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + '...';
}

function isReportResult(result: SearchResult): boolean {
  return result.resultType === 'report';
}

export function Search() {
  const [query, setQuery] = useState('');
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState<SearchScope>('all');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (!q || loading) return;

    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const data = await apiFetch<SearchResponse>(
        `/search?q=${encodeURIComponent(q)}&limit=20&days=${days}&mode=keyword&scope=${scope}`,
      );
      setResults(data.results);
    } catch {
      setError('Search failed. Please try again.');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl text-text-primary">Search</h1>

      {/* Search form */}
      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={
            scope === 'report'
              ? 'Search reports...'
              : scope === 'summary'
                ? 'Search summaries...'
                : 'Search summaries and reports...'
          }
          className="flex-1 bg-background border border-border rounded-lg px-4 py-2.5 text-text-primary text-sm font-body placeholder:text-[#555566] focus:outline-none focus:border-accent"
        />
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as SearchScope)}
          className="bg-background border border-border rounded-lg px-3 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        >
          {SCOPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="bg-background border border-border rounded-lg px-3 py-2.5 text-text-primary text-sm font-body focus:outline-none focus:border-accent"
        >
          {DAYS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={loading || !query.trim()}
          className="px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 transition-opacity"
        >
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-400">
          <p>{error}</p>
        </div>
      )}

      {/* Results */}
      {loading ? (
        <div className="text-text-secondary font-body py-8">Searching...</div>
      ) : searched && results.length === 0 && !error ? (
        <EmptyState title="No results found" description="Try different keywords or a wider time range." />
      ) : results.length > 0 ? (
        <div className="space-y-3">
          {results.map((result) => (
            <div key={result.id} className="bg-surface border border-border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {isReportResult(result) ? (
                    <>
                      <TypeBadge type={result.reportType ?? 'report'} />
                      <span className="text-text-secondary text-xs font-mono uppercase tracking-wider">report</span>
                      {result.date && <span className="text-text-secondary text-xs font-mono">{result.date}</span>}
                    </>
                  ) : (
                    <>
                      <SourceBadge source={result.source ?? 'summary'} />
                      {result.sourceId && <span className="text-text-secondary text-xs font-mono">{result.sourceId}</span>}
                    </>
                  )}
                </div>
                <span className="text-text-secondary text-xs font-mono">{formatDate(result.createdAt)}</span>
              </div>
              <p className="text-text-primary text-sm font-body leading-relaxed">{truncate(result.body, 200)}</p>
              {isReportResult(result) && result.eventChains && result.eventChains.length > 0 && (
                <p className="text-xs font-body text-text-secondary leading-relaxed">
                  <span className="font-mono uppercase tracking-wider text-[10px] text-text-secondary/80">
                    Event Chain
                  </span>{' '}
                  {result.eventChains[0]}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
