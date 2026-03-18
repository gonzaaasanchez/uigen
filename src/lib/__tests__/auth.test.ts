import { test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mockCookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

const mockSign = vi.fn();
const mockSignJWTInstance = {
  setProtectedHeader: vi.fn().mockReturnThis(),
  setExpirationTime: vi.fn().mockReturnThis(),
  setIssuedAt: vi.fn().mockReturnThis(),
  sign: mockSign,
};
vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  SignJWT: vi.fn(() => mockSignJWTInstance),
}));

import { getSession, createSession, deleteSession, verifySession } from "@/lib/auth";
import { jwtVerify, SignJWT } from "jose";

const mockJwtVerify = vi.mocked(jwtVerify);
const mockSignJWT = vi.mocked(SignJWT); // used in createSession tests

beforeEach(() => {
  vi.clearAllMocks();
});

test("getSession returns null when no cookie is present", async () => {
  mockCookieStore.get.mockReturnValue(undefined);

  const session = await getSession();

  expect(session).toBeNull();
  expect(mockJwtVerify).not.toHaveBeenCalled();
});

test("getSession returns null when jwtVerify throws", async () => {
  mockCookieStore.get.mockReturnValue({ value: "invalid.token" });
  mockJwtVerify.mockRejectedValue(new Error("invalid signature"));

  const session = await getSession();

  expect(session).toBeNull();
});

test("getSession returns the payload when token is valid", async () => {
  const payload = { userId: "user-1", email: "alice@example.com", expiresAt: new Date() };
  mockCookieStore.get.mockReturnValue({ value: "valid.token" });
  mockJwtVerify.mockResolvedValue({ payload } as any);

  const session = await getSession();

  expect(session).toEqual(payload);
});

test("getSession reads the auth-token cookie", async () => {
  mockCookieStore.get.mockReturnValue(undefined);

  await getSession();

  expect(mockCookieStore.get).toHaveBeenCalledWith("auth-token");
});

test("getSession passes the token to jwtVerify", async () => {
  mockCookieStore.get.mockReturnValue({ value: "some.jwt.token" });
  mockJwtVerify.mockResolvedValue({ payload: { userId: "u1", email: "x@x.com" } } as any);

  await getSession();

  const [calledToken] = mockJwtVerify.mock.calls[0];
  expect(calledToken).toBe("some.jwt.token");
});

// createSession

test("createSession signs a JWT and sets the auth-token cookie", async () => {
  mockSign.mockResolvedValue("signed.token");

  await createSession("user-1", "alice@example.com");

  expect(mockSignJWT).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "user-1", email: "alice@example.com" })
  );
  expect(mockSignJWTInstance.setProtectedHeader).toHaveBeenCalledWith({ alg: "HS256" });
  expect(mockSignJWTInstance.setExpirationTime).toHaveBeenCalledWith("7d");
  expect(mockSignJWTInstance.setIssuedAt).toHaveBeenCalled();
  expect(mockCookieStore.set).toHaveBeenCalledWith(
    "auth-token",
    "signed.token",
    expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" })
  );
});

test("createSession sets cookie expiry approximately 7 days from now", async () => {
  mockSign.mockResolvedValue("signed.token");
  const before = Date.now();

  await createSession("user-2", "bob@example.com");

  const after = Date.now();
  const [, , options] = mockCookieStore.set.mock.calls[0];
  const expiresMs = (options.expires as Date).getTime();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  expect(expiresMs).toBeGreaterThanOrEqual(before + sevenDaysMs - 1000);
  expect(expiresMs).toBeLessThanOrEqual(after + sevenDaysMs + 1000);
});

// deleteSession

test("deleteSession deletes the auth-token cookie", async () => {
  await deleteSession();

  expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
});

// verifySession

test("verifySession returns null when no auth-token cookie is present", async () => {
  const request = new NextRequest("http://localhost/api/test");

  const result = await verifySession(request);

  expect(result).toBeNull();
  expect(mockJwtVerify).not.toHaveBeenCalled();
});

test("verifySession returns null when jwtVerify throws", async () => {
  const request = new NextRequest("http://localhost/api/test", {
    headers: { cookie: "auth-token=bad.token" },
  });
  mockJwtVerify.mockRejectedValue(new Error("invalid"));

  const result = await verifySession(request);

  expect(result).toBeNull();
});

test("verifySession returns the payload for a valid token", async () => {
  const payload = { userId: "u1", email: "carol@example.com", expiresAt: new Date() };
  const request = new NextRequest("http://localhost/api/test", {
    headers: { cookie: "auth-token=valid.token" },
  });
  mockJwtVerify.mockResolvedValue({ payload } as any);

  const result = await verifySession(request);

  expect(result).toEqual(payload);
});

test("verifySession passes the cookie token to jwtVerify", async () => {
  const request = new NextRequest("http://localhost/api/test", {
    headers: { cookie: "auth-token=my.jwt.token" },
  });
  mockJwtVerify.mockResolvedValue({ payload: { userId: "u1", email: "x@x.com" } } as any);

  await verifySession(request);

  const [calledToken] = mockJwtVerify.mock.calls[0];
  expect(calledToken).toBe("my.jwt.token");
});
