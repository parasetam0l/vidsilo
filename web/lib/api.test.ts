import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("api client", () => {
  const fetchMock = vi.fn();
  const cookies: Record<string, string> = {};

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    // minimal cookie jar for Set-Cookie handling
    Object.assign(cookies, {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it("returns parsed JSON on 2xx", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await expect(api<{ ok: boolean }>("/api/x")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns undefined on 204", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api<void>("/api/x")).resolves.toBeUndefined();
  });

  it("throws ApiError with message on non-2xx", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(404, { error: "not_found", message: "nope" }),
    );
    const err = await api("/api/x").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).message).toBe("nope");
  });

  it("silently refreshes once on 401 and retries", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // refresh
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await expect(api<{ ok: boolean }>("/api/entries")).resolves.toEqual({ ok: true });
    // original + refresh + retry
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const calls = fetchMock.mock.calls.map((c) => c[0]);
    expect(calls[1]).toContain("/api/auth/refresh");
  });

  it("refreshes on /api/auth/me 401 (the session probe)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(200, {}))
      .mockResolvedValueOnce(jsonResponse(200, { id: 1 }));

    await expect(api("/api/auth/me")).resolves.toEqual({ id: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does NOT refresh on /api/auth/login 401 (bad credentials)", async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: "unauthorized" }));
    await expect(api("/api/auth/login", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("dedupes concurrent refreshes into a single call", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(200, {})) // one refresh
      .mockResolvedValueOnce(jsonResponse(200, { a: 1 }))
      .mockResolvedValueOnce(jsonResponse(200, { b: 2 }));

    const [a, b] = await Promise.all([
      api("/api/a"),
      api("/api/b"),
    ]);
    expect(a).toEqual({ a: 1 });
    expect(b).toEqual({ b: 2 });
    const refreshCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("/api/auth/refresh"),
    );
    expect(refreshCalls).toHaveLength(1);
  });

  it("does not retry twice when the refresh itself fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" }))
      .mockResolvedValueOnce(jsonResponse(401, { error: "unauthorized" })) // refresh fails
      .mockResolvedValueOnce(jsonResponse(200, { ok: true })); // retry must NOT happen

    await expect(api("/api/x")).rejects.toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
