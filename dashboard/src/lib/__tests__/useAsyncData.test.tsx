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

  it('retry() re-runs the loader after failure and clears error on success', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let callCount = 0;

    const { result } = renderHook(() =>
      useAsyncData(() => {
        callCount++;
        return callCount === 1 ? first.promise : second.promise;
      }, []),
    );

    await act(async () => {
      first.reject(new Error('boom'));
      await first.promise.catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.error).toBe('boom');
    expect(result.current.retryCount).toBe(0);

    await act(async () => {
      result.current.retry();
    });

    expect(result.current.loading).toBe(true);
    expect(result.current.retryCount).toBe(1);

    await act(async () => {
      second.resolve('recovered');
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.data).toBe('recovered');
    expect(result.current.error).toBeNull();
    expect(result.current.retryCount).toBe(0);
  });

  it('retry() is a no-op while loading', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    let callCount = 0;

    const { result } = renderHook(() =>
      useAsyncData(() => {
        callCount++;
        return callCount === 1 ? first.promise : second.promise;
      }, []),
    );

    await act(async () => {
      result.current.retry();
    });

    expect(callCount).toBe(1);
    expect(result.current.retryCount).toBe(0);

    await act(async () => {
      first.reject(new Error('boom'));
      await first.promise.catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });

    await act(async () => {
      result.current.retry();
    });

    expect(callCount).toBe(2);
    expect(result.current.retryCount).toBe(1);

    await act(async () => {
      result.current.retry();
    });

    expect(callCount).toBe(2);
    expect(result.current.retryCount).toBe(1);

    await act(async () => {
      second.resolve('ok');
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.data).toBe('ok');
    });
  });

  it('retry() is a no-op when there is no error', async () => {
    let callCount = 0;
    const { result } = renderHook(() =>
      useAsyncData(async () => {
        callCount++;
        return 'ok';
      }, []),
    );

    await waitFor(() => {
      expect(result.current.data).toBe('ok');
    });

    await act(async () => {
      result.current.retry();
    });

    expect(callCount).toBe(1);
    expect(result.current.retryCount).toBe(0);
    expect(result.current.error).toBeNull();
  });

  it('retryCount resets on successful load', async () => {
    const first = createDeferred<string>();
    const second = createDeferred<string>();
    const third = createDeferred<string>();
    let callCount = 0;

    const { result } = renderHook(() =>
      useAsyncData(() => {
        callCount++;
        if (callCount === 1) return first.promise;
        if (callCount === 2) return second.promise;
        return third.promise;
      }, []),
    );

    await act(async () => {
      first.reject(new Error('boom'));
      await first.promise.catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });

    await act(async () => {
      result.current.retry();
    });

    await act(async () => {
      second.resolve('recovered');
      await second.promise;
    });

    await waitFor(() => {
      expect(result.current.retryCount).toBe(0);
    });

    await act(async () => {
      result.current.refresh();
    });

    await act(async () => {
      third.resolve('fresh');
      await third.promise;
    });

    await waitFor(() => {
      expect(result.current.data).toBe('fresh');
    });
    expect(result.current.retryCount).toBe(0);
  });

  it('retry() stops after 3 consecutive failures', async () => {
    const attempts = [
      createDeferred<string>(),
      createDeferred<string>(),
      createDeferred<string>(),
      createDeferred<string>(),
    ];
    let callCount = 0;

    const { result } = renderHook(() =>
      useAsyncData(() => {
        const next = attempts[callCount];
        callCount++;
        return next.promise;
      }, []),
    );

    await act(async () => {
      attempts[0].reject(new Error('boom-1'));
      await attempts[0].promise.catch(() => {});
    });

    await waitFor(() => {
      expect(result.current.error).toBe('boom-1');
    });

    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      attempts[1].reject(new Error('boom-2'));
      await attempts[1].promise.catch(() => {});
    });
    await waitFor(() => {
      expect(result.current.error).toBe('boom-2');
    });
    expect(result.current.retryCount).toBe(1);

    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      attempts[2].reject(new Error('boom-3'));
      await attempts[2].promise.catch(() => {});
    });
    await waitFor(() => {
      expect(result.current.error).toBe('boom-3');
    });
    expect(result.current.retryCount).toBe(2);

    await act(async () => {
      result.current.retry();
    });
    await act(async () => {
      attempts[3].reject(new Error('boom-4'));
      await attempts[3].promise.catch(() => {});
    });
    await waitFor(() => {
      expect(result.current.error).toBe('boom-4');
    });
    expect(result.current.retryCount).toBe(3);
    expect(callCount).toBe(4);

    await act(async () => {
      result.current.retry();
    });

    expect(result.current.retryCount).toBe(3);
    expect(result.current.error).toBe('boom-4');
    expect(callCount).toBe(4);
  });
});
