import { useEffect, useRef, useState } from "react";
import { CloudOff, Loader2, RotateCcw, Wifi } from "lucide-react";

type RecoveryState = "hidden" | "down" | "checking" | "ready";

async function pingServer(signal?: AbortSignal) {
  const response = await fetch("/", {
    method: "HEAD",
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

export function ServiceRecoveryNotice() {
  const [state, setState] = useState<RecoveryState>("hidden");
  const [message, setMessage] = useState("服务暂时不可用，正在等待恢复。");
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };

    const startPolling = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setInterval(() => {
        setState((prev) => (prev === "ready" ? prev : "checking"));
        const controller = new AbortController();
        const abort = window.setTimeout(() => controller.abort(), 2500);
        pingServer(controller.signal)
          .then(() => {
            window.clearTimeout(abort);
            clearTimer();
            setState("ready");
            setMessage("服务已恢复，可以刷新回到当前页面。");
          })
          .catch(() => {
            window.clearTimeout(abort);
            setState("down");
          });
      }, 3000);
    };

    const onUnavailable = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setMessage(detail?.message?.includes("Failed to fetch")
        ? "服务暂时不可用，正在等待恢复。"
        : "页面连接中断，正在等待服务恢复。");
      setState("down");
      startPolling();
    };

    const onOffline = () => {
      setMessage("浏览器离线，联网后可刷新继续。");
      setState("down");
    };

    const onOnline = () => {
      setMessage("网络已恢复，正在检查服务。");
      setState("checking");
      startPolling();
    };

    window.addEventListener("cehub:service-unavailable", onUnavailable);
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);

    return () => {
      clearTimer();
      window.removeEventListener("cehub:service-unavailable", onUnavailable);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (state === "hidden") return null;

  const ready = state === "ready";
  return (
    <div className="fixed bottom-4 right-4 z-[80] w-[min(360px,calc(100vw-2rem))] border border-border bg-card shadow-2xl">
      <div className="flex items-start gap-3 p-4">
        <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center ${ready ? "bg-[color:var(--success-soft)] text-[color:var(--success)]" : "bg-[color:var(--warning-soft)] text-[color:var(--warning)]"}`}>
          {ready ? <Wifi size={16} /> : state === "checking" ? <Loader2 size={16} className="animate-spin" /> : <CloudOff size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{ready ? "服务已恢复" : "连接暂时中断"}</div>
          <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{message}</div>
          {ready && (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-3 inline-flex items-center gap-1.5 bg-primary px-3 py-1.5 text-xs uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <RotateCcw size={12} />
              刷新页面
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
