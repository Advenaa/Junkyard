import type { ReactNode } from 'react';

interface RawCitationSurfaceProps {
  children: ReactNode;
}

export function RawCitationSurface({ children }: RawCitationSurfaceProps) {
  return <div className="rounded-xl border border-accent/35 bg-surface px-4 py-5 space-y-4">{children}</div>;
}
