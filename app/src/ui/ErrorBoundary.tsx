import { Component, type ReactNode } from 'react';

import { Message } from './Message.tsx';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <Message>
        Something went wrong: {this.state.error.message}{' '}
        <button type="button" onClick={() => location.reload()}>
          Reload
        </button>
      </Message>
    );
  }
}
