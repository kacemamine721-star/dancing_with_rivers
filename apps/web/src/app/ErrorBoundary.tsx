import { Component, type ErrorInfo, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  /** Custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /** Change this value (e.g. the pathname) to reset after navigation. */
  resetKey?: unknown;
  onError?: (error: Error, info: ErrorInfo) => void;
}

interface State {
  error: Error | null;
}

/** Global and per-section error boundary (docs/04 §6.2-L). Sentry hook-in is optional (VITE_SENTRY_DSN). */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset();
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div role="alert" className="glass mx-auto my-16 max-w-lg p-6">
        <p className="kicker text-alert">Something went wrong</p>
        <p className="mt-2 text-ink/90">This part of the page could not be shown. The rest of the app still works.</p>
        <Button className="mt-4" onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}
