const crypto = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Hub-Signature-256"
};

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  if (event.httpMethod === "GET") {
    return verifyWebhook(event);
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  if (!isValidMetaSignature(event)) {
    return json(401, { ok: false, error: "invalid_signature" });
  }

  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  const messages = extractMessages(payload);
  const replies = [];

  for (const message of messages) {
    const replyText = buildAutoReply(message);
    if (!replyText) continue;

    const sent = await sendTextMessage(message.from, replyText);
    replies.push({
      to: message.from,
      sent: sent.ok,
      reason: sent.error || null
    });
  }

  return json(200, { ok: true, received: messages.length, replies });
};

function verifyWebhook(event) {
  const params = event.queryStringParameters || {};
  const mode = params["hub.mode"];
  const token = params["hub.verify_token"];
  const challenge = params["hub.challenge"];
  const expectedToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (mode === "subscribe" && expectedToken && token === expectedToken) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/plain" },
      body: challenge || ""
    };
  }

  return json(403, { ok: false, error: "webhook_verification_failed" });
}

function isValidMetaSignature(event) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true;

  const signature = event.headers["x-hub-signature-256"] || event.headers["X-Hub-Signature-256"];
  if (!signature || !signature.startsWith("sha256=")) return false;

  const expected = "sha256=" + crypto
    .createHmac("sha256", appSecret)
    .update(event.body || "", "utf8")
    .digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);

  return signatureBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
}

function extractMessages(payload) {
  const messages = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      const incoming = Array.isArray(value.messages) ? value.messages : [];
      for (const item of incoming) {
        messages.push({
          id: item.id,
          from: item.from,
          type: item.type,
          text: messageText(item),
          raw: item
        });
      }
    }
  }

  return messages.filter((message) => message.from && message.text);
}

function messageText(item) {
  if (item.type === "text") return item.text?.body || "";
  if (item.type === "button") return item.button?.text || item.button?.payload || "";
  if (item.type === "interactive") {
    return item.interactive?.button_reply?.title
      || item.interactive?.list_reply?.title
      || item.interactive?.button_reply?.id
      || item.interactive?.list_reply?.id
      || "";
  }
  return "";
}

function buildAutoReply(message) {
  const text = normalize(message.text);
  const siteUrl = publicSiteUrl();

  if (hasAny(text, ["promo", "promocao", "promoção", "combo", "cardapio", "cardápio", "menu", "preco", "preço"])) {
    return [
      "Perfeito. Aqui estao as promocoes e combos da BCK:",
      siteUrl,
      "",
      "Monte o carrinho no site e envie o pedido pronto por aqui."
    ].join("\n");
  }

  if (hasAny(text, ["pix", "pagamento", "cartao", "cartão", "dinheiro"])) {
    return [
      "No checkout do site voce escolhe Pix, cartao na entrega ou dinheiro.",
      "Se escolher Pix, envie o comprovante aqui no WhatsApp depois de finalizar."
    ].join("\n");
  }

  if (hasAny(text, ["horario", "horário", "aberto", "fecha", "funciona"])) {
    return process.env.BCK_OPERATING_HOURS
      || "Hoje estamos recebendo pedidos pelo site. Confira as promocoes e envie seu pedido pronto pelo WhatsApp.";
  }

  if (hasAny(text, ["endereco", "endereço", "bairro", "entrega", "taxa"])) {
    return [
      "A entrega e conferida pelo endereco informado no checkout.",
      "Coloque rua, numero, bairro e ponto de referencia para agilizar."
    ].join("\n");
  }

  if (hasAny(text, ["atendente", "humano", "pessoa", "problema", "reclamar"])) {
    return "Recebido. Um responsavel da BCK vai acompanhar por aqui. Para pedido novo, o caminho mais rapido e montar pelo site.";
  }

  return [
    "Oi! Eu sou o atendimento automatico da BCK Beer Chicken.",
    "Para pedir mais rapido, escolha suas promocoes no site e envie o carrinho pronto:",
    siteUrl
  ].join("\n");
}

async function sendTextMessage(to, body) {
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v25.0";

  if (!token || !phoneNumberId) {
    return { ok: false, error: "whatsapp_env_missing" };
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
        preview_url: true,
        body
      }
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error("WhatsApp send failed", detail);
    return { ok: false, error: "whatsapp_send_failed" };
  }

  return { ok: true };
}

function normalize(value = "") {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasAny(text, words) {
  return words.some((word) => text.includes(normalize(word)));
}

function publicSiteUrl() {
  return process.env.SITE_URL || process.env.URL || "https://jovial-vacherin-8c5599.netlify.app";
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}
