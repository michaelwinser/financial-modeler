import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ error, info });
    // eslint-disable-next-line no-console
    console.error('Caught by ErrorBoundary:', error, info);
  }

  reload = (): void => {
    window.location.reload();
  };

  reset = (): void => {
    this.setState({ error: null, info: null });
  };

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="error-boundary">
        <div className="error-card">
          <h2>Something went wrong.</h2>
          <p className="muted">
            A component crashed. Your saved data should be intact — reloading
            usually recovers.
          </p>
          <pre className="error-detail">{this.state.error.message}</pre>
          {this.state.info?.componentStack && (
            <pre className="error-stack">
              {this.state.info.componentStack
                .split('\n')
                .slice(0, 10)
                .join('\n')}
            </pre>
          )}
          <div className="error-actions">
            <button className="btn-primary" onClick={this.reload}>
              Reload page
            </button>
            <button className="btn-ghost" onClick={this.reset}>
              Try to recover without reloading
            </button>
          </div>
        </div>
      </div>
    );
  }
}
