import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="d-flex flex-column align-items-center justify-content-center" style={{ minHeight: '60vh' }}>
          <iconify-icon icon="solar:danger-triangle-line-duotone" style={{ fontSize: 48, color: '#dc3545' }}></iconify-icon>
          <h4 className="mt-3 mb-1">Something went wrong</h4>
          <p className="text-muted mb-3">An unexpected error occurred on this page.</p>
          <div className="d-flex gap-2">
            <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <a className="btn btn-light" href="/admin/dashboard">Go to Dashboard</a>
          </div>
          {import.meta.env.DEV && (
            <pre className="mt-4 p-3 bg-light rounded small text-danger" style={{ maxWidth: 600, overflowX: 'auto' }}>
              {this.state.error.toString()}
              {'\n'}
              {this.state.error.stack}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
