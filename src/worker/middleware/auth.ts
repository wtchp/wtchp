import { Context, Next } from "hono";
import type { Env } from "../types";

type HonoEnv = { Bindings: Env; Variables: { userId?: number; userRole?: string } };

// Simple JWT implementation for Cloudflare Workers
async function createJWT(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const body = btoa(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) }))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${header}.${body}`));
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  return `${header}.${body}.${sig}`;
}

async function verifyJWT(token: string, secret: string): Promise<Record<string, unknown> | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );

    // Decode signature
    const sig = parts[2].replace(/-/g, "+").replace(/_/g, "/");
    const sigPadded = sig + "=".repeat((4 - (sig.length % 4)) % 4);
    const sigBytes = Uint8Array.from(atob(sigPadded), (c) => c.charCodeAt(0));

    const valid = await crypto.subtle.verify(
      "HMAC", key, sigBytes, encoder.encode(`${parts[0]}.${parts[1]}`)
    );

    if (!valid) return null;

    const bodyB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const bodyPadded = bodyB64 + "=".repeat((4 - (bodyB64.length % 4)) % 4);
    const payload = JSON.parse(atob(bodyPadded));

    // Check expiry (24 hours)
    if (payload.iat && Date.now() / 1000 - payload.iat > 86400 * 7) return null;

    return payload;
  } catch {
    return null;
  }
}

// Hash password with PBKDF2
async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashArray = new Uint8Array(hash);
  const saltHex = Array.from(salt).map((b) => b.toString(16).padStart(2, "0")).join("");
  const hashHex = Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, hashHex] = stored.split(":");
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const hash = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashArray = new Uint8Array(hash);
  const computedHex = Array.from(hashArray).map((b) => b.toString(16).padStart(2, "0")).join("");
  return computedHex === hashHex;
}

// Auth middleware — optional (sets userId if token present)
export function optionalAuth() {
  return async (c: Context<HonoEnv>, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      if (payload) {
        c.set("userId", payload.id as number);
        c.set("userRole", payload.role as string);
      }
    }
    await next();
  };
}

// Auth middleware — required
export function requireAuth() {
  return async (c: Context<HonoEnv>, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Authentication required" }, 401);
    }
    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) {
      return c.json({ success: false, error: "Invalid or expired token" }, 401);
    }
    c.set("userId", payload.id as number);
    c.set("userRole", payload.role as string);
    await next();
  };
}

// Admin middleware
export function requireAdmin() {
  return async (c: Context<HonoEnv>, next: Next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ success: false, error: "Authentication required" }, 401);
    }
    const token = authHeader.slice(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload || payload.role !== "admin") {
      return c.json({ success: false, error: "Admin access required" }, 403);
    }
    c.set("userId", payload.id as number);
    c.set("userRole", "admin");
    await next();
  };
}

export { createJWT, verifyJWT, hashPassword, verifyPassword };
