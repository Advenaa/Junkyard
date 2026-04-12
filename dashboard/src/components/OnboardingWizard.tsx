import { useState } from 'react';
import { Link } from 'react-router';
import { apiFetch } from '../lib/api.js';

interface OnboardingWizardProps {
  onDismissed: () => void;
  onNavigateToSources: () => void;
}

const sourceCards = [
  {
    source: 'Discord',
    description: 'Track closed communities, high-signal chats, and attachment-heavy trade discussions.',
  },
  {
    source: 'Twitter/X',
    description: 'Follow fast-moving market narratives, influencer calls, and headline cascades.',
  },
  {
    source: 'RSS',
    description: 'Pull structured feeds from blogs, protocol updates, and research desks you already trust.',
  },
  {
    source: 'News',
    description: 'Layer in broader market context from news sites and cross-asset macro coverage.',
  },
] as const;

const pipelineStages = [
  {
    title: 'Collect',
    body: 'Podders polls each source on its own schedule and normalizes raw messages before they touch the pipeline.',
  },
  {
    title: 'Screen',
    body: 'Spam, duplicates, translation, and prompt-injection defenses run before any synthesis work begins.',
  },
  {
    title: 'Synthesize',
    body: 'The LLM pipeline clusters related items into summaries, then rolls them into daily, flash, and pulse reports.',
  },
  {
    title: 'Surface',
    body: 'Reports, entities, and pipeline diagnostics update in the dashboard as soon as the first cycle completes.',
  },
] as const;

export function OnboardingWizard({ onDismissed, onNavigateToSources }: OnboardingWizardProps) {
  const [step, setStep] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  async function dismiss() {
    setDismissing(true);
    try {
      await apiFetch('/onboarding/dismiss', {
        method: 'PATCH',
        body: JSON.stringify({}),
      });
      onDismissed();
    } catch {
      void 0;
    } finally {
      setDismissing(false);
    }
  }

  const isFirstStep = step === 0;
  const isLastStep = step === 2;

  return (
    <section className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="border-b border-border bg-surface-raised/60 px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-text-secondary">Onboarding</p>
            <h2 className="mt-2 font-heading text-3xl text-text-primary">
              {step === 0 ? 'Welcome to Podders' : step === 1 ? 'Add your first source' : 'What happens next'}
            </h2>
          </div>
          <span className="rounded-full border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wide text-text-secondary">
            Step {step + 1} / 3
          </span>
        </div>
      </div>

      <div className="px-6 py-6">
        {step === 0 ? (
          <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="space-y-4">
              <p className="max-w-2xl text-sm leading-7 text-text-secondary">
                Podders runs as a continuous market-intelligence engine. It ingests your sources, builds context over
                time, and turns noisy raw flow into reports that traders can actually scan.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-border bg-background px-4 py-4">
                  <div className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">24 / 7</div>
                  <div className="mt-2 text-sm text-text-primary">Continuous polling instead of one-off searches.</div>
                </div>
                <div className="rounded-xl border border-border bg-background px-4 py-4">
                  <div className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">Multi-source</div>
                  <div className="mt-2 text-sm text-text-primary">
                    Discord, Twitter/X, RSS, and news in one pipeline.
                  </div>
                </div>
                <div className="rounded-xl border border-border bg-background px-4 py-4">
                  <div className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">Context first</div>
                  <div className="mt-2 text-sm text-text-primary">
                    Entities, narratives, and reports accumulate over time.
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border bg-background p-5">
              <p className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">Your first milestone</p>
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-accent/25 bg-accent/10 px-4 py-3">
                  <div className="text-sm text-text-primary">Add one source that produces useful market flow.</div>
                </div>
                <div className="rounded-xl border border-border px-4 py-3 text-sm text-text-secondary">
                  Podders will handle normalization, ingestion, and report generation from there.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-5">
            <p className="max-w-2xl text-sm leading-7 text-text-secondary">
              Start narrow. One high-signal channel, feed, or account is enough to prove the pipeline before you widen
              coverage.
            </p>
            <div className="grid gap-3 md:grid-cols-2">
              {sourceCards.map((card) => (
                <Link
                  key={card.source}
                  to="/settings?tab=sources"
                  onClick={onNavigateToSources}
                  className="group rounded-2xl border border-border bg-background px-5 py-5 transition-colors hover:border-accent/40 hover:bg-surface-raised"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="font-heading text-xl text-text-primary">{card.source}</h3>
                      <p className="mt-3 text-sm leading-6 text-text-secondary">{card.description}</p>
                    </div>
                    <span className="font-mono text-xs uppercase tracking-wide text-accent transition-transform group-hover:translate-x-0.5">
                      Open
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-4">
              <p className="text-sm leading-7 text-text-secondary">
                After your first source is live, the pipeline needs one pass to ingest, filter, and synthesize enough
                evidence for the first report.
              </p>
              <Link
                to="/settings?tab=sources"
                onClick={onNavigateToSources}
                className="inline-flex min-h-[44px] items-center rounded-full bg-accent px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white transition-colors hover:bg-accent/90"
              >
                Open source settings
              </Link>
            </div>

            <ol className="space-y-4">
              {pipelineStages.map((stage, index) => (
                <li key={stage.title} className="flex gap-4">
                  <div className="flex flex-col items-center">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full border border-accent/30 bg-accent/10 font-mono text-xs text-accent">
                      0{index + 1}
                    </div>
                    {index < pipelineStages.length - 1 ? <div className="mt-2 h-10 w-px bg-border" /> : null}
                  </div>
                  <div className="rounded-2xl border border-border bg-background px-4 py-4">
                    <h3 className="font-mono text-[11px] uppercase tracking-wide text-text-secondary">{stage.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-text-primary">{stage.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-border bg-surface-raised/40 px-6 py-4">
        <button
          type="button"
          onClick={() => void dismiss()}
          disabled={dismissing}
          className="min-h-[44px] rounded-full border border-border px-4 py-2 font-mono text-xs uppercase tracking-wider text-text-secondary transition-colors hover:text-text-primary disabled:opacity-60"
        >
          {dismissing ? 'Skipping...' : 'Skip'}
        </button>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep((current) => Math.max(0, current - 1))}
            disabled={isFirstStep}
            className="min-h-[44px] rounded-full border border-border px-4 py-2 font-mono text-xs uppercase tracking-wider text-text-secondary transition-colors hover:text-text-primary disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={() => setStep((current) => Math.min(2, current + 1))}
            disabled={isLastStep}
            className="min-h-[44px] rounded-full bg-accent px-5 py-2.5 font-mono text-xs uppercase tracking-wider text-white transition-colors hover:bg-accent/90 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </section>
  );
}
