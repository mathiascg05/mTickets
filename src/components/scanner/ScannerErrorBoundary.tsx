"use client";

import { Component, type ReactNode } from "react";

// Local error boundary so a crash inside the scanner shows the real
// error message instead of bubbling up to the generic "Algo salió mal"
// page — door staff have no devtools and we need them to copy the
// message back to us if something does throw on their device.
export class ScannerErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    if (typeof console !== "undefined") console.error("[scanner]", error);
  }
  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-sm w-full bg-danger/10 border border-danger/30 rounded-xl p-5 text-center space-y-3">
            <p className="text-danger font-semibold">Scanner error</p>
            <p className="text-xs text-muted break-words whitespace-pre-wrap">
              {this.state.error.message || String(this.state.error)}
            </p>
            <button
              onClick={() => this.setState({ error: null })}
              className="px-4 py-2 bg-accent hover:bg-accent-dark text-white rounded-lg font-medium text-sm"
            >
              Reintentar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
