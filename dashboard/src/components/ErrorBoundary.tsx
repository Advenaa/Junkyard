import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-surface text-text-primary gap-4">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <div className="flex gap-3">
            <button
              className="px-4 py-2 rounded bg-accent text-white text-sm hover:bg-accent/80 transition-colors"
              onClick={() => this.setState({ hasError: false })}
            >
              Try Again
            </button>
            <button
              className="px-4 py-2 rounded bg-surface-raised text-text-secondary text-sm hover:text-text-primary transition-colors"
              onClick={() => window.location.reload()}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
