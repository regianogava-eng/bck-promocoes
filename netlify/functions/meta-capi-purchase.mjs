import { createHash } from "node:crypto";

const DEFAULT_PIXEL_ID = "746956188164996";
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.pizzariabck.com.br",
  "https://pizzariabck.com.br",
  "https://beerchicken-bck.netlify.app"
];
const MAX_BODY_BYTES = 32 * 1024;
const STORE_NAME = "bck-meta-capi-events";

export default async function metaCapiPurchase(req, context) {
  const origin = req.headers.get("origin") || "";
  const cors = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("", { status: 204, headers: cors });
  }

  if (req.method !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" }, cors);
  }

  if (!isAllowedOrigin(origin)) {
    return json(403, { ok: false, error: "origin_not_allowed" }, cors);
  }

  const contentLength = Number(req.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json(413, { ok: false, error: "payload_too_large" }, cors);
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { ok: false, error: "invalid_json" }, cors);
  }

  const validationError = validatePurchase(body);
  if (validationError) {
    return json(422, { ok: false, error: validationError }, cors);
  }

  const normalized = normalizePurchase(body);

  if (env("BCK_META_CAPI_ENABLED", "false") !== "true") {
    return json(202, {
      ok: true,
      dryRun: true,
      reason: "capi_disabled",
      event_name: "Purchase",
      event_id: normalized.event_id
    }, cors);
  }

  const accessToken = env("META_CAPI_ACCESS_TOKEN") || env("BCK_META_CAPI_ACCESS_TOKEN");
  if (!accessToken) {
    return json(503, { ok: false, error: "meta_capi_token_missing" }, cors);
  }

  const pixelId = env("META_PIXEL_ID") || env("BCK_META_PIXEL_ID") || DEFAULT_PIXEL_ID;
  const eventKey = eventStoreKey(normalized.event_id);
  const store = await getBlobStore(STORE_NAME);
  const existing = await readJSON(store, eventKey);

  if (existing?.status === "sent") {
    return json(200, {
      ok: true,
      duplicateIgnored: true,
      event_name: "Purchase",
      event_id: normalized.event_id,
      firstSentAt: existing.sentAt || null
    }, cors);
  }

  const metaEvent = buildMetaEvent(normalized, req, context);
  const graphResult = await sendToMeta({ pixelId, accessToken, metaEvent });
  const now = new Date().toISOString();
  const record = {
    status: graphResult.ok ? "sent" : "failed",
    event_name: "Purchase",
    event_id: normalized.event_id,
    order_id: normalized.order_id || "",
    value: normalized.value,
    currency: normalized.currency,
    source_url: normalized.event_source_url,
    sentAt: graphResult.ok ? now : null,
    lastAttemptAt: now,
    graphStatus: graphResult.status,
    graphResponse: scrubGraphResponse(graphResult.body)
  };

  await store.setJSON(eventKey, record, {
    metadata: {
      status: record.status,
      event_name: "Purchase",
      event_id_hash: eventHash(normalized.event_id),
      order_id: normalized.order_id || "",
      sent_at: record.sentAt || ""
    }
  });

  if (!graphResult.ok) {
    return json(502, {
      ok: false,
      error: "meta_capi_send_failed",
      event_id: normalized.event_id,
      graphStatus: graphResult.status
    }, cors);
  }

  return json(200, {
    ok: true,
    event_name: "Purchase",
    event_id: normalized.event_id,
    order_id: normalized.order_id || "",
    meta: scrubGraphResponse(graphResult.body)
  }, cors);
}

export const config = {
  path: "/api/meta-capi/purchase",
  method: ["POST", "OPTIONS"]
};

function validatePurchase(body) {
  if (!body || typeof body !== "object") return "purchase_payload_invalid";

  const eventId = String(body.event_id || body.eventID || "").trim();
  if (!eventId || eventId.length < 4 || eventId.length > 240) return "event_id_required";

  const value = Number(body.value);
  if (!Number.isFinite(value) || value < 0) return "value_invalid";

  const currency = String(body.currency || "BRL").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return "currency_invalid";

  const sourceUrl = String(body.event_source_url || "").trim();
  if (!sourceUrl || !isAllowedSourceUrl(sourceUrl)) return "event_source_url_not_allowed";

  return "";
}

function normalizePurchase(body) {
  const customData = body.custom_data && typeof body.custom_data === "object" ? body.custom_data : {};
  return {
    event_id: String(body.event_id || body.eventID || "").trim(),
    event_source_url: String(body.event_source_url || "").trim(),
    value: roundMoney(body.value),
    currency: String(body.currency || "BRL").trim().toUpperCase(),
    order_id: cleanString(body.order_id || body.transaction_id || customData.order_id || ""),
    content_ids: cleanArray(body.content_ids || customData.content_ids),
    contents: cleanContents(body.contents || customData.contents),
    content_type: cleanString(body.content_type || customData.content_type || "product"),
    content_name: cleanString(body.content_name || customData.content_name || ""),
    fbp: cleanString(body.fbp || body._fbp || ""),
    fbc: cleanString(body.fbc || body._fbc || "")
  };
}

function buildMetaEvent(purchase, req, context) {
  const userData = {
    client_user_agent: req.headers.get("user-agent") || "",
    client_ip_address: context?.ip || forwardedIp(req) || ""
  };

  if (purchase.fbp) userData.fbp = purchase.fbp;
  if (purchase.fbc) userData.fbc = purchase.fbc;

  const customData = {
    currency: purchase.currency,
    value: purchase.value,
    content_type: purchase.content_type || "product"
  };

  if (purchase.order_id) customData.order_id = purchase.order_id;
  if (purchase.content_name) customData.content_name = purchase.content_name;
  if (purchase.content_ids.length) customData.content_ids = purchase.content_ids;
  if (purchase.contents.length) customData.contents = purchase.contents;

  return {
    event_name: "Purchase",
    event_time: Math.floor(Date.now() / 1000),
    event_id: purchase.event_id,
    action_source: "website",
    event_source_url: purchase.event_source_url,
    user_data: userData,
    custom_data: customData
  };
}

async function sendToMeta({ pixelId, accessToken, metaEvent }) {
  const apiVersion = env("META_CAPI_API_VERSION", "v25.0");
  const testEventCode = env("META_CAPI_TEST_EVENT_CODE", "");
  const payload = {
    data: [metaEvent],
    access_token: accessToken
  };

  if (testEventCode) {
    payload.test_event_code = testEventCode;
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${pixelId}/events`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  let body = null;
  try {
    body = await response.json();
  } catch {
    body = { message: await response.text().catch(() => "") };
  }

  return {
    ok: response.ok,
    status: response.status,
    body
  };
}

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return allowedOrigins().includes(origin);
}

function isAllowedSourceUrl(sourceUrl) {
  try {
    const url = new URL(sourceUrl);
    return allowedOrigins().includes(url.origin);
  } catch {
    return false;
  }
}

function allowedOrigins() {
  const configured = env("BCK_META_CAPI_ALLOWED_ORIGINS", "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function corsHeaders(origin) {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store, max-age=0",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin"
  };

  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

async function getBlobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  const siteID = env("BCK_BLOBS_SITE_ID") || env("NETLIFY_SITE_ID") || env("SITE_ID");
  const token = env("BCK_BLOBS_TOKEN") || env("NETLIFY_BLOBS_TOKEN") || env("NETLIFY_AUTH_TOKEN");

  if (siteID && token) {
    return getStore({ name, consistency: "strong", siteID, token });
  }

  return getStore({ name, consistency: "strong" });
}

async function readJSON(store, key) {
  try {
    return await store.get(key, { consistency: "strong", type: "json" });
  } catch {
    return null;
  }
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

function env(name, fallback = "") {
  if (globalThis.Netlify?.env?.get) {
    return globalThis.Netlify.env.get(name) || fallback;
  }
  return process.env[name] || fallback;
}

function eventStoreKey(eventId) {
  return `purchase/${eventHash(eventId)}.json`;
}

function eventHash(eventId) {
  return createHash("sha256").update(String(eventId)).digest("hex");
}

function cleanString(value) {
  return String(value || "").trim().slice(0, 500);
}

function cleanArray(value) {
  return Array.isArray(value)
    ? value.map((item) => cleanString(item)).filter(Boolean).slice(0, 100)
    : [];
}

function cleanContents(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = cleanString(item.id || item.item_id || item.item_name || item.name || "");
      if (!id) return null;
      const quantity = Number(item.quantity || 1);
      const itemPrice = Number(item.item_price || item.price || 0);
      return {
        id,
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        item_price: Number.isFinite(itemPrice) && itemPrice >= 0 ? roundMoney(itemPrice) : 0
      };
    })
    .filter(Boolean)
    .slice(0, 100);
}

function roundMoney(value) {
  return Math.round(Number(value) * 100) / 100;
}

function forwardedIp(req) {
  return String(req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
}

function scrubGraphResponse(body) {
  if (!body || typeof body !== "object") return body;
  const clone = JSON.parse(JSON.stringify(body));
  if (clone.access_token) clone.access_token = "[removed]";
  return clone;
}
