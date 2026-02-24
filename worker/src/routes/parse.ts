import { Hono } from "hono";
import type { Env } from "../lib/types";
import { TIER_LIMITS } from "../lib/types";
import { getCurrentKey } from "../lib/auth";
import { getDb } from "../db/client";
import { apiKeys, parseJobs } from "../db/schema";
import { eq } from "drizzle-orm";
import { extract } from "../services/extractor";
import { parse as aiParse } from "../services/ai-parser";

const parseRouter = new Hono<{ Bindings: Env }>();

// ── In-memory IP rate limit for /demo (resets per isolate — acceptable) ──
const demoHits = new Map<string, { count: number; day: string }>();
const DEMO_LIMIT = 5;

/* ── POST /demo — try parsing without API key ─────────── */
parseRouter.post("/demo", async (c) => {
  const ip = c.req.header("cf-connecting-ip") || c.req.header("x-forwarded-for") || "unknown";
  const today = new Date().toISOString().slice(0, 10);

  let entry = demoHits.get(ip);
  if (!entry || entry.day !== today) {
    entry = { count: 0, day: today };
  }
  if (entry.count >= DEMO_LIMIT) {
    return c.json(
      {
        detail: `Demo limit reached (${DEMO_LIMIT}/day per IP). Create a free API key at POST /keys to continue.`,
      },
      429,
    );
  }
  entry.count++;
  demoHits.set(ip, entry);

  // Parse multipart form
  const formData = await c.req.formData();
  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return c.json({ detail: "Missing 'file' field." }, 400);
  }

  const maxBytes = parseInt(c.env.MAX_UPLOAD_MB || "20") * 1024 * 1024;
  const pdfBytes = await file.arrayBuffer();

  if (pdfBytes.byteLength === 0) {
    return c.json({ detail: "Empty file." }, 400);
  }
  if (pdfBytes.byteLength > maxBytes) {
    return c.json({ detail: `File exceeds ${c.env.MAX_UPLOAD_MB || 20} MB limit.` }, 413);
  }

  // Validate PDF magic bytes
  const header = new Uint8Array(pdfBytes.slice(0, 4));
  const magic = String.fromCharCode(...header);
  if (magic !== "%PDF") {
    return c.json({ detail: "File is not a valid PDF (missing %PDF header)." }, 415);
  }

  try {
    const extracted = await extract(pdfBytes);
    const [docType, resultDict] = await aiParse(extracted, c.env);

    const remaining = DEMO_LIMIT - entry.count;
    return c.json({
      document_type: docType,
      result: resultDict,
      demo: true,
      demo_remaining_today: remaining,
      upgrade:
        "Create a free key at POST /keys for 50 parses/month, or see /billing/plans to upgrade.",
    });
  } catch (e: any) {
    return c.json({ detail: `Could not parse document: ${e.message}` }, 422);
  }
});

/* ── POST /parse — authenticated PDF parsing ──────────── */
parseRouter.post("/parse", async (c) => {
  let keyRow;
  try {
    keyRow = await getCurrentKey(c.req.header("Authorization"), c.env);
  } catch (e: any) {
    return c.json({ detail: e.message }, e.status || 500);
  }

  // Get PDF bytes from file upload or URL
  let pdfBytes: ArrayBuffer;
  let filename: string | null = null;
  let sourceUrl: string | null = null;

  const contentType = c.req.header("content-type") || "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await c.req.formData();
    const file = formData.get("file");
    const url = formData.get("url");

    if (file instanceof File) {
      filename = file.name;
      pdfBytes = await file.arrayBuffer();
    } else if (typeof url === "string" && url) {
      sourceUrl = url;
      const result = await fetchUrl(url, c.env);
      pdfBytes = result.bytes;
      filename = result.filename;
    } else {
      return c.json(
        { detail: "Provide either a 'file' upload or a 'url' field." },
        422,
      );
    }
  } else {
    // Try JSON body
    const body = await c.req.json<{ url?: string }>().catch(() => ({}));
    if (body.url) {
      sourceUrl = body.url;
      const result = await fetchUrl(body.url, c.env);
      pdfBytes = result.bytes;
      filename = result.filename;
    } else {
      return c.json(
        { detail: "Provide either a 'file' upload or a 'url' field." },
        422,
      );
    }
  }

  const maxBytes = parseInt(c.env.MAX_UPLOAD_MB || "20") * 1024 * 1024;

  if (pdfBytes.byteLength === 0) {
    return c.json({ detail: "Empty file received." }, 400);
  }
  if (pdfBytes.byteLength > maxBytes) {
    return c.json(
      { detail: `File exceeds the ${c.env.MAX_UPLOAD_MB || 20} MB limit.` },
      413,
    );
  }

  // Validate PDF magic bytes
  const header = new Uint8Array(pdfBytes.slice(0, 4));
  const magic = String.fromCharCode(...header);
  if (magic !== "%PDF") {
    return c.json({ detail: "File is not a valid PDF (missing %PDF header)." }, 415);
  }

  const db = getDb(c.env.DATABASE_URL);

  // Create job row
  const [jobInsert] = await db
    .insert(parseJobs)
    .values({
      apiKeyId: keyRow.id,
      filename,
      sourceUrl,
      status: "pending",
      createdAt: new Date(),
    })
    .returning({ id: parseJobs.id });

  const jobId = jobInsert.id;

  // Extract text from PDF
  let extracted;
  try {
    extracted = await extract(pdfBytes);
  } catch (e: any) {
    await db
      .update(parseJobs)
      .set({ status: "failed", errorMessage: e.message })
      .where(eq(parseJobs.id, jobId));
    return c.json({ detail: e.message }, 400);
  }

  // AI extraction
  let docType: string;
  let resultDict: Record<string, any>;
  try {
    [docType, resultDict] = await aiParse(extracted, c.env);
  } catch (e: any) {
    await db
      .update(parseJobs)
      .set({ status: "failed", errorMessage: e.message })
      .where(eq(parseJobs.id, jobId));
    return c.json({ detail: `AI extraction failed: ${e.message}` }, 502);
  }

  // Update job + bump usage
  const now = new Date();
  await db
    .update(parseJobs)
    .set({
      status: "success",
      documentType: docType,
      pageCount: extracted.pages,
      resultJson: JSON.stringify(resultDict),
      completedAt: now,
    })
    .where(eq(parseJobs.id, jobId));

  const newUsage = (keyRow.usageCount || 0) + 1;
  await db
    .update(apiKeys)
    .set({ usageCount: newUsage })
    .where(eq(apiKeys.id, keyRow.id));

  const limitFn = TIER_LIMITS[keyRow.tier] || TIER_LIMITS["free"];
  const limit = limitFn(c.env);

  return c.json({
    job_id: jobId,
    status: "success",
    document_type: docType,
    filename,
    page_count: extracted.pages,
    result: resultDict,
    usage: { used: newUsage, limit },
  });
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const BLOCKED_PREFIXES = [
  "127.", "10.", "0.", "169.254.",
  "192.168.", "172.16.", "172.17.", "172.18.", "172.19.",
  "172.20.", "172.21.", "172.22.", "172.23.", "172.24.",
  "172.25.", "172.26.", "172.27.", "172.28.", "172.29.",
  "172.30.", "172.31.", "::1", "fc", "fd",
];

async function fetchUrl(
  url: string,
  env: Env,
): Promise<{ bytes: ArrayBuffer; filename: string | null }> {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw { status: 400, message: "URL must start with http:// or https://" };
  }

  // Note: full SSRF protection with DNS resolution isn't possible in Workers,
  // but CF Workers already block requests to internal IPs by default
  const resp = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "PDFJsonAPI/1.0" },
  });

  if (!resp.ok) {
    throw { status: 400, message: `Could not fetch URL: HTTP ${resp.status}` };
  }

  const maxBytes = parseInt(env.MAX_UPLOAD_MB || "20") * 1024 * 1024;
  const bytes = await resp.arrayBuffer();
  if (bytes.byteLength > maxBytes) {
    throw {
      status: 400,
      message: `Remote file exceeds the ${env.MAX_UPLOAD_MB || 20} MB limit.`,
    };
  }

  const path = url.split("?")[0];
  const filename = path.split("/").pop() || null;
  return { bytes, filename };
}

export default parseRouter;
