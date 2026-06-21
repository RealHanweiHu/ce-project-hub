import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function isRecoverableLoadError(error: Error | null) {
  const message = `${error?.message ?? ""}\n${error?.stack ?? ""}`;
  return /Failed to fetch|ERR_CONNECTION_REFUSED|dynamically imported module|Importing a module script failed|Loading chunk/i.test(message);
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      const recoverable = isRecoverableLoadError(this.state.error);
      return (
        <div className="flex items-center justify-center min-h-screen p-8 bg-background">
          <div className="flex flex-col items-center w-full max-w-2xl p-8">
            <AlertTriangle
              size={48}
              className="text-destructive mb-6 flex-shrink-0"
            />

            <h2 className="text-xl mb-4">{recoverable ? "页面资源暂时不可用" : "An unexpected error occurred."}</h2>

            {recoverable && (
              <p className="mb-4 max-w-md text-center text-sm text-muted-foreground">
                服务重启或网络抖动时，页面资源可能加载失败。服务恢复后点击刷新即可回到当前页面。
              </p>
            )}

            <div className="p-4 w-full rounded bg-muted overflow-auto mb-6">
              <pre className="text-sm text-muted-foreground whitespace-break-spaces">
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground",
                "hover:opacity-90 cursor-pointer"
              )}
            >
              <RotateCcw size={16} />
              {recoverable ? "刷新页面" : "Reload Page"}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
