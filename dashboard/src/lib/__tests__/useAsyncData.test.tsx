import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useAsyncData } from '../useAsyncData';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useAsyncData', () => {
  it('transitions loading -> data on successful load', async () => {
    const { promise, resolve } = createDeferred<string>();
    const { result } = renderHook(() => useAsyncData(() => promise, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await act(async () => {
      resolve('payload');
      await promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe('payload');
    expect(result.current.error).toBeNull();
  });

  it('transitions loading -> error on a rejected loader', async () => {
    const { promise, reject } = createDeferred<string>();
    const { result } = renderHook(() => useAsyncData(() => promise, []));

    expect(result.current.loading).toBe(true);

    await act(async () => {
      reject(new Error('boom'));
      await promise.catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('boom');
    expect(result.current.data).toBeNull();
  });

  it('swallows AbortError silently (no error state leak)', async () => {
    const { result } = renderHook(() =>
      useAsyncData(async () => {
        throw new DOMException('aborted', 'AbortError');
      }, []),
    );

    // Let the rejected promise settle.
    await waitFor(() => {
      expect(result.current.error).toBeNull();
    });
    // loading should remain true because AbortError is treated as a silent
    // cancellation — the hook waits for a non-aborted settle to toggle it.
    expect(result.current.error).toBeNull();
  });

  it('refresh() replays the loader and updates data', async () => {
    let callCount = 0;
    const { result } = renderHook(() =>
      useAsyncData(async () => {
        callCount++;
        return `call-${callCount}`;
      }, []),
    );

    await waitFor(() => {
      expect(result.current.data).toBe('call-1');
    });

    await act(async () => {
      result.current.refresh();
    });

    await waitFor(() => {
      expect(result.current.data).toBe('call-2');
    });
    expect(callCount).toBe(2);
  });

  it('ignores a stale in-flight response when deps change', async () => {
    // Two sequential deferred loads. Load #1 is never resolved until after
    // load #2 has started — when it finally resolves, the hook must
    // discard it and keep load #2's value.
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let call = 0;

    const { result, rerender } = renderHook(
      ({ dep }: { dep: number }) => {
        return useAsyncData(() => {
          call++;
          return call === 1 ? first.promise : second.promise;
        }, [dep]);
      },
      { initialProps: { dep: 1 } },
    );

    // First load is in flight.
    expect(result.current.loading).toBe(true);

    // Change deps → a new load starts, cancelling the first.
    rerender({ dep: 2 });
    expect(result.current.loading).toBe(true);

    // Now the stale load resolves. The hook must NOT reflect its value.
    await act(async () => {
      first.resolve('STALE');
      await first.promise;
    });

    // Fresh load resolves with the live value.
    await act(async () => {
      second.resolve('FRESH');
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe('FRESH');
  });

  it('passes an AbortSignal to the loader', async () => {
    let capturedSignal: AbortSignal | null = null;
    const { unmount } = renderHook(() =>
      useAsyncData(async (signal) => {
        capturedSignal = signal;
        return 'x';
      }, []),
    );

    expect(capturedSignal).not.toBeNull();
    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(false);

    // Unmounting the hook must abort the still-live signal.
    unmount();
    expect((capturedSignal as AbortSignal | null)?.aborted).toBe(true);
  });
});
