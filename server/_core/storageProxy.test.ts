import express from "express";
import type { AddressInfo } from "net";
import { Readable } from "stream";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerStorageProxy } from "./storageProxy";
import { createContext } from "./context";
import { getProjectById, getProjectFileByStorageKey, getProjectMember } from "../db";
import { storageGetObject } from "../storage";

vi.mock("./context", () => ({ createContext: vi.fn() }));
vi.mock("../db", () => ({
  getProjectById: vi.fn(),
  getProjectFileByStorageKey: vi.fn(),
  getProjectMember: vi.fn(),
}));
vi.mock("../storage", () => ({ storageGetObject: vi.fn() }));

async function requestStorage(path: string): Promise<{ status: number; body: string }> {
  const app = express();
  registerStorageProxy(app);
  const server = app.listen(0);
  const port = (server.address() as AddressInfo).port;
  try {
    const resp = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: resp.status, body: await resp.text() };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("storage proxy authorization", () => {
  it("requires a logged-in user", async () => {
    vi.mocked(createContext).mockResolvedValue({ req: {} as never, res: {} as never, user: null });

    const resp = await requestStorage("/storage/projects/p1/files/a.txt");

    expect(resp.status).toBe(401);
    expect(vi.mocked(storageGetObject)).not.toHaveBeenCalled();
  });

  it("blocks users who are not project members", async () => {
    vi.mocked(createContext).mockResolvedValue({ req: {} as never, res: {} as never, user: { id: 9 } as never });
    vi.mocked(getProjectFileByStorageKey).mockResolvedValue({ projectId: "p1" } as never);
    vi.mocked(getProjectById).mockResolvedValue({ id: "p1", createdBy: 1 } as never);
    vi.mocked(getProjectMember).mockResolvedValue(undefined);

    const resp = await requestStorage("/storage/projects/p1/files/a.txt");

    expect(resp.status).toBe(403);
    expect(vi.mocked(storageGetObject)).not.toHaveBeenCalled();
  });

  it("streams the object for the project creator", async () => {
    vi.mocked(createContext).mockResolvedValue({ req: {} as never, res: {} as never, user: { id: 1 } as never });
    vi.mocked(getProjectFileByStorageKey).mockResolvedValue({ projectId: "p1" } as never);
    vi.mocked(getProjectById).mockResolvedValue({ id: "p1", createdBy: 1 } as never);
    vi.mocked(storageGetObject).mockResolvedValue({
      body: Readable.from(["hello"]),
      contentType: "text/plain",
      contentLength: 5,
    });

    const resp = await requestStorage("/storage/projects/p1/files/a.txt");

    expect(resp.status).toBe(200);
    expect(resp.body).toBe("hello");
    expect(vi.mocked(storageGetObject)).toHaveBeenCalledWith("projects/p1/files/a.txt");
  });
});
