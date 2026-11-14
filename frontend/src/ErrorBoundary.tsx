import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoDashboard = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = '/app';
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 bg-[#FAF7F2] dark:bg-[#121016] text-[#211D28] dark:text-[#F5F0E8]">
          <div className="max-w-md w-full bg-white dark:bg-[#1E1B26] border border-[#E4DEC9] dark:border-white/10 rounded-2xl p-6 shadow-xl space-y-4">
            <div className="w-12 h-12 rounded-xl bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <AlertTriangle size={24} />
            </div>

            <div className="space-y-1">
              <h2 className="text-lg font-bold">Something went wrong</h2>
              <p className="text-xs text-[#6F677A] dark:text-[#A79FA4]">
                An unexpected interface error occurred. Your progress and data are safe.
              </p>
            </div>

            {this.state.error?.message && (
              <div className="p-3 rounded-lg bg-[#FAF7F2] dark:bg-[#16141D] border border-[#E4DEC9] dark:border-white/5 font-mono text-[11px] text-rose-600 dark:text-rose-400 break-words">
                {this.state.error.message}
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={this.handleRetry}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#6542C5] hover:bg-[#5233A8] text-white text-xs font-semibold shadow-sm transition-all cursor-pointer"
              >
                <RefreshCw size={14} /> Retry
              </button>
              <button
                type="button"
                onClick={this.handleGoDashboard}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-[#D8D0C5] dark:border-white/10 hover:bg-[#FAF7F2] dark:hover:bg-white/5 text-xs font-semibold transition-all cursor-pointer"
              >
                <Home size={14} /> Back to dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
