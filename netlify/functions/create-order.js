const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const DEFAULT_LOYALTY_TARGET = 8;
const DEFAULT_LOYALTY_REWARD = "Pedido gratis";

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  let order;
  try {
    order = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (!isValidOrder(order)) {
    return json(422, { ok: false, error: "invalid_order" });
  }

  const orderId = order.id || createOrderId();
  const normalizedOrder = {
    ...order,
    id: orderId,
    receivedAt: new Date().toISOString()
  };

  const loyaltyResult = await saveOrderAndUpdateLoyalty(normalizedOrder);
  if (loyaltyResult.loyalty) {
    normalizedOrder.loyalty = {
      ...(normalizedOrder.loyalty || {}),
      ...loyaltyResult.loyalty
    };
  }

  const webhookForward = await forwardToOrderWebhook(normalizedOrder);
  const whatsappNotification = await notifyStore(normalizedOrder);
  const customerLoyaltyNotification = await notifyCustomerLoyalty(normalizedOrder);

  return json(200, {
    ok: true,
    orderId,
    loyalty: normalizedOrder.loyalty || null,
    orderSaved: loyaltyResult.orderSaved,
    loyaltySaved: loyaltyResult.loyaltySaved,
    webhookForwarded: webhookForward.ok,
    whatsappNotificationSent: whatsappNotification.ok,
    customerLoyaltyNotificationSent: customerLoyaltyNotification.ok,
    notes: [
      loyaltyResult.error,
      webhookForward.error,
      whatsappNotification.error,
      customerLoyaltyNotification.error
    ].filter(Boolean)
  });
};

function isValidOrder(order) {
  return order
    && order.customer
    && order.customer.name
    && order.customer.phone
    && Array.isArray(order.items)
    && order.items.length > 0
    && order.totals
    && Number(order.totals.total) >= 0;
}

async function saveOrderAndUpdateLoyalty(order) {
  const phone = onlyDigits(order.customer.phone);
  if (!phone) {
    return { ok: false, orderSaved: false, loyaltySaved: false, error: "customer_phone_missing" };
  }

  const loyaltySettings = normalizeLoyaltySettings(order.loyalty);
  const month = orderMonth(order);
  const orderRecord = orderHistoryRecord(order, phone, month);
  const initialLoyalty = loyaltySnapshot({
    phone,
    month,
    orders: [orderRecord],
    settings: loyaltySettings,
    previousCount: 0
  });

  try {
    const ordersStore = await getBlobStore("bck-orders");
    const loyaltyStore = await getBlobStore("bck-loyalty");

    await ordersStore.setJSON(`orders/${order.id}`, orderRecord, {
      metadata: {
        phone,
        month,
        total: String(Number(order.totals.total) || 0)
      }
    });

    const loyaltyKey = `customers/${phone}/${month}`;
    const orderLedgerKey = loyaltyOrderKey(phone, month, order.id);
    const existing = await loyaltyStore.get(loyaltyKey, { consistency: "strong", type: "json" });

    await loyaltyStore.setJSON(orderLedgerKey, orderRecord, {
      metadata: {
        phone,
        month,
        orderId: order.id,
        total: String(Number(order.totals.total) || 0)
      }
    });

    const historyOrders = await collectMonthlyLoyaltyOrders({
      ordersStore,
      loyaltyStore,
      phone,
      month,
      currentOrder: orderRecord
    });
    const previousCount = Math.max(
      Number(existing?.loyalty?.purchaseCount) || 0,
      historyOrders.filter((item) => item.id !== order.id).length
    );

    const nextLoyalty = loyaltySnapshot({
      phone,
      month,
      orders: historyOrders,
      settings: loyaltySettings,
      previousCount
    });

    const history = normalizeMonthlyHistory(existing, phone, month);
    history.customerName = order.customer.name || history.customerName || "";
    history.updatedAt = new Date().toISOString();
    history.version = 2;
    history.orders = historyOrders;
    history.loyalty = nextLoyalty;

    await loyaltyStore.setJSON(loyaltyKey, history, {
      metadata: {
        phone,
        month,
        count: String(nextLoyalty.purchaseCount),
        rewardStatus: nextLoyalty.rewardStatus
      }
    });

    return {
      ok: true,
      orderSaved: true,
      loyaltySaved: true,
      loyalty: nextLoyalty
    };
  } catch (error) {
    console.error("Loyalty persistence failed", error);
    return {
      ok: false,
      orderSaved: false,
      loyaltySaved: false,
      loyalty: initialLoyalty,
      error: "loyalty_storage_unavailable"
    };
  }
}

async function getBlobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  return getStore({ name, consistency: "strong" });
}

function normalizeMonthlyHistory(existing, phone, month) {
  return {
    phone,
    month,
    customerName: existing?.customerName || "",
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: existing?.updatedAt || new Date().toISOString(),
    orders: Array.isArray(existing?.orders) ? existing.orders : [],
    loyalty: existing?.loyalty || null
  };
}

function normalizeLoyaltySettings(settings = {}) {
  const target = Number(settings.purchaseTarget || process.env.LOYALTY_PURCHASE_TARGET || DEFAULT_LOYALTY_TARGET);
  return {
    enabled: settings.enabled !== false,
    mode: settings.mode || "monthly-purchases",
    purchaseTarget: Number.isFinite(target) && target > 0 ? Math.round(target) : DEFAULT_LOYALTY_TARGET,
    rewardTitle: settings.rewardTitle || process.env.LOYALTY_REWARD_TITLE || DEFAULT_LOYALTY_REWARD,
    orderIdField: settings.orderIdField || "id",
    historySource: "netlify-blobs"
  };
}

function loyaltySnapshot({ phone, month, orders, settings, previousCount }) {
  const purchaseCount = orders.length;
  const purchaseTarget = settings.purchaseTarget || DEFAULT_LOYALTY_TARGET;
  const remaining = Math.max(0, purchaseTarget - purchaseCount);
  const rewardUnlocked = settings.enabled !== false && previousCount < purchaseTarget && purchaseCount >= purchaseTarget;
  const rewardAvailable = settings.enabled !== false && purchaseCount >= purchaseTarget;

  return {
    enabled: settings.enabled !== false,
    customerId: phone,
    month,
    mode: settings.mode,
    purchaseCount,
    purchaseTarget,
    remaining,
    rewardTitle: settings.rewardTitle || DEFAULT_LOYALTY_REWARD,
    rewardStatus: rewardAvailable ? "available" : "progress",
    rewardUnlocked,
    unlockedAt: rewardUnlocked ? new Date().toISOString() : null,
    message: loyaltyMessage({
      purchaseCount,
      purchaseTarget,
      remaining,
      rewardTitle: settings.rewardTitle || DEFAULT_LOYALTY_REWARD,
      rewardUnlocked,
      rewardAvailable
    }),
    historySource: "netlify-blobs"
  };
}

function loyaltyMessage({ purchaseCount, purchaseTarget, remaining, rewardTitle, rewardUnlocked, rewardAvailable }) {
  if (rewardUnlocked) {
    return `FIDELIDADE BCK: cliente completou ${purchaseCount}/${purchaseTarget} pedidos no mes e liberou ${rewardTitle}.`;
  }

  if (rewardAvailable) {
    return `FIDELIDADE BCK: cliente ja tem ${rewardTitle} disponivel neste mes.`;
  }

  return `FIDELIDADE BCK: cliente esta em ${purchaseCount}/${purchaseTarget} pedidos no mes. Faltam ${remaining}.`;
}

function orderHistoryRecord(order, phone, month) {
  return {
    id: order.id,
    phone,
    month,
    customerName: order.customer.name || "",
    customerPhone: order.customer.phone || "",
    createdAt: order.createdAt || order.receivedAt || new Date().toISOString(),
    receivedAt: order.receivedAt || new Date().toISOString(),
    total: Number(order.totals.total) || 0,
    subtotal: Number(order.totals.subtotal) || 0,
    payment: order.payment || "",
    itemCount: Array.isArray(order.items)
      ? order.items.reduce((total, item) => total + (Number(item.quantity) || 0), 0)
      : 0,
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
          id: item.id,
          type: item.type || "catalog-product",
          title: item.title,
          quantity: Number(item.quantity) || 0,
          subtotal: Number(item.subtotal) || 0,
          components: Array.isArray(item.components) ? item.components : []
        }))
      : []
  };
}

async function collectMonthlyLoyaltyOrders({ ordersStore, loyaltyStore, phone, month, currentOrder }) {
  const orders = new Map();
  addOrderToMap(orders, currentOrder, phone, month);

  const ledgerPrefix = `customers/${phone}/${month}/orders/`;
  const ledgerEntries = await loyaltyStore.list({ prefix: ledgerPrefix });
  await Promise.all((ledgerEntries.blobs || []).map(async (entry) => {
    const record = await loyaltyStore.get(entry.key, { consistency: "strong", type: "json" });
    addOrderToMap(orders, record, phone, month);
  }));

  const allOrderEntries = await ordersStore.list({ prefix: "orders/" });
  await Promise.all((allOrderEntries.blobs || []).map(async (entry) => {
    const record = await ordersStore.get(entry.key, { consistency: "strong", type: "json" });
    if (!addOrderToMap(orders, record, phone, month)) return;

    await loyaltyStore.setJSON(loyaltyOrderKey(phone, month, record.id), record, {
      metadata: {
        phone,
        month,
        orderId: record.id,
        total: String(Number(record.total) || 0)
      }
    });
  }));

  return [...orders.values()].sort((a, b) => {
    return String(a.createdAt || a.receivedAt || "").localeCompare(String(b.createdAt || b.receivedAt || ""));
  });
}

function addOrderToMap(orders, record, phone, month) {
  if (!record || !record.id || onlyDigits(record.phone || record.customerPhone) !== phone || record.month !== month) {
    return false;
  }

  orders.set(record.id, record);
  return true;
}

function loyaltyOrderKey(phone, month, orderId) {
  return `customers/${phone}/${month}/orders/${orderId}`;
}

async function forwardToOrderWebhook(order) {
  const url = process.env.ORDER_WEBHOOK_URL;
  if (!url) return { ok: false, error: "ORDER_WEBHOOK_URL not configured" };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order)
    });
    return { ok: response.ok };
  } catch (error) {
    console.error("Order webhook failed", error);
    return { ok: false, error: "order_webhook_failed" };
  }
}

async function notifyStore(order) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = onlyDigits(process.env.BCK_STORE_NOTIFY_NUMBER || "");
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v25.0";

  if (!token || !phoneNumberId || !to) {
    return { ok: false, error: "WhatsApp notification env not configured" };
  }

  return sendTextMessage({
    token,
    phoneNumberId,
    apiVersion,
    to,
    body: formatOrderMessage(order),
    previewUrl: false,
    errorLabel: "store_notification_failed"
  });
}

async function notifyCustomerLoyalty(order) {
  const enabled = process.env.LOYALTY_SEND_CUSTOMER_WHATSAPP === "true";
  const loyalty = order.loyalty || {};

  if (!enabled || !loyalty.rewardUnlocked) {
    return { ok: false, error: enabled ? "loyalty_reward_not_unlocked" : "LOYALTY_SEND_CUSTOMER_WHATSAPP disabled" };
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const to = onlyDigits(order.customer.phone || "");
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v25.0";

  if (!token || !phoneNumberId || !to) {
    return { ok: false, error: "WhatsApp customer env not configured" };
  }

  return sendTextMessage({
    token,
    phoneNumberId,
    apiVersion,
    to,
    body: formatCustomerLoyaltyMessage(order),
    previewUrl: false,
    errorLabel: "customer_loyalty_notification_failed"
  });
}

async function sendTextMessage({ token, phoneNumberId, apiVersion, to, body, previewUrl, errorLabel }) {
  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: {
        preview_url: Boolean(previewUrl),
        body
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error(errorLabel, detail);
    return { ok: false, error: errorLabel };
  }

  return { ok: true };
}

function formatOrderMessage(order) {
  const items = order.items.map((item) => {
    const components = Array.isArray(item.components) ? item.components : [];
    return [
      `${item.quantity}x ${item.title}`,
      components.length ? `${item.type === "custom-combo" ? "Combo montado" : "Itens"}: ${components.join(" + ")}` : "",
      `Subtotal: ${formatMoney(item.subtotal)}`
    ].filter(Boolean).join("\n");
  }).join("\n\n");

  return [
    `NOVO PEDIDO BCK #${order.id}`,
    "",
    `Cliente: ${order.customer.name}`,
    `Telefone: ${order.customer.phone}`,
    `Endereco: ${order.customer.address}`,
    `Obs: ${order.customer.notes || "Sem observacoes"}`,
    "",
    items,
    "",
    `Total: ${formatMoney(order.totals.total)}`,
    `Pagamento: ${order.payment}`,
    order.paymentInstructions || "",
    "",
    ...loyaltyMessageLines(order.loyalty),
    "",
    `Recebido: ${new Date(order.receivedAt || order.createdAt || Date.now()).toLocaleString("pt-BR")}`
  ].filter(Boolean).join("\n");
}

function loyaltyMessageLines(loyalty = {}) {
  if (!loyalty.enabled || !loyalty.purchaseTarget) return [];

  const purchaseCount = Number(loyalty.purchaseCount);
  const purchaseTarget = Number(loyalty.purchaseTarget);
  const remaining = Number(loyalty.remaining);
  const rewardTitle = loyalty.rewardTitle || DEFAULT_LOYALTY_REWARD;

  if (!Number.isFinite(purchaseCount) || !Number.isFinite(purchaseTarget) || !Number.isFinite(remaining)) {
    return [
      "FIDELIDADE:",
      "Contador nao confirmou este pedido agora. Validar antes de liberar premio."
    ];
  }

  if (loyalty.rewardUnlocked) {
    return [
      "FIDELIDADE:",
      `Cliente completou ${purchaseCount}/${purchaseTarget} pedidos no mes.`,
      `Premio liberado: ${rewardTitle}.`
    ];
  }

  if (loyalty.rewardStatus === "available") {
    return [
      "FIDELIDADE:",
      `${rewardTitle} ja esta disponivel para este telefone neste mes.`,
      `Historico: ${purchaseCount}/${purchaseTarget} pedidos no mes.`
    ];
  }

  return [
    "FIDELIDADE:",
    `${purchaseCount}/${purchaseTarget} pedidos no mes. Faltam ${remaining}.`
  ];
}

function formatCustomerLoyaltyMessage(order) {
  const loyalty = order.loyalty || {};
  return [
    `Boa! Aqui e a ${process.env.BCK_STORE_NAME || "BCK Beer Chicken"}.`,
    "",
    `Voce completou ${loyalty.purchaseCount}/${loyalty.purchaseTarget} pedidos no mes e ganhou: ${loyalty.rewardTitle}.`,
    "",
    "Para usar, responda FIDELIDADE nesta conversa com seu nome e telefone.",
    `Pedido que liberou: #${order.id}`
  ].join("\n");
}

function createOrderId() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BCK-${stamp}-${random}`;
}

function orderMonth(order) {
  const date = new Date(order.createdAt || order.receivedAt || Date.now());
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return validDate.toISOString().slice(0, 7);
}

function onlyDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number(value) || 0);
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}
