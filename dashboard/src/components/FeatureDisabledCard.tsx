import type { DisabledFeatureSummary } from '../lib/types';

interface FeatureDisabledCardProps {
  feature: DisabledFeatureSummary;
  title: string;
  description?: string;
  variant?: 'panel' | 'inline';
}

function formatDisablesList(disables: readonly string[]): string {
  if (disables.length === 0) return '';
  if (disables.length === 1) return disables[0]!;
  if (disables.length === 2) return `${disables[0]} and ${disables[1]}`;
  return `${disables.slice(0, -1).join(', ')}, and ${disables[disables.length - 1]}`;
}

export function FeatureDisabledCard({ feature, title, description, variant = 'panel' }: FeatureDisabledCardProps) {
  const impact = formatDisablesList(feature.disables);
  const body = description ?? (impact ? `Disabled: ${impact}.` : undefined);

  if (variant === 'inline') {
    return (
      <div
        data-testid="feature-disabled-inline"
        data-feature={feature.feature}
        className="rounded border border-border bg-surface-raised px-3 py-2 text-xs text-text-secondary"
      >
        <p className="font-mono uppercase tracking-wide text-[10px] text-text-secondary/80">Not configured</p>
        <p className="mt-0.5">{title}</p>
        <p className="mt-0.5 text-text-secondary/70">
          Set <code className="font-mono text-text-primary">{feature.missingEnv}</code> on the server to restore.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="feature-disabled-card"
      data-feature={feature.feature}
      className="bg-surface border border-border rounded-lg overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">{title}</h2>
          {body && <p className="text-text-secondary/70 text-sm font-body mt-1">{body}</p>}
        </div>
        <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
          not configured
        </span>
      </div>
      <div className="p-6 text-sm text-text-secondary">
        <p>
          This surface is powered by the <span className="font-mono text-text-primary">{feature.feature}</span> feature,
          which is currently disabled.
        </p>
        <p className="mt-2">
          Set <code className="font-mono text-text-primary">{feature.missingEnv}</code> on the server and restart to
          restore it.
        </p>
      </div>
    </div>
  );
}
