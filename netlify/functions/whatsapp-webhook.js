const crypto = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Hub-Signature-256"
};

const SITE_FALLBACK = "https://bckbeerchicken.netlify.app";
const STORE_NAME = process.env.BCK_STORE_NAME || "BCK Beer Chicken";
const CITY = process.env.BCK_CITY || "Cachoeiro";
const DEFAULT_HOURS = process.env.BCK_OPERATING_HOURS || "Todos os dias, das 18h as 23h";

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

  return `__unsupported__:${item.type || "unknown"}`;
}

function buildAutoReply(message) {
  const text = normalize(message.text);
  const siteUrl = publicSiteUrl();
  const offersUrl = `${siteUrl}#promocoes`;
  const checkoutUrl = `${siteUrl}#checkout`;

  if (text.startsWith("__unsupported__")) {
    return [
      "Por enquanto eu entendo melhor mensagens de texto.",
      "Digite uma opcao:",
      "1 - Ver promocoes",
      "2 - Montar pedido",
      "3 - Entrega",
      "4 - Pagamento"
    ].join("\n");
  }

  if (isChoice(text, "1") || hasAny(text, ["promo", "promocao", "promocoes", "oferta", "ofertas", "cardapio", "menu", "preco", "precos"])) {
    return promotionsReply(offersUrl);
  }

  if (isChoice(text, "2") || hasAny(text, ["pedido", "pedir", "comprar", "carrinho", "checkout", "finalizar", "quero pedir", "fazer pedido"])) {
    return orderReply(siteUrl, checkoutUrl);
  }

  if (isChoice(text, "3") || hasAny(text, ["entrega", "delivery", "taxa", "bairro", "endereco", "rua", "numero", "localizacao"])) {
    return deliveryReply();
  }

  if (isChoice(text, "4") || hasAny(text, ["pix", "pagamento", "pagar", "cartao", "dinheiro", "troco", "maquininha"])) {
    return paymentReply();
  }

  if (isChoice(text, "5") || hasAny(text, ["apagar", "remover", "tirar", "excluir", "alterar", "mudar", "editar", "menos", "cancelar", "cancela"])) {
    return changeOrderReply(siteUrl);
  }

  if (hasAny(text, ["combo", "combos", "casado", "pizza com frango", "frango com pizza"])) {
    return categoryReply("Combos", "pizza + frango, pizza + borda + refri, frango + batata + bebida", offersUrl);
  }

  if (hasAny(text, ["frango", "file", "crocante", "frito", "porcao de frango"])) {
    return categoryReply("Frango", "frango file 500g e combos com frango crocante", offersUrl);
  }

  if (hasAny(text, ["pizza", "borda", "calabresa", "mussarela", "catupiry"])) {
    return categoryReply("Pizza", "pizza pequena promocional, borda recheada e combos com refri", offersUrl);
  }

  if (hasAny(text, ["batata", "cheddar", "bacon", "recheada"])) {
    return categoryReply("Batata recheada", "batata com cheddar, bacon e combos com bebida", offersUrl);
  }

  if (hasAny(text, ["carne", "porcao", "porcoes", "porcao de carne"])) {
    return categoryReply("Porcoes de carne", "porcoes para dividir com molho e acompanhamento", offersUrl);
  }

  if (hasAny(text, ["bebida", "bebidas", "refri", "refrigerante", "cerveja", "gelada"])) {
    return categoryReply("Bebidas", "refri gelado e bebidas para completar o combo", offersUrl);
  }

  if (hasAny(text, ["hamburguer", "hamburger", "burguer", "burger"])) {
    return [
      "A linha de hamburguer da BCK esta preparada para entrar no site em breve.",
      "Hoje, o caminho mais forte e escolher combos de frango, pizza, batata e porcoes:",
      offersUrl
    ].join("\n");
  }

  if (hasAny(text, ["horario", "horarios", "aberto", "abre", "fecha", "funciona", "funcionamento"])) {
    return [
      `Horario da ${STORE_NAME}:`,
      DEFAULT_HOURS,
      "Para agilizar, monte o pedido no site e envie o carrinho pronto por aqui.",
      siteUrl
    ].join("\n");
  }

  if (hasAny(text, ["status", "acompanhar", "andamento", "meu pedido", "cade", "demora"])) {
    return [
      "Para acompanhar um pedido ja enviado, mande seu nome e telefone usados no checkout.",
      "Se acabou de enviar, aguarde a confirmacao por aqui."
    ].join("\n");
  }

  if (hasAny(text, ["atendente", "humano", "pessoa", "falar com", "ajuda", "problema", "reclamar"])) {
    return [
      "Recebido. Sua mensagem ficou registrada para a equipe da BCK acompanhar.",
      "Para pedido novo, o caminho mais rapido ainda e montar pelo site:",
      siteUrl
    ].join("\n");
  }

  if (hasAny(text, ["oi", "ola", "bom dia", "boa tarde", "boa noite", "e ai", "inicio", "comecar"])) {
    return mainMenu(siteUrl);
  }

  if (hasAny(text, ["obrigado", "obrigada", "valeu", "blz", "beleza", "ok"])) {
    return "Fechado. Quando quiser pedir, digite 1 para ver promocoes ou monte direto pelo site: " + siteUrl;
  }

  return mainMenu(siteUrl);
}

function mainMenu(siteUrl) {
  return [
    `Oi! Sou o atendimento automatico da ${STORE_NAME}.`,
    "Escolha uma opcao:",
    "1 - Promocoes e combos",
    "2 - Montar pedido no site",
    "3 - Entrega e endereco",
    "4 - Formas de pagamento",
    "5 - Alterar ou cancelar item",
    "",
    siteUrl
  ].join("\n");
}

function promotionsReply(offersUrl) {
  return [
    "Perfeito. Aqui estao as promocoes e combos da BCK:",
    offersUrl,
    "",
    "No site voce escolhe os itens, monta o carrinho e envia o pedido pronto por aqui."
  ].join("\n");
}

function orderReply(siteUrl, checkoutUrl) {
  return [
    "Para pedir sem espera:",
    "1. Abra o site",
    "2. Adicione combos ao carrinho",
    "3. Preencha nome, telefone e endereco",
    "4. Finalize e envie o pedido pelo WhatsApp",
    "",
    checkoutUrl || siteUrl
  ].join("\n");
}

function deliveryReply() {
  return [
    `Fazemos delivery em ${CITY} e regiao conforme disponibilidade da noite.`,
    "No checkout, informe rua, numero, bairro e ponto de referencia.",
    "A taxa/confirmacao da entrega pode ser conferida pelo WhatsApp antes do preparo."
  ].join("\n");
}

function paymentReply() {
  return [
    "Formas de pagamento:",
    "Pix",
    "Cartao na entrega",
    "Dinheiro",
    "",
    "Se for dinheiro, informe se precisa de troco nas observacoes do pedido."
  ].join("\n");
}

function changeOrderReply(siteUrl) {
  return [
    "Se voce ainda esta montando o pedido no site, abra o carrinho e use +, - ou remover item.",
    "Se o pedido ja foi enviado, responda: CANCELAR PEDIDO + seu nome.",
    "Assim a equipe confere antes de seguir para preparo.",
    "",
    siteUrl
  ].join("\n");
}

function categoryReply(categoryName, examples, offersUrl) {
  return [
    `${categoryName} esta nas promocoes de hoje.`,
    `Exemplos: ${examples}.`,
    "Veja as ofertas, coloque no carrinho e finalize por aqui:",
    offersUrl
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
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function hasAny(text, words) {
  return words.some((word) => text.includes(normalize(word)));
}

function isChoice(text, number) {
  return text === number
    || text === `opcao ${number}`
    || text.startsWith(`${number} `)
    || text.startsWith(`${number}-`)
    || text.startsWith(`${number}.`);
}

function publicSiteUrl() {
  return (process.env.SITE_URL || process.env.URL || SITE_FALLBACK).replace(/\/$/, "");
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}
