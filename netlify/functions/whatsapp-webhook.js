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
    if (sent.ok) {
      console.log("WhatsApp reply sent", JSON.stringify({
        to: maskPhone(message.from),
        chars: replyText.length
      }));
    }

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
      "Recebi sua mensagem.",
      "Para eu te ajudar mais rapido, digite uma opcao:",
      "",
      "1 - Combos e promocoes",
      "2 - Montar pedido agora",
      "3 - Entrega e endereco",
      "4 - Pagamento",
      "5 - Alterar ou cancelar"
    ].join("\n");
  }

  if (isMenuRequest(text)) {
    return mainMenu(siteUrl);
  }

  if (isChoice(text, "1") || hasAny(text, ["promo", "promocao", "promocoes", "oferta", "ofertas", "cardapio", "preco", "precos"])) {
    return promotionsReply(offersUrl);
  }

  if (isChoice(text, "2") || hasAny(text, ["pedido", "pedir", "comprar", "carrinho", "checkout", "finalizar", "quero pedir", "fazer pedido", "quero comprar", "link"])) {
    return orderReply(siteUrl, checkoutUrl);
  }

  if (isChoice(text, "3") || hasAny(text, ["entrega", "delivery", "taxa", "bairro", "endereco", "rua", "numero", "localizacao"])) {
    return deliveryReply(siteUrl);
  }

  if (isChoice(text, "4") || hasAny(text, ["pix", "pagamento", "pagar", "cartao", "dinheiro", "troco", "maquininha"])) {
    return paymentReply(siteUrl);
  }

  if (isChoice(text, "5") || hasAny(text, ["apagar", "remover", "tirar", "excluir", "alterar", "mudar", "editar", "menos", "cancelar", "cancela"])) {
    return changeOrderReply(siteUrl);
  }

  if (hasAny(text, ["combo", "combos", "casado", "pizza com frango", "frango com pizza"])) {
    return categoryReply(
      "Combos da noite",
      [
        "Frango file 500g + pizza pequena",
        "Pizza + borda + refri",
        "Frango + batata + bebida"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["frango", "file", "crocante", "frito", "porcao de frango"])) {
    return categoryReply(
      "Frango BCK",
      [
        "Frango file 500g",
        "Frango crocante com acompanhamento",
        "Combo frango + batata + bebida"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["pizza", "borda", "calabresa", "mussarela", "catupiry"])) {
    return categoryReply(
      "Pizza",
      [
        "Pizza pequena promocional",
        "Pizza + borda recheada",
        "Pizza + refri para fechar o pedido"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["batata", "cheddar", "bacon", "recheada"])) {
    return categoryReply(
      "Batata recheada",
      [
        "Batata com cheddar",
        "Batata com bacon",
        "Batata + refri"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["carne", "porcao", "porcoes", "porcao de carne"])) {
    return categoryReply(
      "Porcoes de carne",
      [
        "Porcoes para dividir",
        "Acompanhamentos e molhos",
        "Combos para completar a mesa"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["bebida", "bebidas", "refri", "refrigerante", "cerveja", "gelada"])) {
    return categoryReply(
      "Bebidas",
      [
        "Refri gelado",
        "Bebidas para combo",
        "Cerveja conforme disponibilidade"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["hamburguer", "hamburger", "burguer", "burger"])) {
    return [
      "Hamburguer ainda nao entrou como linha principal no site.",
      "Hoje, o melhor pedido e ir nos combos de frango, pizza, batata e porcoes.",
      "",
      "Veja as ofertas abertas agora:",
      offersUrl
    ].join("\n");
  }

  if (hasAny(text, ["horario", "horarios", "aberto", "abre", "fecha", "funciona", "funcionamento"])) {
    return [
      `${STORE_NAME} - horario de atendimento:`,
      DEFAULT_HOURS,
      "",
      "Se o site estiver aberto, monte o carrinho e envie o pedido pronto por aqui:",
      siteUrl
    ].join("\n");
  }

  if (hasAny(text, ["status", "acompanhar", "andamento", "meu pedido", "cade", "demora"])) {
    return [
      "Para consultar um pedido ja enviado, mande:",
      "",
      "STATUS + seu nome + telefone",
      "",
      "Se acabou de finalizar no site, aguarde a confirmacao por aqui."
    ].join("\n");
  }

  if (hasAny(text, ["atendente", "humano", "pessoa", "falar com", "ajuda", "problema", "reclamar"])) {
    return [
      "Certo. Vou deixar sua mensagem registrada para a equipe da BCK acompanhar.",
      "",
      "Para pedido novo, o caminho mais rapido e montar pelo site:",
      siteUrl,
      "",
      "Se for urgente, envie: ATENDENTE + seu nome."
    ].join("\n");
  }

  if (isGreeting(text)) {
    return mainMenu(siteUrl);
  }

  if (hasAny(text, ["obrigado", "obrigada", "valeu", "blz", "beleza", "ok", "certo"])) {
    return [
      "Fechado.",
      "Quando quiser pedir, digite 1 para ver os combos ou abra direto:",
      siteUrl
    ].join("\n");
  }

  return mainMenu(siteUrl);
}

function mainMenu(siteUrl) {
  return [
    `Oi. Atendimento automatico da ${STORE_NAME}.`,
    "Quer pedir mais rapido e sem fila?",
    "",
    "1 - Combos e promocoes de hoje",
    "2 - Montar pedido no site",
    "3 - Entrega e endereco",
    "4 - Formas de pagamento",
    "5 - Alterar ou cancelar item",
    "",
    "Tambem pode digitar: FRANGO, PIZZA, BATATA, CARNE ou BEBIDAS.",
    "",
    siteUrl
  ].join("\n");
}

function promotionsReply(offersUrl) {
  return [
    "Perfeito. As ofertas mais fortes da BCK estao aqui:",
    "",
    "- Frango file 500g + pizza pequena",
    "- Pizza + borda + refri",
    "- Frango + batata + bebida",
    "- Batata recheada + refri",
    "",
    "Escolha no site, monte o carrinho e envie o pedido pronto por aqui:",
    offersUrl,
    "",
    "Quer ir direto por categoria? Digite FRANGO, PIZZA, BATATA, CARNE ou BEBIDAS."
  ].join("\n");
}

function orderReply(siteUrl, checkoutUrl) {
  return [
    "Pedido rapido pela BCK:",
    "",
    "1. Abra o site",
    "2. Escolha os combos",
    "3. Confira o carrinho",
    "4. Coloque nome, telefone e endereco",
    "5. Finalize e envie tudo por aqui no WhatsApp",
    "",
    "Link direto para montar:",
    checkoutUrl || siteUrl
  ].join("\n");
}

function deliveryReply(siteUrl) {
  return [
    `Fazemos delivery em ${CITY} e regiao conforme disponibilidade da noite.`,
    "",
    "No pedido, coloque:",
    "- Rua",
    "- Numero",
    "- Bairro",
    "- Ponto de referencia",
    "",
    "Para agilizar, monte o carrinho no site e envie pronto:",
    siteUrl
  ].join("\n");
}

function paymentReply(siteUrl) {
  return [
    "Formas de pagamento aceitas:",
    "",
    "- Pix",
    "- Cartao na entrega",
    "- Dinheiro",
    "",
    "Se for dinheiro, escreva nas observacoes se precisa de troco.",
    "Monte o pedido aqui:",
    siteUrl
  ].join("\n");
}

function changeOrderReply(siteUrl) {
  return [
    "Se ainda nao finalizou, abra o carrinho no site e use +, - ou remover.",
    "",
    "Se ja enviou o pedido, responda:",
    "CANCELAR PEDIDO + seu nome + telefone",
    "",
    "A equipe confere antes de seguir para preparo.",
    siteUrl
  ].join("\n");
}

function categoryReply(categoryName, examples, offersUrl) {
  return [
    `${categoryName} esta entre as opcoes da BCK hoje.`,
    "",
    "Sugestoes:",
    ...examples.map((item) => `- ${item}`),
    "",
    "Veja valores, monte o carrinho e envie o pedido:",
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

function isMenuRequest(text) {
  return ["menu", "opcoes", "opcao", "inicio", "comecar"].includes(text);
}

function isGreeting(text) {
  const exactGreetings = ["oi", "ola", "opa", "bom dia", "boa tarde", "boa noite", "e ai"];
  if (exactGreetings.includes(text)) return true;

  return ["bom dia", "boa tarde", "boa noite", "ola"].some((greeting) => {
    return text.startsWith(`${normalize(greeting)} `);
  });
}

function maskPhone(phone = "") {
  const value = String(phone);
  if (value.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, value.length - 4))}${value.slice(-4)}`;
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
