import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { ErrorReportingService } from '../services/errorReporting.ts';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected application error',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('PitchIntel UI ErrorBoundary caught:', error, info.componentStack);
    ErrorReportingService.reportApiFailure({
      source: 'ReactErrorBoundary',
      endpoint: typeof window !== 'undefined' ? window.location.pathname : '/',
      method: 'UI',
      statusCode: 0,
      error,
      context: info.componentStack?.slice(0, 900),
    }).catch(() => {});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-2xl p-6 space-y-4 text-center shadow-2xl">
            <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto" />
            <h1 className="text-lg font-bold text-white">Interface Recovery</h1>
            <p className="text-xs text-slate-400 break-words">
              {this.state.message}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
