import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, maybeSingle } = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: { getUser },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle }),
      }),
    }),
  }),
}));

import { authorize } from "../netlify/functions/_shared/http";

const event = (authorization?: string) => ({
  headers: authorization ? { authorization } : {},
} as never);

describe("function authentication and authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "server-only-test-key";
    getUser.mockResolvedValue({
      data: { user: { id: "123e4567-e89b-42d3-a456-426614174000" } },
      error: null,
    });
    maybeSingle.mockResolvedValue({
      data: {
        id: "123e4567-e89b-42d3-a456-426614174000",
        full_name: "Kasir",
        role: "kasir",
      },
      error: null,
    });
  });

  it("rejects requests without a bearer token before contacting Supabase", async () => {
    const result = await authorize(event(), ["admin"]);
    expect(result.response?.statusCode).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("rejects invalid tokens and roles not granted by the stored profile", async () => {
    getUser.mockResolvedValueOnce({ data: { user: null }, error: new Error("invalid token") });
    expect((await authorize(event("Bearer invalid"), ["admin"])).response?.statusCode).toBe(401);
    expect((await authorize(event("Bearer valid"), ["admin"])).response?.statusCode).toBe(403);
  });

  it("authorizes using the database profile role, not a browser-supplied role", async () => {
    const result = await authorize(event("Bearer valid"), ["kasir"]);
    expect(result.context?.profile.role).toBe("kasir");
    expect(getUser).toHaveBeenCalledWith("valid");
  });
});
