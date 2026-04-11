import { useCallback, useEffect, useRef, useState } from 'react';

// Shared data-fetching hook. Every page that does
//   const [data, setData] = useState(...)
//   const [loading, setLoading] = useState(true)
//   const [error, setError] = useState<string | null>(null)
//   useEffect(() => { let cancelled = false; fetch... setData }, [deps])
// has the same four bugs waiting to happen: forgotten cancellation, leaked
// state updates after unmount, no refresh handle, and the three useStates
// drifting out of sync. `useAsyncData` folds all of that into one hook.
//
// The hook is deliberately tiny — no retry, no cache, no dedupe — because
// the dashboard has a handful of independent fetches and heavier machinery
// (react-query, SWR) would be overkill. If a call site needs one of those
// features later, use the library directly at that site.

export interface UseAsyncDataResult<T> {
  /** The last successfully loaded value, or null until the first load settles. */
  data: T | null;
  /** True while a load is in flight. Starts true on mount. */
  loading: boolean;
  /** Error message from the most recent failed load, or null. */
  error: string | null;
  /** Trigger a fresh load that replaces `data`/`error` when it settles. */
  refresh: () => void;
}

/**
 * Run `loader` on mount and whenever `deps` change. Tracks loading/error
 * state, cancels stale in-flight requests (via both `AbortSignal` and an
 * internal sequence counter), and exposes a `refresh` handle.
 *
 * `loader` receives an `AbortSignal` that is aborted when the effect is
 * torn down or a new load starts. Pass it to `fetch` (or similar) so the
 * network request itself is cancelled, not just its state update.
 *
 * Example:
 *   const { data, loading, error, refresh } = useAsyncData(
 *     (signal) => apiFetch<{ sources: Source[] }>('/sources', { signal }),
 *     [],
 *   );
 */
export function useAsyncData<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[]): UseAsyncDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Sequence counter defends against "load A starts, load B starts, load A
  // resolves last" — AbortController handles fetch cancellation, but a
  // non-fetch loader (e.g. a synchronous computation) can still race.
  const sequenceRef = useRef(0);
  // `deps` is a parametric dependency array; the hook intentionally forwards
  // whatever the caller passed. ESLint's exhaustive-deps rule can't inspect
  // caller deps through the indirection, so the rule is disabled one line
  // below where `useEffect` actually reads the array.
  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  const runLoad = useCallback(() => {
    const mySeq = ++sequenceRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    loaderRef
      .current(controller.signal)
      .then((value) => {
        if (controller.signal.aborted || mySeq !== sequenceRef.current) return;
        setData(value);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted || mySeq !== sequenceRef.current) return;
        const message = err instanceof Error ? err.message : String(err);
        // DOMException from an aborted fetch surfaces as `AbortError` —
        // treat it as a silent cancellation, not a real load failure.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(message);
        setLoading(false);
      });

    return controller;
  }, []);

  useEffect(() => {
    const controller = runLoad();
    return () => {
      sequenceRef.current++;
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  const refresh = useCallback(() => {
    runLoad();
  }, [runLoad]);

  return { data, loading, error, refresh };
}
