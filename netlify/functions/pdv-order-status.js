const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type"
};

const PDV_QUEUE_STORE = "bck-pdv-queue";
const BIBI_ORDERS_STORE = "bck-bibi-orders";
const SITE_ORDERS_STORE = "bck-orders";
const FINAL_STATUSES = new Set(["RECEBIDO", "IMPRESSO", "FINALIZADO", "CANCELADO"]);

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const auth = authorizePdv(event);
  if (!auth.ok) {
    return json(auth.statusCode, { ok: false, error: auth.error });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const orderId = String(payload.orderId || "").trim();
  const status = String(payload.status || "").trim().toUpperCase();
  if (!orderId || !status) {
    return json(422, { ok: false, error: "missing_order_id_or_status" });
  }

  try {
    const result = await updateOrderStatus({ orderId, status, payload });
    if (!result.ok) {
      return json(404, { ok: false, error: "order_not_found", orderId });
    }
    return json(200, result);
  } catch (error) {
    console.error("BCK_PDV_STATUS_ERROR", JSON.stringify({
      orderId,
      status,
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
    return json(500, { ok: false, error: "pdv_queue_unavailable" });
  }
};

async function updateOrderStatus({ orderId, status, payload }) {
  const queueResult = await updateQueueStatus({ orderId, status, payload });
  const bibiResult = await updateSourceStatus(BIBI_ORDERS_STORE, orderId, status, payload);
  const siteResult = await updateSourceStatus(SITE_ORDERS_STORE, orderId, status, payload);

  if (!queueResult.ok && !bibiResult.ok && !siteResult.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    orderId,
    status,
    queue: queueResult,
    bibi: bibiResult,
    site: siteResult
  };
}

async function updateQueueStatus({ orderId, status, payload }) {
  const store = await getBlobStore(PDV_QUEUE_STORE);
  const pendingKey = `pending/${orderId}`;
  const processedKey = `processed/${orderId}`;
  const errorKey = `errors/${orderId}`;
  const current =
    await store.get(pendingKey, { consistency: "strong", type: "json" })
    || await store.get(processedKey, { consistency: "strong", type: "json" })
    || await store.get(errorKey, { consistency: "strong", type: "json" });

  if (!current) {
    return { ok: false, store: PDV_QUEUE_STORE };
  }

  const updated = withPdvSync(current, status, payload);
  const metadata = metadataFor(updated, orderId, status);

  if (status === "ERRO") {
    await store.setJSON(errorKey, updated, { metadata });
    await store.delete(pendingKey);
    await store.delete(processedKey);
    return { ok: true, store: PDV_QUEUE_STORE, movedTo: "errors" };
  }

  if (FINAL_STATUSES.has(status)) {
    await store.setJSON(processedKey, updated, { metadata });
    await store.delete(pendingKey);
    await store.delete(errorKey);
    return { ok: true, store: PDV_QUEUE_STORE, movedTo: "processed" };
  }

  await store.setJSON(pendingKey, updated, { metadata });
  await store.delete(processedKey);
  await store.delete(errorKey);
  return { ok: true, store: PDV_QUEUE_STORE, movedTo: "pending" };
}

async function updateSourceStatus(storeName, orderId, status, payload) {
  const store = await getBlobStore(storeName);
  const key = `orders/${orderId}`;
  const current = await store.get(key, { consistency: "strong", type: "json" });
  if (!current) {
    return { ok: false, store: storeName };
  }

  const updated = withPdvSync(current, status, payload);
  await store.setJSON(key, updated, { metadata: metadataFor(updated, orderId, status) });
  return { ok: true, store: storeName, key };
}

function withPdvSync(record, status, payload) {
  const now = new Date().toISOString();
  return {
    ...record,
    updatedAt: now,
    pdvSync: {
      ...(record.pdvSync || {}),
      status,
      pdvPedidoId: payload.pdvPedidoId || record.pdvSync?.pdvPedidoId || null,
      printedAt: payload.printedAt || record.pdvSync?.printedAt || null,
      error: payload.error || "",
      updatedAt: now
    }
  };
}

function metadataFor(record, orderId, status) {
  return {
    orderId,
    status,
    updatedAt: record.pdvSync?.updatedAt || new Date().toISOString(),
    pdvPedidoId: String(record.pdvSync?.pdvPedidoId || ""),
    source: String(record.source || record.origin || record.origem || "")
  };
}

function authorizePdv(event) {
  const expected = process.env.PDV_SYNC_TOKEN || process.env.BCK_PDV_SYNC_TOKEN || "";
  if (!expected) {
    return { ok: false, statusCode: 503, error: "sync_token_not_configured" };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const token = headerToken || String(event.queryStringParameters?.token || "").trim();

  if (!token || token !== expected) {
    return { ok: false, statusCode: 401, error: "unauthorized" };
  }

  return { ok: true };
}

async function getBlobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  const siteID = process.env.BCK_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BCK_BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (siteID && token) {
    return getStore({ name, consistency: "strong", siteID, token });
  }

  return getStore({ name, consistency: "strong" });
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}
