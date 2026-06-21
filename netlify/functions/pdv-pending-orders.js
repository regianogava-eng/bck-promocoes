const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type"
};

const PDV_QUEUE_STORE = "bck-pdv-queue";
const BIBI_ORDERS_STORE = "bck-bibi-orders";
const SITE_ORDERS_STORE = "bck-orders";
const DEFAULT_SYNC_START_AT = "2026-06-20T00:00:00-03:00";
const FINAL_STATUSES = new Set(["RECEBIDO", "IMPRESSO", "FINALIZADO", "CANCELADO", "ERRO"]);

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  const auth = authorizePdv(event);
  if (!auth.ok) {
    return json(auth.statusCode, { ok: false, error: auth.error });
  }

  const limitRaw = Number(event.queryStringParameters?.limit || 25);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.round(limitRaw), 1), 50) : 25;

  try {
    const [queueOrders, bibiOrders, siteOrders] = await Promise.all([
      readQueueOrders(limit),
      readSourceOrders(BIBI_ORDERS_STORE, bibiOrderToPdvOrder, limit),
      readSourceOrders(SITE_ORDERS_STORE, siteOrderToPdvOrder, limit)
    ]);

    const byId = new Map();
    for (const order of [...queueOrders, ...bibiOrders, ...siteOrders]) {
      if (order?.id && !byId.has(order.id)) {
        byId.set(order.id, order);
      }
    }

    const orders = [...byId.values()]
      .filter(isPendingForPdv)
      .sort((a, b) => String(a.receivedAt || a.createdAt || "").localeCompare(String(b.receivedAt || b.createdAt || "")))
      .slice(0, limit);

    return json(200, {
      ok: true,
      count: orders.length,
      syncStartAt: syncStartAtIso(),
      orders
    });
  } catch (error) {
    console.error("BCK_PDV_PENDING_ERROR", JSON.stringify({
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
    return json(500, { ok: false, error: "pdv_queue_unavailable" });
  }
};

async function readQueueOrders(limit) {
  const store = await getBlobStore(PDV_QUEUE_STORE);
  const listed = await store.list({ prefix: "pending/" });
  return readListedOrders(store, listed, (order) => order, limit);
}

async function readSourceOrders(storeName, mapper, limit) {
  const store = await getBlobStore(storeName);
  const listed = await store.list({ prefix: "orders/" });
  return readListedOrders(store, listed, mapper, limit);
}

async function readListedOrders(store, listed, mapper, limit) {
  const blobs = Array.isArray(listed?.blobs) ? listed.blobs : [];
  const orders = [];

  for (const blob of blobs.slice(0, Math.max(limit * 4, limit))) {
    const key = blob.key || blob.name;
    if (!key) continue;

    try {
      const record = await store.get(key, { consistency: "strong", type: "json" });
      const order = record ? mapper(record) : null;
      if (order?.id) {
        orders.push(order);
      }
    } catch (error) {
      console.error("BCK_PDV_PENDING_READ_ERROR", JSON.stringify({
        key,
        message: error?.message || String(error)
      }));
    }
  }

  return orders;
}

function bibiOrderToPdvOrder(order = {}) {
  const now = new Date().toISOString();
  const warnings = Array.isArray(order.review?.warnings) ? order.review.warnings : [];
  const rawSummary = String(order.rawSummary || "").trim();
  const notes = [
    "PEDIDO BIBI - VALORES A CONFERIR",
    rawSummary,
    order.notes ? `Obs: ${order.notes}` : "",
    warnings.length ? `Conferir: ${warnings.join(" | ")}` : ""
  ].filter(Boolean).join("\n");

  return {
    id: String(order.id || ""),
    source: "BIBI",
    origin: "BIBI",
    origem: "BIBI",
    createdAt: order.createdAt || now,
    receivedAt: order.receivedAt || order.createdAt || now,
    customer: {
      name: order.customer?.name || "CLIENTE BIBI",
      phone: order.customer?.phone || "",
      address: order.delivery?.address || "",
      notes
    },
    items: Array.isArray(order.items) && order.items.length
      ? order.items.map((item, index) => bibiItemToPdvItem(item, index))
      : [fallbackReviewItem(rawSummary)],
    payment: paymentTextFromBibi(order),
    paymentInstructions: paymentTextFromBibi(order),
    totals: {
      subtotal: 0,
      deliveryFee: 0,
      total: 0,
      pricingPending: true,
      currency: "BRL"
    },
    review: {
      required: true,
      owner: "equipe_bck",
      warnings: uniqueList([
        "VALORES A CONFERIR",
        "NAO FINALIZAR SEM CONFERIR COM O CLIENTE",
        ...warnings
      ])
    },
    pdv: {
      requiresPriceReview: true,
      printHeader: "PEDIDO BIBI - CONFERIR",
      sourceStore: BIBI_ORDERS_STORE
    },
    pdvSync: {
      ...(order.pdvSync || {}),
      status: order.pdvSync?.status || "NOVO",
      queuedAt: order.pdvSync?.queuedAt || now
    },
    bibiOrder: order
  };
}

function bibiItemToPdvItem(item = {}, index) {
  const title = String(item.summary || item.raw || `Item ${index + 1}`).trim() || `Item ${index + 1}`;
  return {
    id: item.id || `item-${index + 1}`,
    title,
    name: title,
    quantity: 1,
    unitPrice: 0,
    subtotal: 0,
    components: [
      "VALORES A CONFERIR",
      item.quantityAssumed ? "Quantidade assumida pela Bibi" : ""
    ].filter(Boolean),
    notes: item.needsHumanReview ? "Conferir item, tamanho, sabores, adicionais e valor." : ""
  };
}

function siteOrderToPdvOrder(order = {}) {
  const total = Number(order.total || order.totals?.total || 0);
  return {
    id: String(order.id || ""),
    source: "SITE",
    origin: "SITE",
    origem: "SITE",
    createdAt: order.createdAt || order.receivedAt || new Date().toISOString(),
    receivedAt: order.receivedAt || order.createdAt || new Date().toISOString(),
    customer: {
      name: order.customerName || order.customer?.name || "CLIENTE SITE",
      phone: order.customerPhone || order.customer?.phone || order.phone || "",
      address: order.customerAddress || order.customer?.address || "",
      notes: order.customerNotes || order.customer?.notes || ""
    },
    items: Array.isArray(order.items) && order.items.length
      ? order.items.map(siteItemToPdvItem)
      : [fallbackReviewItem("Pedido do site sem itens detalhados.")],
    payment: order.payment || "",
    totals: {
      subtotal: Number(order.subtotal || order.totals?.subtotal || total) || 0,
      deliveryFee: Number(order.deliveryFee || order.totals?.deliveryFee || 0) || 0,
      total: Number.isFinite(total) ? total : 0,
      pricingPending: false,
      currency: "BRL"
    },
    review: { required: false, warnings: [] },
    pdv: { requiresPriceReview: false, sourceStore: SITE_ORDERS_STORE },
    pdvSync: {
      ...(order.pdvSync || {}),
      status: order.pdvSync?.status || "NOVO",
      queuedAt: order.pdvSync?.queuedAt || new Date().toISOString()
    },
    siteOrder: order
  };
}

function siteItemToPdvItem(item = {}) {
  const quantity = Number(item.quantity || 0) || 1;
  const subtotal = Number(item.subtotal || 0) || 0;
  const unitPrice = Number(item.unitPrice || item.price || (subtotal > 0 ? subtotal / quantity : 0)) || 0;
  return {
    id: item.id || "",
    title: item.title || item.name || "Item do site",
    name: item.title || item.name || "Item do site",
    quantity,
    unitPrice,
    subtotal: subtotal || unitPrice * quantity,
    components: Array.isArray(item.components) ? item.components : [],
    notes: item.notes || ""
  };
}

function fallbackReviewItem(text) {
  return {
    id: "item-1",
    title: "Pedido recebido para conferencia",
    name: "Pedido recebido para conferencia",
    quantity: 1,
    unitPrice: 0,
    subtotal: 0,
    components: ["VALORES A CONFERIR"],
    notes: text || "Conferir pedido antes de finalizar."
  };
}

function isPendingForPdv(order = {}) {
  if (!isAfterSyncStart(order)) return false;
  const status = String(order.pdvSync?.status || order.status || "").toUpperCase();
  if (FINAL_STATUSES.has(status)) return false;
  if (String(order.status || "").toLowerCase().includes("cancel")) return false;
  if (order.pdvSync?.pdvPedidoId && status !== "NOVO") return false;
  return true;
}

function isAfterSyncStart(order = {}) {
  const startedAt = Date.parse(syncStartAtIso());
  if (!Number.isFinite(startedAt)) return true;
  const orderAt = Date.parse(order.receivedAt || order.createdAt || "");
  return Number.isFinite(orderAt) && orderAt >= startedAt;
}

function syncStartAtIso() {
  return process.env.BCK_PDV_SYNC_START_AT || DEFAULT_SYNC_START_AT;
}

function paymentTextFromBibi(order = {}) {
  const label = order.payment?.label || "";
  const method = order.payment?.method || "";
  const changeFor = order.payment?.changeFor || "";
  const base = label || method;
  return changeFor ? `${base || "DINHEIRO"} - troco para ${changeFor}` : base || "A CONFERIR";
}

function authorizePdv(event) {
  const expected = process.env.PDV_SYNC_TOKEN || process.env.BCK_PDV_SYNC_TOKEN || "";
  if (!expected) {
    return { ok: false, statusCode: 503, error: "sync_token_not_configured" };
  }

  const authHeader = event.headers?.authorization || event.headers?.Authorization || "";
  const headerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const queryToken = String(event.queryStringParameters?.token || "").trim();
  const token = headerToken || queryToken;

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

function uniqueList(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))];
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}
