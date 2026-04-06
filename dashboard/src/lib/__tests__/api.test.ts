import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '../api';

describe('apiFetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined for 204 responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        statusText: 'No Content',
        headers: new Headers(),
        json: vi.fn(),
      }),
    );

    await expect(apiFetch<void>('/tokens', { method: 'DELETE' })).resolves.toBeUndefined();
  });
});
