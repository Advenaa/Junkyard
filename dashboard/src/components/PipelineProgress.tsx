import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import type { StatusSnapshot } from '../lib/types.js';
import { useStatus } from './StatusProvider.js';

type ProgressSnapshot = Pick<StatusSnapshot, 'itemsReady' | 'itemsProcessing' | 'summariesToday'>;

interface PipelineProgressProps {
  sourceCount: number;
  initialStatus?: ProgressSnapshot;
}

function pickProgressSnapshot(status: StatusSnapshot | ProgressSnapshot | null | undefined): ProgressSnapshot | null {
  if (!status) {
    return null;
  }

  return {
    itemsReady: status.itemsReady,
    itemsProcessing: status.itemsProcessing,
    summariesToday: status.summariesToday,
  };
}

function stageClasses(active: boolean): string {
  return active ? 'border-accent/30 bg-accent/10 text-text-primary' : 'border-border bg-background text-text-secondary';
}

export function PipelineProgress({ sourceCount, initialStatus }: PipelineProgressProps) {
  const { status } = useStatus();
  const [snapshot, setSnapshot] = useState<ProgressSnapshot>(() => {
    return (
      pickProgressSnapshot(initialStatus) ??
      pickProgressSnapshot(status) ?? { itemsReady: 0, itemsProcessing: 0, summariesToday: 0 }
    );
  });

  const latestSnapshot = pickProgressSnapshot(initialStatus) ?? pickProgressSnapshot(status);
  if (
    latestSnapshot &&
    (latestSnapshot.itemsReady !== snapshot.itemsReady ||
      latestSnapshot.itemsProcessing !== snapshot.itemsProcessing ||
      latestSnapshot.summariesToday !== snapshot.summariesToday)
  ) {
    setSnapshot(latestSnapshot);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadStatus() {
      try {
        const next = await apiFetch<StatusSnapshot>('/status');
        if (!cancelled) {
          setSnapshot({
            itemsReady: next.itemsReady,
            itemsProcessing: next.itemsProcessing,
            summariesToday: next.summariesToday,
          });
        }
      } catch {
        void 0;
      }
    }

    void loadStatus();
    const intervalId = window.setInterval(() => {
      void loadStatus();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  if (sourceCount === 0) {
    return null;
  }

  const ingestedCount = snapshot.itemsReady + snapshot.itemsProcessing;
  const pollingActive = ingestedCount > 0 || snapshot.summariesToday > 0;
  const processingActive = snapshot.itemsProcessing > 0 || snapshot.summariesToday > 0;
  const reportReady = snapshot.summariesToday > 0;

  return (
    <section className="rounded-2xl border border-border bg-surface p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-text-secondary">Pipeline progress</p>
          <h2 className="mt-2 font-heading text-2xl text-text-primary">Waiting for the first report</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-text-secondary">
            Podders is watching {sourceCount} source{sourceCount === 1 ? '' : 's'} and checking for enough fresh flow to
            generate the first report.
          </p>
        </div>
        <span className="rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-text-secondary">
          Live
        </span>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-5">
        <div className={`rounded-2xl border px-4 py-4 ${stageClasses(true)}`}>
          <div className="font-mono text-[11px] uppercase tracking-wide text-accent">01</div>
          <div className="mt-2 text-sm">Source added ✓</div>
        </div>
        <div className={`rounded-2xl border px-4 py-4 ${stageClasses(pollingActive)}`}>
          <div className="font-mono text-[11px] uppercase tracking-wide">02</div>
          <div className="mt-2 text-sm">Polling...</div>
        </div>
        <div className={`rounded-2xl border px-4 py-4 ${stageClasses(ingestedCount > 0 || reportReady)}`}>
          <div className="font-mono text-[11px] uppercase tracking-wide">03</div>
          <div className="mt-2 text-sm">
            {ingestedCount} item{ingestedCount === 1 ? '' : 's'} ingested
          </div>
        </div>
        <div className={`rounded-2xl border px-4 py-4 ${stageClasses(processingActive)}`}>
          <div className="font-mono text-[11px] uppercase tracking-wide">04</div>
          <div className="mt-2 text-sm">Processing...</div>
        </div>
        <div className={`rounded-2xl border px-4 py-4 ${stageClasses(reportReady)}`}>
          <div className="font-mono text-[11px] uppercase tracking-wide">05</div>
          <div className="mt-2 text-sm">First report ready</div>
        </div>
      </div>
    </section>
  );
}
