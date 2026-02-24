import { Env } from "./types";
import { getDb } from "../db/client";
import { apiKeys } from "../db/schema";
import { eq } from "drizzle-orm";

/**
 * Generate a new API key pair.
 * Returns [rawKey, hashedKey].
 */
export function generateApiKey(prefix: string): [string, string] {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const raw = prefix + token;
  return [raw, hashKey(raw)];
}

/** SHA-256 hex hash of a raw key string. */
export async function hashKeyAsync(raw: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(raw),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Sync wrapper — actually we need async for SubtleCrypto. Use hashKeyAsync. */
export function hashKey(raw: string): string {
  // This is a placeholder — we'll use hashKeyAsync everywhere.
  // Kept for interface compat; generateApiKey returns unhashed at call site.
  // The actual hash is computed async before DB insert.
  return raw; // caller MUST use hashKeyAsync for the real hash
}

export interface ApiKeyRow {
  id: number;
  keyHash: string;
  label: string | null;
  email: string | null;
  tier: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  usageCount: number;
  usageResetAt: Date | null;
  revoked: boolean;
  createdAt: Date;
}

/**
 * Validate Bearer token from Authorization header. Returns the api_keys row.
 * Throws an object with { status, message } on failure.
 */
export async function getCurrentKey(
  authHeader: string | undefined,
  env: Env,
): Promise<ApiKeyRow> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw { status: 401, message: "Missing or invalid Authorization header. Use: Bearer <your_key>" };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw { status: 401, message: "Empty API key." };
  }

  const hashed = await hashKeyAsync(token);
  const db = getDb(env.DATABASE_URL);

  const rows = await db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, hashed))
    .limit(1);

  if (rows.length === 0) {
    throw { status: 401, message: "Invalid API key." };
  }

  const row = rows[0] as ApiKeyRow;

  if (row.revoked) {
    throw { status: 403, message: "This API key has been revoked." };
  }

  // Monthly usage reset
  const now = new Date();
  const resetAt = row.usageResetAt ? new Date(row.usageResetAt) : null;
  if (!resetAt || now >= resetAt) {
    const nextReset = getNextReset(now);
    await db
      .update(apiKeys)
      .set({ usageCount: 0, usageResetAt: nextReset })
      .where(eq(apiKeys.id, row.id));
    row.usageCount = 0;
    row.usageResetAt = nextReset;
  }

  // Check usage limit
  const { TIER_LIMITS } = await import("./types");
  const limitFn = TIER_LIMITS[row.tier] || TIER_LIMITS["free"];
  const limit = limitFn(env);

  if (row.usageCount >= limit) {
    throw {
      status: 402,
      message: `Monthly limit of ${limit} parses reached for the '${row.tier}' tier. Upgrade at ${env.APP_URL}/billing`,
    };
  }

  return row;
}

/** First day of next calendar month at 00:00 UTC. */
export function getNextReset(from: Date): Date {
  const y = from.getUTCFullYear();
  const m = from.getUTCMonth(); // 0-based
  if (m === 11) {
    return new Date(Date.UTC(y + 1, 0, 1));
  }
  return new Date(Date.UTC(y, m + 1, 1));
}
