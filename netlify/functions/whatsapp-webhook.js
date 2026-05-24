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
  const offersUrl = `${siteUrl}#catalogo`;
  const comboUrl = `${siteUrl}#monte-seu-combo`;
  const checkoutUrl = `${siteUrl}#checkout`;

  if (text.startsWith("__unsupported__")) {
    return [
      "Recebi sua mensagem.",
      "Para agilizar seu pedido e nao deixar a fome esperando, me responda com uma opcao:",
      "",
      "1 - Ver combos e promocoes atualizadas",
      "2 - Montar pedido agora no site",
      "3 - Entrega e endereco",
      "4 - Pagamento",
      "5 - Alterar ou cancelar",
      "",
      "Se quer pedir agora, digite 2."
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
        "Monte seu Combo: pizza + frango + batata + bebida",
        "Combo da noite: Frango File 500g + Pizza Pequena",
        "Relampago: Pizza + Borda + Refri",
        "Mais pedido: Frango + Batata + Bebida"
      ],
      comboUrl
    );
  }

  if (hasAny(text, ["frango", "file", "crocante", "frito", "porcao de frango"])) {
    return categoryReply(
      "Frango BCK",
      [
        "Frango File 500g crocante",
        "Combo frango + batata + bebida",
        "Frango + pizza pequena"
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
        "Pizza + frango para dividir"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["batata", "cheddar", "bacon", "recheada"])) {
    return categoryReply(
      "Batata recheada",
      [
        "Batata recheada cheddar bacon",
        "Batata recheada + refri",
        "Frango + batata + bebida"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["carne", "porcao", "porcoes", "porcao de carne"])) {
    return categoryReply(
      "Porcoes de carne",
      [
        "Porcao de carne BCK",
        "Porcao para dividir com molho e acompanhamento",
        "Boa para completar o combo da noite"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["bebida", "bebidas", "refri", "refrigerante", "cerveja", "gelada"])) {
    return categoryReply(
      "Bebidas",
      [
        "Refri gelado",
        "Pizza + borda + refri",
        "Batata recheada + refri"
      ],
      offersUrl
    );
  }

  if (hasAny(text, ["hamburguer", "hamburger", "burguer", "burger"])) {
    return [
      "Hamburguer ainda nao esta ativo no cardapio de hoje.",
      "Mas da para pedir forte agora com os combos de frango, pizza, batata e porcoes.",
      "",
      "Mais saidos:",
      "- Frango + Pizza",
      "- Pizza + Borda + Refri",
      "",
      "Veja as ofertas abertas agora:",
      offersUrl
    ].join("\n");
  }

  if (hasAny(text, ["horario", "horarios", "aberto", "abre", "fecha", "funciona", "funcionamento"])) {
    return [
      `${STORE_NAME} atende:`,
      DEFAULT_HOURS,
      "",
      "Se bateu fome agora, monte o carrinho e envie o pedido pronto por aqui:",
      siteUrl
    ].join("\n");
  }

  if (hasAny(text, ["status", "acompanhar", "andamento", "meu pedido", "cade", "demora"])) {
    return [
      "Para consultar um pedido ja enviado, responda assim:",
      "",
      "STATUS + seu nome + telefone",
      "",
      "Exemplo:",
      "STATUS Regiano 99999-9999",
      "",
      "Se acabou de finalizar no site, aguarde a confirmacao por aqui."
    ].join("\n");
  }

  if (hasAny(text, ["atendente", "humano", "pessoa", "falar com", "ajuda", "problema", "reclamar"])) {
    return [
      "Certo. Sua mensagem ficou registrada para a equipe da BCK acompanhar.",
      "",
      "Enquanto isso, se for pedido novo, o caminho mais rapido e montar pelo site:",
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
      "Fechado. Quando a fome chamar, a BCK ja esta no jeito.",
      "",
      "Digite 1 para ver os combos ou abra direto:",
      siteUrl
    ].join("\n");
  }

  return mainMenu(siteUrl);
}

function mainMenu(siteUrl) {
  return [
    `Oi. Aqui e o atendimento automatico da ${STORE_NAME}.`,
    "",
    "Para pedir rapido, escolha uma opcao:",
    "",
    "1 - Ver combos e promocoes de hoje",
    "2 - Montar pedido no site",
    "3 - Entrega e endereco",
    "4 - Formas de pagamento",
    "5 - Alterar ou cancelar item",
    "",
    "Atalho rapido: digite PIZZA, FRANGO, BATATA, CARNE ou BEBIDAS.",
    "",
    "Cardapio e pedidos:",
    siteUrl
  ].join("\n");
}

function promotionsReply(offersUrl) {
  return [
    "Tem oferta boa para pedir agora na BCK.",
    "",
    "Combos que mais giram hoje:",
    "- Frango File 500g + Pizza Pequena",
    "- Pizza + Borda + Refri",
    "- Frango + Batata + Bebida",
    "- Batata Recheada + Refri",
    "",
    "Escolha no site, monte o carrinho e envie o pedido pronto por aqui:",
    offersUrl,
    "",
    "Para ir direto em uma categoria, digite PIZZA, FRANGO ou BATATA."
  ].join("\n");
}

function orderReply(siteUrl, checkoutUrl) {
  return [
    "Fechou. O jeito mais rapido e montar pelo site.",
    "",
    "Voce escolhe os itens, confere o total e o site ja manda o pedido completo para este WhatsApp.",
    "",
    "Toque aqui e va direto para o checkout:",
    checkoutUrl || siteUrl,
    "",
    "Depois de finalizar, acompanhe a confirmacao por esta conversa."
  ].join("\n");
}

function deliveryReply(siteUrl) {
  return [
    `Fazemos delivery em ${CITY} e regiao conforme disponibilidade da noite.`,
    "",
    "Para evitar atraso, coloque no pedido:",
    "- Rua e numero",
    "- Bairro",
    "- Ponto de referencia",
    "- Observacao se precisar",
    "",
    "Monte o pedido aqui e envie completo:",
    siteUrl
  ].join("\n");
}

function paymentReply(siteUrl) {
  return [
    "A BCK aceita:",
    "- Pix",
    "- Cartao na entrega",
    "- Dinheiro",
    "",
    "Se for dinheiro, escreva nas observacoes se precisa de troco.",
    "Se for Pix, envie o comprovante por aqui depois do pedido.",
    "",
    "Monte o pedido aqui:",
    siteUrl
  ].join("\n");
}

function changeOrderReply(siteUrl) {
  return [
    "Se ainda nao finalizou, ajuste direto no carrinho do site usando +, - ou remover.",
    "",
    "Se ja enviou o pedido, responda:",
    "CANCELAR PEDIDO + seu nome + telefone",
    "",
    "Exemplo:",
    "CANCELAR PEDIDO Regiano 99999-9999",
    "",
    "A equipe confere antes de seguir para preparo.",
    siteUrl
  ].join("\n");
}

function categoryReply(categoryName, examples, offersUrl) {
  return [
    `${categoryName}: boa escolha.`,
    "",
    "Hoje vale olhar:",
    ...examples.map((item) => `- ${item}`),
    "",
    "Veja preco, foto e monte o carrinho aqui:",
    offersUrl,
    "",
    "Depois o pedido sai pronto para enviar neste WhatsApp."
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
