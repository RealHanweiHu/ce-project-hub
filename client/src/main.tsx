import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";
import { registerGetPhasesForCategory } from "./lib/data";
import { getPhasesForCategory } from "./lib/sop-templates";

// Register category-aware phase resolver to avoid circular imports
registerGetPhasesForCategory(getPhasesForCategory);

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

const notifyServiceUnavailable = (error: unknown) => {
  if (typeof window === "undefined") return;
  const message = error instanceof Error ? error.message : String(error ?? "");
  window.dispatchEvent(new CustomEvent("cehub:service-unavailable", { detail: { message } }));
};

const isRecoverableConnectionError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /Failed to fetch|ERR_CONNECTION_REFUSED|NetworkError|Load failed/i.test(message);
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    if (isRecoverableConnectionError(error)) {
      notifyServiceUnavailable(error);
      console.warn("[API Query Recoverable]", error);
    } else {
      console.error("[API Query Error]", error);
    }
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    if (isRecoverableConnectionError(error)) {
      notifyServiceUnavailable(error);
      console.warn("[API Mutation Recoverable]", error);
    } else {
      console.error("[API Mutation Error]", error);
    }
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        }).catch((error) => {
          notifyServiceUnavailable(error);
          throw error;
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
