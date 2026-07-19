import { assertCurrentProjectExternalOperationLease } from "../project-external-operation";

const DEFAULT_REMOTE_TIMEOUT_MS = 20_000;

/** Bound external HTTP calls so project operation leases cannot outlive hung fetches. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_REMOTE_TIMEOUT_MS
): Promise<Response> {
  // A timer heartbeat cannot protect a worker that was suspended past its
  // lease. Fence at the last possible point before every remote HTTP request.
  await assertCurrentProjectExternalOperationLease();
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  // The signal remains attached to the Response body, so a server that sends
  // headers and then stalls while streaming JSON is bounded as well.
  return fetch(input, { ...init, signal });
}
