import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  error: Error | null;
  info: ErrorInfo | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error("[terax] React render failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    const message = this.state.error.stack || this.state.error.message;
    const componentStack = this.state.info?.componentStack?.trim();

    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background p-6 text-foreground">
        <div className="w-full max-w-3xl rounded-lg border border-destructive/30 bg-card p-4 shadow-sm">
          <div className="text-sm font-semibold">Terax UI crashed</div>
          <div className="mt-1 text-xs text-muted-foreground">
            The app caught a render error instead of showing a blank window.
          </div>
          <pre className="mt-4 max-h-72 overflow-auto rounded-md bg-muted p-3 text-[11px] leading-5 text-muted-foreground">
            {message}
            {componentStack ? `\n\n${componentStack}` : ""}
          </pre>
        </div>
      </div>
    );
  }
}
