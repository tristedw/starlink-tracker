/**
 * Starlink Tracker - By TristEdw
 * Made by Tristan Edwards (TristEdw) - https://github.com/tristedw
 * Source: https://github.com/tristedw/starlink-tracker
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown instead of the default message, e.g. "the 3D globe". */
  label?: string;
}

interface State {
  error: Error | null;
}

/**
 * A lost WebGL context or a driver quirk shouldn't take the whole app with it.
 * Globe and map are wrapped separately so one can die while the other keeps
 * going, and you get a message rather than a blank screen.
 */
export default class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('render error', error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="fatal" role="alert">
          <h2>Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}.</h2>
          <p className="muted">{this.state.error.message}</p>
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
