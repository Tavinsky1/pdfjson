/**
 * Parser: extracts structured data from raw PDF text.
 *
 * Uses LLM-powered extraction (Groq) when configured, with automatic
 * fallback to a rule-based regex parser. Faithfully ported from Python.
 */

import type { ExtractedDocument } from "./extractor";
import type { Env } from "../lib/types";

// ─────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────

export async function parse(
  doc: ExtractedDocument,
  env: Env,
): Promise<[string, Record<string, any>]> {
  if (env.GROQ_API_KEY) {
    try {
      return await parseWithAi(doc, env);
    } catch (e: any) {
      console.warn("AI parse failed, falling back to rule-based:", e?.message || e);
    }
  }
  return parseRuleBased(doc);
}

// ─────────────────────────────────────────────────────────────
// Rule-based extraction
// ─────────────────────────────────────────────────────────────

function parseRuleBased(
  doc: ExtractedDocument,
): [string, Record<string, any>] {
  const text = doc.text;
  const docType = classify(text);

  let result: Record<string, any>;
  if (docType === "invoice") {
    result = extractInvoice(text, doc.tables);
  } else if (docType === "receipt") {
    result = extractReceipt(text, doc.tables);
  } else {
    result = extractGeneric(text, doc.tables);
  }

  result.document_type = docType;
  return [docType, result];
}

// ─────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────

const INVOICE_SIGNALS =
  /\b(invoice|inv\s*#|invoice\s*number|invoice\s*date|bill\s+to|remit\s+to|payment\s+due|purchase\s+order|net\s*\d+)\b/gi;
const RECEIPT_SIGNALS =
  /\b(receipt|thank\s+you\s+for|your\s+purchase|cashier|change\s+due|amount\s+tendered|transaction\s*#|order\s*#)\b/gi;

function classify(text: string): string {
  const sample = text.slice(0, 3000);
  const invHits = (sample.match(INVOICE_SIGNALS) || []).length;
  const recHits = (sample.match(RECEIPT_SIGNALS) || []).length;
  if (invHits === 0 && recHits === 0) return "unknown";
  return invHits >= recHits ? "invoice" : "receipt";
}

// ─────────────────────────────────────────────────────────────
// Regex helpers
// ─────────────────────────────────────────────────────────────

// Dates: 2024-01-15 / 15/01/2024 / Jan 15, 2024 / January 15 2024
const DATE_RE =
  /(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})|([A-Za-z]{3,9}\.?\s+\d{1,2},?\s+\d{4})/;

// Monetary amounts
const MONEY_RE =
  /(?:[\$£€])\s*(\d{1,3}(?:[,\.]\d{3})*(?:[,\.]\d{2})?)|(\d{1,3}(?:,\d{3})*\.\d{2})/;

// Email
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;

// Phone
const PHONE_RE = /(?:\+?\d[\d\s\-\(\)]{7,}\d)/;

// Currency
const CURRENCY_SYMBOL_MAP: Record<string, string> = {
  $: "USD",
  "£": "GBP",
  "€": "EUR",
};
const CURRENCY_RE = /(?<!\w)(USD|EUR|GBP|CAD|AUD|JPY|CHF|MXN|BRL)(?!\w)/i;

function firstMatch(pattern: RegExp, text: string): string | null {
  const m = text.match(pattern);
  if (m) {
    const val = m[0].trim();
    return val || null;
  }
  return null;
}

function findAfterLabel(
  labelPattern: string,
  text: string,
): string | null {
  const re = new RegExp(labelPattern + "[\\s:#\\-]*([^\\n]{1,80})", "i");
  const m = text.match(re);
  if (m) {
    const val = m[1].trim().replace(/[.,;]+$/, "");
    return val || null;
  }
  return null;
}

function findAmountAfterLabel(
  labelPattern: string,
  text: string,
): number | null {
  const re = new RegExp(
    labelPattern +
      "[\\s:#\\-]*[\\$£€]?\\s*(\\d{1,3}(?:[,\\.]\\d{3})*(?:[,\\.]\\d{2})?)",
    "i",
  );
  const m = text.match(re);
  if (m) {
    return toFloat(m[1]);
  }
  return null;
}

function toFloat(s: string | null | undefined): number | null {
  if (!s) return null;
  s = s.trim();
  // Handle European-style 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})+(,\d{2})?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/,/g, "");
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

function detectCurrency(text: string): string | null {
  const sample = text.slice(0, 2000);
  const m = sample.match(CURRENCY_RE);
  if (m) return m[0].toUpperCase();
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOL_MAP)) {
    if (sample.includes(sym)) return code;
  }
  return null;
}

function findDate(labelPattern: string, text: string): string | null {
  const re = new RegExp(labelPattern + "[\\s:#\\-]*([^\\n]{1,40})", "i");
  const m = text.match(re);
  if (!m) return null;
  const candidate = m[1];
  const dm = candidate.match(DATE_RE);
  if (dm) {
    const raw = (dm[1] || dm[2] || dm[3] || "").trim();
    return normaliseDate(raw);
  }
  return null;
}

function normaliseDate(raw: string): string {
  raw = raw.trim().replace(/\./g, "/");

  // Try ISO format
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // Try DD/MM/YYYY or MM/DD/YYYY
  const slashMatch = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (slashMatch) {
    let [, a, b, y] = slashMatch;
    if (y.length === 2) y = "20" + y;
    // Assume DD/MM/YYYY if first > 12
    if (parseInt(a) > 12) {
      return `${y}-${b.padStart(2, "0")}-${a.padStart(2, "0")}`;
    }
    return `${y}-${a.padStart(2, "0")}-${b.padStart(2, "0")}`;
  }

  // Try Month DD, YYYY
  const monthNames: Record<string, string> = {
    jan: "01", january: "01",
    feb: "02", february: "02",
    mar: "03", march: "03",
    apr: "04", april: "04",
    may: "05",
    jun: "06", june: "06",
    jul: "07", july: "07",
    aug: "08", august: "08",
    sep: "09", september: "09",
    oct: "10", october: "10",
    nov: "11", november: "11",
    dec: "12", december: "12",
  };
  const namedMatch = raw.match(
    /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/,
  );
  if (namedMatch) {
    const mon = monthNames[namedMatch[1].toLowerCase()];
    if (mon) {
      return `${namedMatch[3]}-${mon}-${namedMatch[2].padStart(2, "0")}`;
    }
  }

  // Try DD Month YYYY
  const revMatch = raw.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/);
  if (revMatch) {
    const mon = monthNames[revMatch[2].toLowerCase()];
    if (mon) {
      return `${revMatch[3]}-${mon}-${revMatch[1].padStart(2, "0")}`;
    }
  }

  return raw; // return as-is if we can't parse
}

// ─────────────────────────────────────────────────────────────
// Invoice extraction
// ─────────────────────────────────────────────────────────────

function extractOrgName(block: string): string | null {
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (
      trimmed.length > 3 &&
      !/^\d/.test(trimmed) &&
      !/\b(invoice|receipt|date|bill|to|from|page)\b/i.test(trimmed)
    ) {
      return trimmed;
    }
  }
  return null;
}

function extractLineItems(
  text: string,
  tables: string[][][],
): Record<string, any>[] {
  const items: Record<string, any>[] = [];

  // From tables: look for a table with ≥3 columns and header keywords
  for (const table of tables) {
    if (table.length < 2) continue;
    const header = table[0].map((c) => c.toLowerCase());
    const headerJoined = header.join(" ");
    const hasDesc = ["desc", "item", "service", "product"].some((k) =>
      headerJoined.includes(k),
    );
    const hasAmount = ["amount", "total", "price", "rate"].some((k) =>
      headerJoined.includes(k),
    );
    if (!hasDesc && !hasAmount) continue;

    for (let r = 1; r < table.length; r++) {
      const row = table[r];
      if (!row.some((c) => c)) continue;
      const item: Record<string, any> = {
        description: null,
        quantity: null,
        unit_price: null,
        total: null,
      };
      for (let i = 0; i < header.length && i < row.length; i++) {
        const col = header[i];
        const val = row[i].trim();
        if (
          col.includes("desc") ||
          col.includes("item") ||
          col.includes("service") ||
          col.includes("product")
        ) {
          item.description = val || null;
        } else if (col.includes("qty") || col.includes("quant")) {
          item.quantity = toFloat(val);
        } else if (
          col.includes("unit") ||
          col.includes("rate") ||
          col.includes("price")
        ) {
          item.unit_price = toFloat(val.replace(/[^\d.,]/g, ""));
        } else if (col.includes("amount") || col.includes("total")) {
          item.total = toFloat(val.replace(/[^\d.,]/g, ""));
        }
      }
      if (item.description || item.total) items.push(item);
    }
    if (items.length > 0) return items;
  }

  // Fallback: scan lines that look like "Description   qty   price   amount"
  const lineRe =
    /^(.+?)\s{2,}(\d+(?:\.\d+)?)\s+[\$£€]?(\d[\d.,]+)\s+[\$£€]?(\d[\d.,]+)\s*$/;
  for (const line of text.split("\n")) {
    const m = line.trim().match(lineRe);
    if (m) {
      items.push({
        description: m[1].trim(),
        quantity: toFloat(m[2]),
        unit_price: toFloat(m[3]),
        total: toFloat(m[4]),
      });
    }
  }

  return items;
}

function extractInvoice(
  text: string,
  tables: string[][][],
): Record<string, any> {
  const vendorBlock = text.slice(0, 500);
  let buyerBlock = "";
  const billToMatch = text.match(
    /(bill\s*to|sold\s*to|client|customer)[:\s]+([\s\S]*?)(?=\n\n|$)/i,
  );
  if (billToMatch) {
    buyerBlock = billToMatch[2].slice(0, 300);
  }

  return {
    vendor: {
      name: extractOrgName(vendorBlock),
      address: null,
      email: firstMatch(EMAIL_RE, vendorBlock),
      phone: firstMatch(PHONE_RE, vendorBlock),
      tax_id: findAfterLabel(
        "(?:vat|tax|gst|ein|abn)\\s*(?:id|number|no|#)?",
        vendorBlock,
      ),
    },
    buyer: {
      name: buyerBlock ? extractOrgName(buyerBlock) : null,
      address: null,
      email: buyerBlock ? firstMatch(EMAIL_RE, buyerBlock) : null,
      phone: null,
      tax_id: null,
    },
    invoice_number:
      findAfterLabel("invoice\\s*(?:number|no|#|num)?", text) ||
      findAfterLabel("inv\\s*#?", text),
    date_issued:
      findDate("invoice\\s*date", text) ||
      findDate("date\\s*(?:issued|of\\s*invoice)?", text) ||
      findDate("date", text),
    date_due:
      findDate("(?:due|payment)\\s*date", text) ||
      findDate("due\\s*by", text),
    po_number: findAfterLabel("p\\.?o\\.?\\s*(?:number|no|#)?", text),
    line_items: extractLineItems(text, tables),
    subtotal: findAmountAfterLabel("sub\\s*total", text),
    tax:
      findAmountAfterLabel("(?:vat|tax|gst|hst)\\s*(?:\\d+\\s*%)?", text) ||
      findAmountAfterLabel("tax", text),
    discount: findAmountAfterLabel("discount", text),
    total:
      findAmountAfterLabel("(?:grand\\s*)?total\\s*(?:due|amount)?", text) ||
      findAmountAfterLabel("amount\\s*due", text) ||
      findAmountAfterLabel("balance\\s*due", text),
    currency: detectCurrency(text),
    payment_terms: findAfterLabel("(?:payment\\s*)?terms?", text),
    notes: findAfterLabel("notes?|memo|remarks?", text),
  };
}

// ─────────────────────────────────────────────────────────────
// Receipt extraction
// ─────────────────────────────────────────────────────────────

function extractReceiptItems(
  text: string,
  tables: string[][][],
): Record<string, any>[] {
  const items: Record<string, any>[] = [];

  // From tables
  for (const table of tables) {
    if (table.length < 2) continue;
    for (let r = 1; r < table.length; r++) {
      const row = table[r];
      if (row.length >= 2 && row.some((c) => c)) {
        const desc = row[0].trim();
        const priceStr = row[row.length - 1].trim();
        const price = toFloat(priceStr.replace(/[^\d.,]/g, ""));
        if (desc && price !== null) {
          items.push({ description: desc, quantity: null, price });
        }
      }
    }
    if (items.length > 0) return items;
  }

  // Fallback: "Item name   $9.99" patterns
  const itemRe = /^(.{3,40}?)\s{2,}[\$£€]?\s*(\d+\.\d{2})\s*$/;
  const skipRe =
    /\b(total|subtotal|tax|tip|change|cash|card|visa|master)\b/i;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (skipRe.test(trimmed)) continue;
    const m = trimmed.match(itemRe);
    if (m) {
      items.push({
        description: m[1].trim(),
        quantity: null,
        price: parseFloat(m[2]),
      });
    }
  }

  return items;
}

function extractReceipt(
  text: string,
  tables: string[][][],
): Record<string, any> {
  const merchantBlock = text.slice(0, 400);
  const TIME_RE = /\b(\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)\b/i;

  return {
    merchant: {
      name: extractOrgName(merchantBlock),
      address: null,
      email: firstMatch(EMAIL_RE, merchantBlock),
      phone: firstMatch(PHONE_RE, merchantBlock),
    },
    date:
      findDate("date", text) || findDate("", text.slice(0, 500)),
    time: firstMatch(TIME_RE, text),
    items: extractReceiptItems(text, tables),
    subtotal: findAmountAfterLabel("sub\\s*total", text),
    tax: findAmountAfterLabel("tax", text),
    tip: findAmountAfterLabel("tip|gratuity", text),
    total:
      findAmountAfterLabel("total", text) ||
      findAmountAfterLabel("amount\\s*due", text),
    currency: detectCurrency(text),
    payment_method: findAfterLabel(
      "(?:payment\\s*method|paid\\s*(?:by|via)|card|cash)",
      text,
    ),
  };
}

// ─────────────────────────────────────────────────────────────
// Generic / unknown extraction
// ─────────────────────────────────────────────────────────────

function extractGeneric(
  text: string,
  tables: string[][][],
): Record<string, any> {
  const kvRe = /^([A-Za-z][A-Za-z\s]{1,30}?):\s*(.+)$/gm;
  const keyValues: Record<string, string> = {};
  let m: RegExpExecArray | null;
  const sample = text.slice(0, 3000);

  while ((m = kvRe.exec(sample)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    if (k.length <= 30 && v.length <= 200) {
      keyValues[k] = v;
    }
  }

  let title: string | null = null;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      title = trimmed;
      break;
    }
  }

  return {
    title,
    raw_text: text.slice(0, 2000),
    key_values: keyValues,
    tables: tables.slice(0, 3),
  };
}

// ─────────────────────────────────────────────────────────────
// AI-powered extraction (Groq LLM)
// ─────────────────────────────────────────────────────────────

async function parseWithAi(
  doc: ExtractedDocument,
  env: Env,
): Promise<[string, Record<string, any>]> {
  const textSnippet = doc.text.slice(0, 6000);
  let tableSummary = "";
  if (doc.tables.length > 0) {
    tableSummary = "\n\nDetected tables:\n";
    for (let i = 0; i < Math.min(doc.tables.length, 5); i++) {
      tableSummary += `\nTable ${i + 1}:\n`;
      for (const row of doc.tables[i].slice(0, 20)) {
        tableSummary += row.join(" | ") + "\n";
      }
    }
  }

  const system =
    "You are a document data-extraction engine. Output ONLY valid JSON. " +
    "Detect document_type as 'invoice', 'receipt', or 'unknown'. " +
    "Use null for missing fields. Monetary values must be numbers. " +
    "Dates must be YYYY-MM-DD strings.";

  const user =
    `Extract all data from this document and return structured JSON.\n\n` +
    `Document text:\n${textSnippet}${tableSummary}`;

  const model = env.GROQ_MODEL || "llama-3.3-70b-versatile";

  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 2000,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Groq API error ${resp.status}: ${body}`);
  }

  const data = (await resp.json()) as any;
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("Empty response from Groq");

  const result = JSON.parse(content);
  const docType = result.document_type || "unknown";
  return [docType, result];
}
