import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router';
import { apiFetch } from '../lib/api';
import type { Report } from '../lib/types';
import { TypeBadge } from '../components/TypeBadge';
import { StatusBadge } from '../components/StatusBadge';
import { EmptyState } from '../components/EmptyState';

type FilterType = 'all' | 'daily' | 'flash' | 'pulse';
const FILTERS: FilterType[] = ['all', 'daily', 'flash', 'pulse'];
const PAGE_SIZE = 20;

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ReportList() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterType>('all');
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const fetchReports = useCallback(
    async (offset: number, append: boolean) => {
      const typeParam = filter !== 'all' ? `&type=${filter}` : '';
      const res = await apiFetch<{ reports: Report[] }>(
        `/reports?limit=${PAGE_SIZE}&offset=${offset}${typeParam}`,
      );
      if (append) {
        setReports((prev) => [...prev, ...res.reports]);
      } else {
        setReports(res.reports);
      }
      setHasMore(res.reports.length === PAGE_SIZE);
    },
    [filter],
  );

  useEffect(() => {
    setLoading(true);
    fetchReports(0, false).finally(() => setLoading(false));
  }, [fetchReports]);

  const loadMore = async () => {
    setLoadingMore(true);
    await fetchReports(reports.length, true);
    setLoadingMore(false);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h1 className="font-heading text-2xl text-text-primary">Reports</h1>

      {/* Filter Pills */}
      <div className="flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 py-1.5 rounded-full font-mono text-xs uppercase tracking-wider transition-colors ${
              filter === f
                ? 'bg-accent text-white'
                : 'bg-surface border border-border text-text-secondary hover:text-text-primary hover:border-[#3a3a4f]'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Report Cards */}
      {loading ? (
        <div className="text-text-secondary font-body">Loading...</div>
      ) : reports.length === 0 ? (
        <EmptyState
          title="No reports yet"
          description="Your first report will generate after sources are configured and the daily digest runs."
        />
      ) : (
        <div className="space-y-3">
          {reports.map((report) => (
            <button
              key={report.id}
              onClick={() => navigate(`/reports/${report.id}`)}
              className="w-full text-left bg-surface border border-border rounded-lg p-4 transition-all duration-[160ms] hover:-translate-y-px hover:shadow-lg hover:border-[#3a3a4f]"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <TypeBadge type={report.type} />
                  <span className="font-mono text-xs text-text-secondary">
                    {formatDate(report.date)}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {report.sentiment !== null && (
                    <span
                      className={`font-mono text-xs ${
                        report.sentiment >= 0.3
                          ? 'text-accent-green'
                          : report.sentiment <= -0.3
                            ? 'text-accent-red'
                            : 'text-text-secondary'
                      }`}
                    >
                      {report.sentiment > 0 ? '+' : ''}
                      {report.sentiment.toFixed(2)}
                    </span>
                  )}
                  <StatusBadge status={report.deliveryStatus} />
                </div>
              </div>
              <p className="text-text-primary text-sm font-body leading-relaxed line-clamp-2">
                {report.tldr}
              </p>
            </button>
          ))}
        </div>
      )}

      {/* Load More */}
      {!loading && hasMore && reports.length > 0 && (
        <div className="text-center pt-2">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="px-6 py-2 bg-surface border border-border rounded-lg text-text-secondary text-sm font-body hover:text-text-primary hover:border-[#3a3a4f] transition-colors disabled:opacity-50"
          >
            {loadingMore ? 'Loading...' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  );
}
