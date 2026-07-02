const crypto = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-BCK-Admin-Token"
};

const CONVERSATIONS_STORE = "bck-bibi-conversations";
const CONTACTS_STORE = "bck-bibi-contacts";
const SESSIONS_STORE = "bck-whatsapp-sessions";

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const auth = authorize(event);
  if (!auth.ok) {
    return json(auth.statusCode, {
      ok: false,
      error: auth.error,
      message: auth.message
    });
  }

  const params = event.queryStringParameters || {};
  const phone = onlyDigits(params.phone || "");
  const day = safeDay(params.day || "");
  const limit = clampNumber(params.limit, 1, 500, 250);

  try {
    const [events, contacts, sessions] = await Promise.all([
      readEvents({ phone, day, limit }),
      readContacts({ phone, limit: 500 }),
      readSessions({ phone, limit: 500 })
    ]);

    return json(200, {
      ok: true,
      filters: { phone: phone || null, day: day || null, limit },
      count: events.length,
      contacts,
      sessions,
      events
    });
  } catch (error) {
    console.error("BCK_BIBI_CONVERSATIONS_READ_FAILED", JSON.stringify({
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));

    return json(500, {
      ok: false,
      error: "bibi_conversations_read_failed"
    });
  }
};

async function readEvents({ phone, day, limit }) {
  const store = await getBlobStore(CONVERSATIONS_STORE);
  const prefix = day ? `events/${day}/` : "events/";
  const listed = await store.list({ prefix });
  const keys = (Array.isArray(listed?.blobs) ? listed.blobs : [])
    .map((blob) => blob.key)
    .filter((key) => !phone || key.includes(`/${phone}/`))
    .sort()
    .reverse()
    .slice(0, limit);

  const records = [];
  for (const key of keys) {
    const record = await store.get(key, { consistency: "strong", type: "json" });
    if (record) records.push({ ...record, key });
  }

  return records.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function readContacts({ phone, limit }) {
  const store = await getBlobStore(CONTACTS_STORE);
  const prefix = phone ? `contacts/${phone}` : "contacts/";
  const listed = await store.list({ prefix });
  const keys = (Array.isArray(listed?.blobs) ? listed.blobs : [])
    .map((blob) => blob.key)
    .sort()
    .reverse()
    .slice(0, limit);

  const records = [];
  for (const key of keys) {
    const record = await store.get(key, { consistency: "strong", type: "json" });
    if (record) records.push(safeContact(record));
  }

  return records.sort((a, b) => String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || "")));
}

async function readSessions({ phone, limit }) {
  const store = await getBlobStore(SESSIONS_STORE);
  const prefix = phone ? `customers/${phone}` : "customers/";
  const listed = await store.list({ prefix });
  const keys = (Array.isArray(listed?.blobs) ? listed.blobs : [])
    .map((blob) => blob.key)
    .sort()
    .reverse()
    .slice(0, limit);

  const records = [];
  for (const key of keys) {
    const record = await store.get(key, { consistency: "strong", type: "json" });
    if (record) records.push(safeSession(key, record));
  }

  return records.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function safeContact(record = {}) {
  const phone = onlyDigits(record.phone);
  return {
    phone,
    maskedPhone: maskPhone(phone),
    profileName: record.profileName || "",
    waLink: record.waLink || "",
    firstSeenAt: record.firstSeenAt || "",
    lastSeenAt: record.lastSeenAt || "",
    lastMessageType: record.lastMessageType || "",
    lastCampaignTag: record.lastCampaignTag || ""
  };
}

function safeSession(key = "", record = {}) {
  const phone = onlyDigits(key.split("/").pop() || record.phone || "");
  const data = record.data || {};
  const history = Array.isArray(data.history) ? data.history.slice(-12) : [];
  return {
    phone,
    maskedPhone: maskPhone(phone),
    state: record.state || "",
    reason: record.reason || "",
    startedAt: record.startedAt || "",
    updatedAt: record.updatedAt || "",
    expiresAt: record.expiresAt || "",
    awaitingCustomerConfirmation: Boolean(data.awaitingCustomerConfirmation),
    order: data.order || {},
    history
  };
}

function authorize(event) {
  const expected = process.env.BCK_CONVERSATIONS_TOKEN
    || process.env.BCK_NOTIFY_LOG_TOKEN
    || process.env.BCK_ADMIN_TOKEN
    || "";

  if (!expected) {
    return {
      ok: false,
      statusCode: 503,
      error: "admin_token_not_configured",
      message: "Configure BCK_CONVERSATIONS_TOKEN ou BCK_ADMIN_TOKEN no Netlify."
    };
  }

  const headers = event.headers || {};
  const params = event.queryStringParameters || {};
  const auth = headers.authorization || headers.Authorization || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const provided = bearer
    || headers["x-bck-admin-token"]
    || headers["X-BCK-Admin-Token"]
    || params.token
    || "";

  if (!provided || !timingSafeEqual(String(provided), String(expected))) {
    return {
      ok: false,
      statusCode: 403,
      error: "forbidden",
      message: "Token invalido."
    };
  }

  return { ok: true };
}

async function getBlobStore(name) {
  if (process.env.BCK_TEST_MEMORY_BLOBS === "true") {
    globalThis.__BCK_TEST_BLOBS__ = globalThis.__BCK_TEST_BLOBS__ || new Map();
    if (!globalThis.__BCK_TEST_BLOBS__.has(name)) {
      globalThis.__BCK_TEST_BLOBS__.set(name, new Map());
    }
    const bucket = globalThis.__BCK_TEST_BLOBS__.get(name);
    return {
      async get(key) {
        return bucket.has(key) ? JSON.parse(JSON.stringify(bucket.get(key))) : null;
      },
      async setJSON(key, value) {
        bucket.set(key, JSON.parse(JSON.stringify(value)));
      },
      async list(options = {}) {
        const prefix = options.prefix || "";
        const blobs = [...bucket.keys()]
          .filter((key) => !prefix || key.startsWith(prefix))
          .map((key) => ({ key, etag: `test-${key}` }));
        return { blobs };
      }
    };
  }

  const { getStore } = await import("@netlify/blobs");
  const siteID = process.env.BCK_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BCK_BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (siteID && token) {
    return getStore({ name, consistency: "strong", siteID, token });
  }

  return getStore({ name, consistency: "strong" });
}

function timingSafeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function safeDay(value = "") {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function onlyDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function maskPhone(value = "") {
  const digits = onlyDigits(value);
  if (digits.length <= 4) return digits ? "****" : "";
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function json(statusCode, data) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(data)
  };
}
