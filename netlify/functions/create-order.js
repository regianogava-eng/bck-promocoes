const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

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

  const webhookForward = await forwardToOrderWebhook(normalizedOrder);
  const whatsappNotification = await notifyStore(normalizedOrder);

  return json(200, {
    ok: true,
    orderId,
    webhookForwarded: webhookForward.ok,
    whatsappNotificationSent: whatsappNotification.ok,
    notes: [
      webhookForward.error,
      whatsappNotification.error
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
        preview_url: false,
        body: formatOrderMessage(order)
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("Store notification failed", detail);
    return { ok: false, error: "store_notification_failed" };
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
    `Recebido: ${new Date(order.receivedAt || order.createdAt || Date.now()).toLocaleString("pt-BR")}`
  ].filter(Boolean).join("\n");
}

function createOrderId() {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `BCK-${stamp}-${random}`;
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
