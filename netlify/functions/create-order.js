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
  const logContext = {
    orderId: order.id,
    phone: maskPhone(phone),
    month
  };
  const initialLoyalty = loyaltySnapshot({
    phone,
    month,
    orders: [orderRecord],
    settings: loyaltySettings,
    previousCount: 0
  });
