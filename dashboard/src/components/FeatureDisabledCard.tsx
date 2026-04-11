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
  const reason = feature.reason ?? 'missing_env';
  const impact = formatDisablesList(feature.disables);
  const body = description ?? (impact ? `Disabled: ${impact}.` : undefined);
  const badgeText = reason === 'auth_failed' ? 'auth failed' : 'not configured';
  const inlineKicker = reason === 'auth_failed' ? 'Auth failed' : 'Not configured';
  const panelTitle =
    reason === 'auth_failed' ? (
      <p>
        This surface is powered by the <span className="font-mono text-text-primary">{feature.feature}</span> feature,
        which is disabled because the upstream API rejected{' '}
        <code className="font-mono text-text-primary">{feature.missingEnv}</code> at runtime.
      </p>
    ) : (
      <p>
        This surface is powered by the <span className="font-mono text-text-primary">{feature.feature}</span> feature,
        which is currently disabled.
      </p>
    );
  const advice =
    reason === 'auth_failed' ? (
      <>
        Verify <code className="font-mono text-text-primary">{feature.missingEnv}</code> is valid (check
        expiration/permissions) and restart to re-enable the feature.
      </>
    ) : (
      <>
        Set <code className="font-mono text-text-primary">{feature.missingEnv}</code> on the server and restart to
        restore it.
      </>
    );

  if (variant === 'inline') {
    return (
      <div
        data-testid="feature-disabled-inline"
        data-feature={feature.feature}
        data-reason={reason}
        className="rounded border border-border bg-surface-raised px-3 py-2 text-xs text-text-secondary"
      >
        <p className="font-mono uppercase tracking-wide text-[10px] text-text-secondary/80">{inlineKicker}</p>
        <p className="mt-0.5">{title}</p>
        <p className="mt-0.5 text-text-secondary/70">
          {reason === 'auth_failed' ? (
            <>
              Verify <code className="font-mono text-text-primary">{feature.missingEnv}</code> is valid (check
              expiration/permissions) and restart to re-enable the feature.
            </>
          ) : (
            <>
              Set <code className="font-mono text-text-primary">{feature.missingEnv}</code> on the server and restart to
              restore it.
            </>
          )}
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="feature-disabled-card"
      data-feature={feature.feature}
      data-reason={reason}
      className="bg-surface border border-border rounded-lg overflow-hidden"
    >
      <div className="flex items-start justify-between gap-3 px-4 py-3 border-b border-border">
        <div>
          <h2 className="font-mono text-xs uppercase tracking-wider text-text-secondary">{title}</h2>
          {body && <p className="text-text-secondary/70 text-sm font-body mt-1">{body}</p>}
        </div>
        <span className="px-2 py-1 rounded bg-border text-text-secondary text-[11px] font-mono uppercase tracking-wide">
          {badgeText}
        </span>
      </div>
      <div className="p-6 text-sm text-text-secondary">
        {panelTitle}
        <p className="mt-2">{advice}</p>
      </div>
    </div>
  );
}
