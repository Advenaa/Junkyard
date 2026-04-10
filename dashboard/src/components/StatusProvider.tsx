import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiFetch } from '../lib/api';
import type { DisabledFeatureSummary, FeatureKey, StatusSnapshot } from '../lib/types';
import { useAuth } from './AuthProvider';

interface StatusContextType {
  // true while /status is in-flight or not yet attempted. Effects that depend on
  // the disabled-feature map must wait until this is false before firing, otherwise
  // they will probe an endpoint that is known to be disabled and waste a 503.
  ready: boolean;
  status: StatusSnapshot | null;
  disabledFeatures: DisabledFeatureSummary[];
  isFeatureDisabled: (feature: FeatureKey) => boolean;
  getDisabledFeature: (feature: FeatureKey) => DisabledFeatureSummary | null;
  // Promote a locally-discovered disabled feature (e.g. a slipped-through 503
  // FeatureDisabledError) into the shared map so every consumer re-renders with
  // the empty-state card even if /status lagged or failed.
  registerDisabledFeature: (entry: DisabledFeatureSummary) => void;
}

const StatusContext = createContext<StatusContextType>({
  ready: false,
  status: null,
  disabledFeatures: [],
  isFeatureDisabled: () => false,
  getDisabledFeature: () => null,
  registerDisabledFeature: () => {},
});

export function useStatus() {
  return useContext(StatusContext);
}

export function StatusProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [ready, setReady] = useState(false);
  const [discovered, setDiscovered] = useState<DisabledFeatureSummary[]>([]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setStatus(null);
      setDiscovered([]);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);
    apiFetch<StatusSnapshot>('/status')
      .then((snapshot) => {
        if (!cancelled) {
          setStatus(snapshot);
          setDiscovered([]);
        }
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      })
      .finally(() => {
        if (!cancelled) setReady(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  const disabledFeatures = useMemo<DisabledFeatureSummary[]>(() => {
    const fromStatus = status?.disabledFeatures ?? [];
    if (discovered.length === 0) return fromStatus;
    const seen = new Set(fromStatus.map((entry) => entry.feature));
    const merged = [...fromStatus];
    for (const entry of discovered) {
      if (!seen.has(entry.feature)) {
        merged.push(entry);
        seen.add(entry.feature);
      }
    }
    return merged;
  }, [status, discovered]);

  const isFeatureDisabled = useCallback(
    (feature: FeatureKey): boolean => disabledFeatures.some((entry) => entry.feature === feature),
    [disabledFeatures],
  );

  const getDisabledFeature = useCallback(
    (feature: FeatureKey): DisabledFeatureSummary | null =>
      disabledFeatures.find((entry) => entry.feature === feature) ?? null,
    [disabledFeatures],
  );

  const registerDisabledFeature = useCallback((entry: DisabledFeatureSummary) => {
    setDiscovered((current) => {
      if (current.some((existing) => existing.feature === entry.feature)) return current;
      return [...current, entry];
    });
  }, []);

  const value = useMemo<StatusContextType>(
    () => ({ ready, status, disabledFeatures, isFeatureDisabled, getDisabledFeature, registerDisabledFeature }),
    [ready, status, disabledFeatures, isFeatureDisabled, getDisabledFeature, registerDisabledFeature],
  );

  return <StatusContext.Provider value={value}>{children}</StatusContext.Provider>;
}
