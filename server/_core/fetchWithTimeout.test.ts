import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./fetchWithTimeout";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
  it("aborts a remote request that does not settle within the hard deadline", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );

    await expect(
      fetchWithTimeout("https://example.invalid", {}, 5)
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
