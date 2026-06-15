const crypto = require("crypto");

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Hub-Signature-256"
};

const SITE_FALLBACK = "https://beerchicken-bck.netlify.app";
const STORE_NAME = process.env.BCK_STORE_NAME || "BCK Beer Chicken";
const CITY = process.env.BCK_CITY || "Cachoeiro";
const DEFAULT_HOURS = process.env.BCK_OPERATING_HOURS || "Todos os dias, das 17h as 00h";
const AI_ASSISTANT_NAME = process.env.BCK_AI_ASSISTANT_NAME || "Bibi";
const AI_ASSISTANT_KEYWORD = normalize(process.env.BCK_AI_ASSISTANT_KEYWORD || "BIBI");
const SESSION_STORE = "bck-whatsapp-sessions";
const STATES = {
  MENU: "MENU",
  COLLECTING: "COLETANDO_PEDIDO",
  CONFIRMING: "CONFIRMANDO_PEDIDO",
  FORWARDED: "PEDIDO_ENCAMINHADO"
};
const TRAVA_APOS_ENCAMINHAR = Math.max(1, Number(process.env.BCK_TRAVA_APOS_ENCAMINHAR || process.env.BCK_HUMAN_HANDOFF_MINUTES || 5));
const TIMEOUT_COLETA = Math.max(5, Number(process.env.BCK_TIMEOUT_COLETA || process.env.BCK_ORDER_DRAFT_MINUTES || 20));
const TIMEOUT_CONFIRMACAO = Math.max(3, Number(process.env.BCK_TIMEOUT_CONFIRMACAO || 10));
const NON_ORDER_MESSAGES = [
  "teste",
  "tes",
  "oi",
  "ok",
  "beleza",
  "sim",
  "nao",
  "obrigado",
  "obrigada",
  "quero ajuda",
  "vim pelo mini site",
  "quero escolher meu pedido"
].map(normalize);
const RESET_KEYWORDS = [
  AI_ASSISTANT_KEYWORD,
  "bibi",
  "menu",
  "resetar",
  "resetar bibi",
  "novo atendimento",
  "voltar"
].map(normalize);
const UNSUPPORTED_MEDIA_REPLY = "Desculpa, ainda nao consigo ver imagens, videos ou audios. Voce pode escrever seu pedido?";
const FOOD_KEYWORDS = [
  "pizza",
  "pizz",
  "piza",
  "frango",
  "frango a passarinho",
  "batata",
  "batatinha",
  "batata frita",
  "combo",
  "combos",
  "refri",
  "refrigerante",
  "coca",
  "coca cola",
  "coca-cola",
  "guarana",
  "fanta",
  "sprite",
  "bebida",
  "bebidas",
  "2l",
  "2 litros",
  "porcao",
  "porcoes",
  "carne",
  "file",
  "catupiry",
  "cheddar",
  "bacon",
  "calabresa",
  "borda",
  "mussarela",
  "mucarela",
  "queijo"
].map(normalize);

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
    const result = await withSessionLock(message.from, () => handleBibiMessage(message));

    if (!result.replyText) {
      replies.push({
        to: message.from,
        sent: false,
        reason: result.reason || "no_reply"
      });
      continue;
    }

    const sent = await sendTextMessage(message.from, result.replyText);

    if (sent.ok) {
      console.log("BCK_BIBI_REPLY_SENT", JSON.stringify({
        to: maskPhone(message.from),
        state: result.state || null,
        chars: result.replyText.length
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

async function handleBibiMessage(message) {
  const rawText = String(message.text || "").trim();
  const text = normalize(rawText);
  const siteUrl = publicSiteUrl();
  let session = await getConversationSession(message.from);
  const previousState = session.state;

  console.log("BCK_BIBI_MESSAGE_RECEIVED", JSON.stringify({
    phone: maskPhone(message.from),
    state: session.state,
    chars: rawText.length
  }));

  session = expireSessionIfNeeded(session);

  if (session.state !== previousState) {
    logStateChanged(message.from, previousState, session.state, "expired");
  }

  if (session.expiredNotice === STATES.COLLECTING) {
    const menuResult = await handleMenuState({ message, session: menuSession(), rawText, text, siteUrl });
    if (menuResult.session) await saveConversationSession(message.from, menuResult.session);
    return {
      replyText: [
        "Fiquei um tempo sem noticias. Se ainda quiser pedir, e so falar comigo.",
        "",
        menuResult.replyText
      ].filter(Boolean).join("\n"),
      reason: menuResult.reason || null,
      state: menuResult.session?.state || STATES.MENU
    };
  }

  if (session.expiredNotice === STATES.CONFIRMING) {
    const menuResult = await handleMenuState({ message, session: menuSession(), rawText, text, siteUrl });
    if (menuResult.session) await saveConversationSession(message.from, menuResult.session);
    return {
      replyText: [
        "Como nao tive confirmacao, o pedido foi cancelado. Quando quiser pedir de novo, e so falar!",
        "",
        menuResult.replyText
      ].filter(Boolean).join("\n"),
      reason: menuResult.reason || null,
      state: menuResult.session?.state || STATES.MENU
    };
  }

  if (isUnsupportedIncomingText(text) && session.state !== STATES.FORWARDED) {
    return {
      replyText: unsupportedMediaReply(),
      reason: "unsupported_media",
      state: session.state,
      session
    };
  }

  let result;
  if (session.state === STATES.COLLECTING) {
    result = await handleCollectingState({ message, session, rawText, text, siteUrl });
  } else if (session.state === STATES.CONFIRMING) {
    result = await handleConfirmingState({ message, session, rawText, text, siteUrl });
  } else if (session.state === STATES.FORWARDED) {
    result = await handleForwardedState({ message, session, text, siteUrl });
  } else {
    result = await handleMenuState({ message, session, rawText, text, siteUrl });
  }

  if (result.deleteSession) {
    await deleteConversationSession(message.from);
  } else if (result.session) {
    await saveConversationSession(message.from, result.session);
  }

  return {
    replyText: result.replyText || "",
    reason: result.reason || null,
    state: result.session?.state || session.state
  };
}

async function handleMenuState({ message, session, rawText, text, siteUrl }) {
  if (text.startsWith("__unsupported__")) {
    return withSession(session, unsupportedMediaReply());
  }

  if (isChoice(text, "1") || hasAny(text, ["cardapio", "cardápio", "promocao", "promocoes", "oferta", "ofertas"])) {
    return withSession(menuSession(), catalogReply(siteUrl, `${siteUrl}#catalogo`, `${siteUrl}#monte-seu-combo`));
  }

  if (isChoice(text, "2") || isOrderStartRequest(text)) {
    const next = collectingSession(emptyOrderData(), "start_order");
    logStateChanged(message.from, session.state, next.state, "start_order");
    return withSession(next, startCollectingReply(siteUrl));
  }

  if (isChoice(text, "3") || hasAny(text, ["taxa", "entrega", "endereco", "bairro", "localizacao"])) {
    return withSession(menuSession(), deliveryReply(siteUrl));
  }

  if (isChoice(text, "4") || hasAny(text, ["pagamento", "pix", "dinheiro", "cartao", "cartão", "maquininha"])) {
    return withSession(menuSession(), paymentReply(siteUrl));
  }

  if (isChoice(text, "5") || isHumanRequest(text) || hasAny(text, ["atendimento humano", "falar com equipe", "falar com humano"])) {
    const teamNotification = await notifyStoreHumanRequest(message.from, message.id);
    if (!teamNotification.ok) {
      console.error("BCK_BIBI_HUMAN_NOTIFY_FAILED", JSON.stringify({
        customer: maskPhone(message.from),
        error: teamNotification.error
      }));
    } else {
      console.log("BCK_BIBI_HUMAN_NOTIFY_SENT", JSON.stringify({
        customer: maskPhone(message.from)
      }));
    }

    const next = forwardedSession(session.data, "human_requested");
    logStateChanged(message.from, session.state, next.state, "human_requested");
    return withSession(next, humanReply(teamNotification.ok));
  }

  if (isAssistantRequest(text) || isMenuRequest(text) || isGreeting(text) || cameFromMiniSite(text)) {
    return withSession(menuSession(), cameFromMiniSite(text) ? miniSiteMenuReply(siteUrl) : mainMenu(siteUrl));
  }

  if (looksLikeOrderStart(text)) {
    const data = mergeOrderData(emptyOrderData(), extractOrderFields(rawText));
    const next = collectingSession(data, "partial_order_from_menu");
    const completeness = orderCompleteness(next.data);
    logStateChanged(message.from, session.state, next.state, "partial_order_from_menu");

    if (completeness.complete) {
      return forwardCompletedOrder(message, next, "complete_from_menu");
    }

    return withSession(next, askMissingFieldsReply(next.data, completeness.missing));
  }

  return withSession(menuSession(), mainMenu(siteUrl));
}

async function handleCollectingState({ message, session, rawText, text, siteUrl }) {
  const data = session.data || emptyOrderData();

  if (session.expiredNotice) {
    const menuResult = await handleMenuState({ message, session: menuSession(), rawText, text, siteUrl });
    return {
      ...menuResult,
      replyText: [
        "Fiquei um tempo sem noticias. Se ainda quiser pedir, e so falar comigo.",
        "",
        menuResult.replyText
      ].filter(Boolean).join("\n")
    };
  }

  if (isCancelRequest(text)) {
    return {
      session: menuSession(),
      replyText: "Sem problemas! Se quiser pedir depois, e so chamar."
    };
  }

  let next = collectingSession(data, "collecting");
  const pendingBefore = orderCompleteness(next.data);

  if (isOrderStatusRequest(text)) {
    return withSession(next, currentOrderStatusReply(next.data));
  }

  if (isOnlyMissingChange(pendingBefore) && shouldAnswerChange(text)) {
    next.data = {
      ...next.data,
      changeFor: parseChangeAnswer(text) || "nao"
    };
    const confirming = confirmingSession(next.data, "change_answered");
    return forwardCompletedOrder(message, confirming, "change_answered");
  }

  if (isOnlyMissingChange(pendingBefore) && !isNonOrderMessage(text)) {
    const extractedChange = extractOrderFields(rawText);
    if (extractedChange.changeFor || extractedChange.payment === "dinheiro") {
      next.data = mergeOrderData(next.data, extractedChange);
      const afterChange = orderCompleteness(next.data);
      if (afterChange.complete) {
        const confirming = confirmingSession(next.data, "change_completed");
        return forwardCompletedOrder(message, confirming, "change_completed");
      }
    }
  }

  if (isOnlyMissingChange(pendingBefore)) {
    return withSession(next, askMissingFieldsReply(next.data, ["troco"]));
  }

  if (isNonOrderMessage(text)) {
    return withSession(next, continueCollectingReply(next.data));
  }

  next.data = mergeOrderData(next.data, extractOrderFields(rawText));
  const completeness = orderCompleteness(next.data);

  if (completeness.complete) {
    return forwardCompletedOrder(message, next, "all_fields_collected");
  }

  return withSession(next, askMissingFieldsReply(next.data, completeness.missing));
}

async function handleConfirmingState({ message, session, rawText, text, siteUrl }) {
  if (session.expiredNotice) {
    const menuResult = await handleMenuState({ message, session: menuSession(), rawText, text, siteUrl });
    return {
      ...menuResult,
      replyText: [
        "Como nao tive confirmacao, o pedido foi cancelado. Quando quiser pedir de novo, e so falar!",
        "",
        menuResult.replyText
      ].filter(Boolean).join("\n")
    };
  }

  if (isOrderStatusRequest(text)) {
    return withSession(session, confirmationReply(session.data));
  }

  if (isPositiveConfirmation(text)) {
    const summary = formatOrderSummary(session.data);
    const storeNotification = await notifyStoreManualOrder(message.from, summary, message.id);
    if (!storeNotification.ok) {
      console.error("BCK_BIBI_STORE_NOTIFY_FAILED", JSON.stringify({
        customer: maskPhone(message.from),
        error: storeNotification.error
      }));
    } else {
      console.log("BCK_BIBI_STORE_NOTIFY_SENT", JSON.stringify({
        customer: maskPhone(message.from),
        chars: summary.length
      }));
    }

    const next = forwardedSession(session.data, "confirmed");
    logStateChanged(message.from, session.state, next.state, "confirmed");
    return withSession(next, "Ja encaminhei pra equipe! Eles vao confirmar por aqui em breve.");
  }

  if (isChangeRequest(text)) {
    const next = collectingSession(session.data || emptyOrderData(), "change_requested");
    logStateChanged(message.from, session.state, next.state, "change_requested");
    return withSession(next, "Sem problemas! O que voce quer mudar? Nome, endereco, itens ou pagamento?");
  }

  if (isCancelRequest(text)) {
    logStateChanged(message.from, session.state, STATES.MENU, "cancel_confirmation");
    return withSession(menuSession(), mainMenu(siteUrl));
  }

  if (looksLikeOrderStart(text)) {
    return withSession(session, "Voce quer adicionar isso ao pedido ou mudar alguma coisa? Responda ALTERAR para corrigir ou SIM para enviar como esta.");
  }

  return withSession(session, "Confirma pra mim: esta tudo certo? Responda SIM para enviar ou ALTERAR para corrigir.");
}

async function forwardCompletedOrder(message, session, reason) {
  const summary = formatOrderSummary(session.data);
  const storeNotification = await notifyStoreManualOrder(message.from, summary, message.id);
  if (!storeNotification.ok) {
    console.error("BCK_BIBI_STORE_NOTIFY_FAILED", JSON.stringify({
      customer: maskPhone(message.from),
      error: storeNotification.error
    }));
  } else {
    console.log("BCK_BIBI_STORE_NOTIFY_SENT", JSON.stringify({
      customer: maskPhone(message.from),
      chars: summary.length
    }));
  }

  const next = forwardedSession(session.data, reason);
  logStateChanged(message.from, session.state, next.state, reason);

  if (!storeNotification.ok) {
    return withSession(next, [
      "Recebi seu pedido, mas nao consegui avisar a equipe automaticamente agora.",
      "",
      "Resumo do pedido:",
      summary,
      "",
      "Por favor, chame a equipe no numero oficial: (28) 99932-9677."
    ].join("\n"));
  }

  return withSession(next, [
    "Certo, recebi e ja encaminhei seu pedido para a equipe responsavel:",
    "",
    summary,
    "",
    "Eles vao conferir tudo e te responder por aqui com a confirmacao."
  ].join("\n"));
}

async function handleForwardedState({ message, session, text, siteUrl }) {
  if (session.expiredNotice) {
    const menu = menuSession();
    logStateChanged(message.from, session.state, menu.state, "forward_lock_expired");
    return withSession(menu, mainMenu(siteUrl));
  }

  if (shouldResetConversation(text)) {
    const menu = menuSession();
    logStateChanged(message.from, session.state, menu.state, "reset");
    return withSession(menu, mainMenu(siteUrl));
  }

  return {
    session,
    replyText: "",
    reason: "order_forwarded_handoff"
  };
}

function withSession(session, replyText) {
  return { session, replyText };
}

async function withSessionLock(phone, task) {
  const key = humanHandoffKey(phone) || String(phone || "unknown");
  globalThis.__BCK_BIBI_SESSION_LOCKS__ = globalThis.__BCK_BIBI_SESSION_LOCKS__ || new Map();
  const locks = globalThis.__BCK_BIBI_SESSION_LOCKS__;
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const lock = new Promise((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => {}).then(() => lock);
  locks.set(key, current);

  await previous.catch(() => {});

  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === current) {
      locks.delete(key);
    }
  }
}

function buildAutoReply(message) {
  const rawText = String(message.text || "").trim();
  const text = normalize(rawText);
  const siteUrl = publicSiteUrl();
  const offersUrl = `${siteUrl}#catalogo`;
  const comboUrl = `${siteUrl}#monte-seu-combo`;
  const checkoutUrl = `${siteUrl}#checkout`;

  if (text.startsWith("__unsupported__")) {
    return [
      "Recebi sua mensagem.",
      "Para agilizar seu pedido, me responda com uma opcao:",
      "",
      "1 - Pedir pelo cardapio",
      "2 - Fazer pedido comigo",
      "",
      "Veja nosso cardapio:",
      siteUrl
    ].join("\n");
  }

  if (isManualOrder(text)) {
    return manualOrderReceivedReply(rawText);
  }

  if (isOrderDraft(text)) {
    return orderDraftReply(rawText, siteUrl);
  }

  if (isChoice(text, "5") || isHumanRequest(text)) {
    return humanReply();
  }

  if (isRepeatOrderRequest(text)) {
    return repeatOrderReply(siteUrl);
  }

  if (isPickupRequest(text)) {
    return pickupReply(siteUrl);
  }

  if (isGiftQuestion(text)) {
    return giftReply(comboUrl);
  }

  if (isPriceQuestion(text)) {
    return priceReply(siteUrl);
  }

  if (isPizzaFlavorQuestion(text)) {
    return pizzaFlavorReply(siteUrl);
  }

  if (isCustomizationQuestion(text)) {
    return customizationReply(siteUrl);
  }

  if (isAssistantRequest(text)) {
    return assistantReply(siteUrl);
  }

  if (isOrderHelpRequest(text)) {
    return orderHelpReply(siteUrl);
  }

  if (isOrderStartRequest(text)) {
    return whatsappOrderReply(siteUrl);
  }

  if (isMenuRequest(text)) {
    return mainMenu(siteUrl);
  }

  if (isGreeting(text)) {
    return mainMenu(siteUrl);
  }

  if (isChoice(text, "1") || hasAny(text, ["cardapio", "menu digital", "abrir cardapio", "ver cardapio", "preco", "precos"])) {
    return catalogReply(siteUrl, offersUrl, comboUrl);
  }

  if (isChoice(text, "2") || hasAny(text, ["pedido pelo whatsapp", "pedir pelo whatsapp", "whatsapp", "zap", "fazer pedido comigo", "pedir com voce"])) {
    return whatsappOrderReply(siteUrl);
  }

  if (hasAny(text, ["promo", "promocao", "promocoes", "oferta", "ofertas"])) {
    return promotionsReply(offersUrl);
  }

  if (hasAny(text, ["pedido", "pedir", "comprar", "carrinho", "checkout", "finalizar", "quero pedir", "fazer pedido", "quero comprar", "link"])) {
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

  if (isChoice(text, "6")) {
    return assistantReply(siteUrl);
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

  if (hasAny(text, ["ajuda", "problema", "reclamar"])) {
    return [
      "Certo. Sua mensagem ficou registrada para a equipe da BCK acompanhar.",
      "",
      "Enquanto isso, se for pedido novo, o caminho mais rapido e montar pelo site:",
      siteUrl,
      "",
      "Se for urgente, envie: ATENDENTE + seu nome."
    ].join("\n");
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
    `${currentGreeting()}, eu sou a ${AI_ASSISTANT_NAME}, sua atendente virtual da ${STORE_NAME}.`,
    "E um prazer te atender.",
    "",
    "Como posso te ajudar?",
    "",
    "1 - Pedir pelo cardapio",
    "2 - Fazer pedido comigo",
    "",
    "Veja nosso cardapio:",
    siteUrl
  ].join("\n");
}

function assistantReply(siteUrl) {
  return [
    `${currentGreeting()}, eu sou a ${AI_ASSISTANT_NAME}, sua atendente virtual da ${STORE_NAME}.`,
    "",
    "Posso te ajudar a escolher combo, tirar duvida de entrega, explicar pagamento ou mandar o link do pedido.",
    "",
    "Me responda com uma destas opcoes:",
    "1 - Ver promocoes",
    "2 - Montar pedido no site",
    "3 - Entrega e endereco",
    "4 - Pagamento",
    "5 - Falar com humano",
    "",
    "Cardapio rapido:",
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

function catalogReply(siteUrl, offersUrl, comboUrl) {
  return [
    "Perfeito. Pelo cardapio voce escolhe, monta o carrinho e envia o pedido completo para este WhatsApp.",
    "",
    "Cardapio:",
    offersUrl || siteUrl,
    "",
    "Monte seu Combo:",
    comboUrl || siteUrl,
    "",
    "No combo acima de R$100, o refri gratis aparece automaticamente."
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

function whatsappOrderReply(siteUrl) {
  return [
    "Claro. Pode fazer seu pedido comigo por aqui.",
    "",
    "Eu vou organizar as informacoes e enviar para o setor responsavel confirmar tudo com voce.",
    "",
    "Para montar certinho, me mande por favor:",
    "Nome:",
    "Endereco completo:",
    "Bairro ou ponto de referencia:",
    "Pedido:",
    "Forma de pagamento:",
    "Observacao, se tiver:",
    "",
    "Se preferir, monte no cardapio que o pedido ja chega organizado aqui:",
    siteUrl
  ].join("\n");
}

function orderHelpReply(siteUrl) {
  return [
    "Claro, eu te ajudo.",
    "",
    "Voce pode pedir de dois jeitos:",
    "",
    "1 - Pelo cardapio online, montando o carrinho:",
    siteUrl,
    "",
    "2 - Direto por aqui no WhatsApp. Nesse caso, me mande:",
    "Nome:",
    "Endereco completo:",
    "Bairro ou ponto de referencia:",
    "Pedido:",
    "Forma de pagamento:",
    "Troco ou observacao, se tiver:",
    "",
    "Depois eu encaminho para o setor responsavel confirmar tudo com voce."
  ].join("\n");
}

function orderDraftReply(orderText, siteUrl) {
  return [
    "Certo, ja entendi que voce quer fazer um pedido.",
    "",
    "Recebi assim:",
    formatCustomerOrder(orderText),
    "",
    "Para eu encaminhar certinho ao setor responsavel, me mande por favor:",
    "Nome:",
    "Endereco completo:",
    "Bairro ou ponto de referencia:",
    "Forma de pagamento:",
    "Troco, se precisar:",
    "Observacao, se tiver:",
    "",
    "Se preferir, monte no cardapio que o pedido ja chega organizado aqui:",
    siteUrl
  ].join("\n");
}

function manualOrderReceivedReply(orderText) {
  const lines = [
    "pedido novo favor confirmar",
    "",
    "Certo, recebi seu pedido assim:",
    "",
    formatCustomerOrder(orderText),
    "",
    "Vou encaminhar para a equipe responsavel conferir tudo e te responder por aqui com a confirmacao."
  ];

  if (hasAny(normalize(orderText), ["pix"])) {
    lines.push(
      "",
      "Como o pagamento e Pix, aguarde a equipe confirmar o valor e a chave antes de enviar o comprovante."
    );
  }

  lines.push("", "pedido novo favor confirmar");

  return lines.join("\n");
}

function humanReply(notified = true) {
  const officialNumber = normalizeStoreNotifyNumber(process.env.BCK_STORE_NOTIFY_NUMBER || "5528999329677") || "5528999329677";
  const lines = [
    notified
      ? "Certo. Avisei a equipe responsavel para acompanhar sua conversa."
      : "Certo. Nao consegui avisar a equipe automaticamente agora, mas voce pode chamar o numero oficial abaixo.",
    "",
    `Numero oficial: https://wa.me/${officialNumber}`,
    "",
    "Se for pedido novo, pode mandar a mensagem completa aqui com nome, endereco, pedido e pagamento.",
    "",
    "A equipe confere tudo e te responde por aqui com a confirmacao."
  ];

  return lines.join("\n");
}

function repeatOrderReply(siteUrl) {
  return [
    "Consigo te ajudar, mas eu ainda nao puxo automaticamente o pedido anterior.",
    "",
    "Me mande o pedido de novo ou escreva algo como:",
    "Nome:",
    "Endereco completo:",
    "Pedido igual ao anterior:",
    "Forma de pagamento:",
    "",
    "A equipe confere e confirma por aqui.",
    "",
    "Cardapio:",
    siteUrl
  ].join("\n");
}

function pickupReply(siteUrl) {
  return [
    "Da para pedir e combinar retirada, sim.",
    "",
    "Monte o pedido ou me envie por aqui com nome, pedido e forma de pagamento.",
    "O setor responsavel confirma horario e retirada com voce antes de preparar.",
    "",
    "Cardapio:",
    siteUrl
  ].join("\n");
}

function giftReply(comboUrl) {
  return [
    "No Monte seu Combo, pedido acima de R$100 libera refri gratis automaticamente quando a regra estiver ativa.",
    "",
    "Monte aqui e confira o total na hora:",
    comboUrl,
    "",
    "Depois envie o pedido por este WhatsApp para a equipe confirmar tudo."
  ].join("\n");
}

function priceReply(siteUrl) {
  return [
    "Para valor certinho, o melhor caminho e conferir no cardapio, porque preco e disponibilidade podem mudar durante o dia.",
    "",
    "No site voce monta o carrinho e ve o total antes de enviar:",
    siteUrl,
    "",
    "Se quiser pedir por aqui, me mande o pedido completo que eu encaminho para o setor responsavel confirmar."
  ].join("\n");
}

function pizzaFlavorReply(siteUrl) {
  return [
    "Sobre sabores, borda e pizza meio a meio: a equipe confirma conforme a disponibilidade do dia.",
    "",
    "Pode me mandar do jeito que voce quer, por exemplo:",
    "Pizza meio a meio calabresa e frango com catupiry",
    "Borda recheada",
    "Refri",
    "",
    "Eu encaminho para o setor responsavel conferir e confirmar com voce.",
    "",
    "Cardapio:",
    siteUrl
  ].join("\n");
}

function customizationReply(siteUrl) {
  return [
    "Pode mandar observacao do pedido, sim.",
    "",
    "Exemplos:",
    "- sem cebola",
    "- sem batata",
    "- trocar bebida",
    "- preciso de troco",
    "",
    "Mudanca de item, valor ou disponibilidade sempre sera confirmada pelo setor responsavel antes de preparar.",
    "",
    "Cardapio:",
    siteUrl
  ].join("\n");
}

function deliveryReply(siteUrl) {
  return [
    `Pode fazer seu pedido comigo por aqui. A entrega em ${CITY} e regiao sera confirmada pelo setor responsavel.`,
    "",
    "Para encaminhar certinho, me mande por favor:",
    "Nome:",
    "Endereco completo:",
    "Bairro ou ponto de referencia:",
    "Pedido:",
    "Forma de pagamento:",
    "Observacao, se tiver:",
    "",
    "Se preferir, monte pelo cardapio e envie o pedido completo:",
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

async function notifyStoreManualOrder(customerPhone, orderText, messageId) {
  const to = normalizeStoreNotifyNumber(process.env.BCK_STORE_NOTIFY_NUMBER || "5528999329677");
  if (!to) {
    return { ok: false, error: "store_notify_number_missing" };
  }

  return sendTextMessage(to, formatManualOrderNotification(customerPhone, orderText, messageId));
}

async function notifyStoreHumanRequest(customerPhone, messageId) {
  const to = normalizeStoreNotifyNumber(process.env.BCK_STORE_NOTIFY_NUMBER || "5528999329677");
  if (!to) {
    return { ok: false, error: "store_notify_number_missing" };
  }

  return sendTextMessage(to, formatHumanRequestNotification(customerPhone, messageId));
}

function normalizeStoreNotifyNumber(value = "") {
  const digits = onlyDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 9) return `5528${digits}`;
  return digits;
}

function formatHumanRequestNotification(customerPhone, messageId) {
  const receivedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return [
    "ATENDIMENTO SOLICITADO VIA BIBI",
    "",
    `Cliente WhatsApp: +${onlyDigits(customerPhone)}`,
    messageId ? `Mensagem ID: ${messageId}` : "",
    `Recebido: ${receivedAt}`,
    "",
    "O cliente escolheu a opcao 5 - Falar com a equipe.",
    "Acompanhe a conversa da Bibi/Cloud API ou chame o cliente pelo telefone acima."
  ].filter(Boolean).join("\n");
}

function formatManualOrderNotification(customerPhone, orderText, messageId) {
  const receivedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return [
    "NOVO PEDIDO VIA BIBI",
    "",
    `Cliente WhatsApp: +${onlyDigits(customerPhone)}`,
    messageId ? `Mensagem ID: ${messageId}` : "",
    `Recebido: ${receivedAt}`,
    "",
    "Pedido enviado pelo cliente:",
    formatCustomerOrder(orderText),
    "",
    "Acesse a conversa da Bibi/Cloud API ou chame o cliente pelo telefone acima para confirmar."
  ].filter(Boolean).join("\n");
}

async function getConversationSession(phone) {
  const key = humanHandoffKey(phone);
  if (!key) return menuSession();

  try {
    const store = await getBlobStore(SESSION_STORE);
    const session = await store.get(key, { consistency: "strong", type: "json" });
    return normalizeSession(session);
  } catch (error) {
    console.error("BCK_BIBI_SESSION_READ_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
    return menuSession();
  }
}

async function saveConversationSession(phone, session) {
  const key = humanHandoffKey(phone);
  if (!key || !session) return;

  try {
    const store = await getBlobStore(SESSION_STORE);
    await store.setJSON(key, normalizeSession({
      ...session,
      updatedAt: new Date().toISOString()
    }), {
      metadata: {
        phone: onlyDigits(phone),
        state: session.state,
        expiresAt: session.expiresAt || ""
      }
    });
  } catch (error) {
    console.error("BCK_BIBI_SESSION_SAVE_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
}

async function deleteConversationSession(phone) {
  const key = humanHandoffKey(phone);
  if (!key) return;

  try {
    const store = await getBlobStore(SESSION_STORE);
    await store.delete(key);
  } catch (error) {
    console.error("BCK_BIBI_SESSION_DELETE_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
}

function normalizeSession(session) {
  if (!session || typeof session !== "object") return menuSession();

  const state = Object.values(STATES).includes(session.state) ? session.state : STATES.MENU;
  return {
    state,
    data: normalizeOrderData(session.data),
    startedAt: session.startedAt || new Date().toISOString(),
    updatedAt: session.updatedAt || new Date().toISOString(),
    expiresAt: session.expiresAt || null,
    reason: session.reason || null
  };
}

function expireSessionIfNeeded(session) {
  if (!session.expiresAt) return session;

  const expiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt > Date.now()) return session;

  if (session.state === STATES.COLLECTING || session.state === STATES.CONFIRMING || session.state === STATES.FORWARDED) {
    return {
      ...menuSession(),
      expiredNotice: session.state
    };
  }

  return menuSession();
}

function menuSession() {
  const now = new Date().toISOString();
  return {
    state: STATES.MENU,
    data: emptyOrderData(),
    startedAt: now,
    updatedAt: now,
    expiresAt: null,
    reason: "menu"
  };
}

function collectingSession(data = emptyOrderData(), reason = "collecting") {
  const now = new Date();
  return {
    state: STATES.COLLECTING,
    data: normalizeOrderData(data),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addMinutes(now, TIMEOUT_COLETA),
    reason
  };
}

function confirmingSession(data = emptyOrderData(), reason = "confirming") {
  const now = new Date();
  return {
    state: STATES.CONFIRMING,
    data: normalizeOrderData(data),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addMinutes(now, TIMEOUT_CONFIRMACAO),
    reason
  };
}

function forwardedSession(data = emptyOrderData(), reason = "forwarded") {
  const now = new Date();
  return {
    state: STATES.FORWARDED,
    data: normalizeOrderData(data),
    startedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: addMinutes(now, TRAVA_APOS_ENCAMINHAR),
    reason
  };
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000).toISOString();
}

function emptyOrderData() {
  return {
    name: "",
    address: "",
    items: [],
    payment: "",
    changeFor: "",
    notes: ""
  };
}

function normalizeOrderData(data = {}) {
  return {
    ...emptyOrderData(),
    ...data,
    items: Array.isArray(data.items) ? data.items.filter(Boolean).map(String) : []
  };
}

function extractOrderFields(rawText = "") {
  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const allText = lines.join(" ");
  const text = normalize(allText);
  const extracted = emptyOrderData();

  const explicitName = explicitField(rawText, ["nome"]);
  if (explicitName && isValidName(explicitName)) extracted.name = explicitName;

  const explicitAddress = explicitField(rawText, ["endereco", "endereço"]);
  if (explicitAddress && isValidAddress(explicitAddress)) extracted.address = explicitAddress;

  const explicitOrder = explicitField(rawText, ["pedido", "itens", "item"]);
  if (explicitOrder && hasFoodSignal(normalize(explicitOrder))) extracted.items.push(explicitOrder);

  const explicitPayment = explicitField(rawText, ["pagamento", "forma de pagamento"]);
  if (explicitPayment) extracted.payment = parsePayment(normalize(explicitPayment));

  for (const line of lines) {
    const normalizedLine = normalize(line);
    if (!extracted.name && isValidName(line) && !hasFoodSignal(normalizedLine) && !hasPaymentSignal(normalizedLine) && !isValidAddress(line) && !isNonOrderMessage(normalizedLine)) {
      extracted.name = line;
      continue;
    }

    if (!extracted.address && isValidAddress(line)) {
      extracted.address = line;
      continue;
    }

    if (hasFoodSignal(normalizedLine)) {
      extracted.items.push(line);
      continue;
    }

    const payment = parsePayment(normalizedLine);
    if (payment) extracted.payment = payment;

    const changeFor = parseChangeAnswer(normalizedLine);
    if (changeFor) extracted.changeFor = changeFor;
  }

  const payment = parsePayment(text);
  if (payment) extracted.payment = payment;

  const changeFor = parseChangeAnswer(text);
  if (changeFor) extracted.changeFor = changeFor;

  if (extracted.changeFor && !extracted.payment) {
    extracted.payment = "dinheiro";
  }

  if (!extracted.address) {
    const joinedAddress = possibleAddressFromLines(lines);
    if (joinedAddress) extracted.address = joinedAddress;
  }

  extracted.items = uniqueList(extracted.items);
  return extracted;
}

function mergeOrderData(current = emptyOrderData(), incoming = emptyOrderData()) {
  const next = normalizeOrderData(current);
  if (incoming.name) next.name = incoming.name;
  if (incoming.address) next.address = incoming.address;
  if (incoming.payment) next.payment = incoming.payment;
  if (!incoming.payment && incoming.changeFor && !next.payment) next.payment = "dinheiro";
  if (incoming.notes) next.notes = incoming.notes;

  if (incoming.items?.length) {
    next.items = uniqueList([...next.items, ...incoming.items]);
  }

  if (next.payment !== "dinheiro") {
    next.changeFor = "";
  } else if (incoming.changeFor) {
    next.changeFor = incoming.changeFor;
  }

  return next;
}

function explicitField(rawText, labels) {
  const lines = String(rawText || "").split(/\r?\n/);
  for (const line of lines) {
    const index = line.indexOf(":");
    if (index < 0) continue;
    const label = normalize(line.slice(0, index));
    const value = line.slice(index + 1).trim();
    if (labels.map(normalize).includes(label) && value) return value;
  }
  return "";
}

function isValidName(value) {
  const text = String(value || "").trim();
  const normalizedText = normalize(text);
  return /[a-zA-ZÀ-ÿ]{3,}/.test(text)
    && !/^\d+$/.test(text)
    && !hasFoodSignal(normalizedText)
    && !hasPaymentSignal(normalizedText)
    && !hasAny(normalizedText, ["rua", "avenida", "bairro", "cep", "referencia", "referência"]);
}

function isValidAddress(value) {
  const text = String(value || "").trim();
  const normalizedText = normalize(text);
  const hasNumber = /\b\d{1,6}\b/.test(normalizedText);
  const hasComplement = /[a-zA-ZÀ-ÿ]{3,}/.test(text)
    || hasAny(normalizedText, ["rua", "avenida", "bairro", "vila", "cep", "referencia", "referência", "perto", "proximo", "próximo"]);
  return hasNumber && hasComplement && !hasFoodSignal(normalizedText) && !hasPaymentSignal(normalizedText);
}

function possibleAddressFromLines(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    const joined = [lines[index], lines[index + 1]].filter(Boolean).join(" ");
    if (isValidAddress(joined)) return joined;
  }
  return "";
}

function hasFoodSignal(text) {
  return hasAny(text, FOOD_KEYWORDS);
}

function hasPaymentSignal(text) {
  return Boolean(parsePayment(text)) || hasAny(text, ["troco"]);
}

function parsePayment(text) {
  if (hasAny(text, ["dinheiro", "troco"])) return "dinheiro";
  if (hasAny(text, ["pix"])) return "pix";
  if (hasAny(text, ["cartao", "cartão", "maquininha", "debito", "débito", "credito", "crédito"])) return "cartao";
  if (hasAny(text, ["vale"])) return "vale";
  return "";
}

function parseChangeAnswer(text) {
  const normalizedText = normalize(text);
  if (["nao", "sem"].includes(normalizedText)
    || hasAny(normalizedText, ["sem troco", "nao precisa", "dispensa troco", "nao vou precisar de troco"])) {
    return "nao";
  }
  const directChange = normalizedText.match(/\b(?:troco|trico)\s*(?:para|pra|de|em)?\s*(?:r\$?\s*)?(\d{1,4}(?:[,.]\d{1,2})?)\b/);
  if (directChange) return directChange[1].replace(",", ".");

  const shortChange = normalizedText.match(/^(?:para|pra)\s*(?:r\$?\s*)?(\d{1,4}(?:[,.]\d{1,2})?)\b/);
  if (shortChange) return shortChange[1].replace(",", ".");

  const numericOnly = normalizedText.match(/^\d{1,4}(?:[,.]\d{1,2})?$/);
  return numericOnly ? numericOnly[0].replace(",", ".") : "";
}

function shouldAnswerChange(text) {
  return Boolean(parseChangeAnswer(text));
}

function orderCompleteness(data = emptyOrderData()) {
  const order = normalizeOrderData(data);
  const missing = [];
  if (!order.name) missing.push("nome");
  if (!order.address) missing.push("endereco");
  if (!order.items.length) missing.push("pedido");
  if (!order.payment) missing.push("pagamento");
  if (order.payment === "dinheiro" && !order.changeFor) missing.push("troco");
  return { complete: missing.length === 0, missing };
}

function isOnlyMissingChange(completeness) {
  return completeness.missing.length === 1 && completeness.missing[0] === "troco";
}

function uniqueList(values) {
  const seen = new Set();
  return values.filter((value) => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatOrderSummary(data = emptyOrderData()) {
  const order = normalizeOrderData(data);
  return [
    order.name ? `Cliente: ${order.name}` : "",
    order.address ? `Endereco: ${order.address}` : "",
    order.items.length ? `Pedido: ${formatItemsForSummary(order.items)}` : "",
    order.payment ? `Pagamento: ${paymentLabel(order.payment)}` : "",
    order.payment === "dinheiro" ? `Troco: ${order.changeFor === "nao" ? "nao precisa" : `para ${order.changeFor}`}` : "",
    order.notes ? `Obs: ${order.notes}` : ""
  ].filter(Boolean).join("\n");
}

function formatItemsForSummary(items = []) {
  return items.map((item) => itemHasQuantity(item) ? item : `1x ${item}`).join(" | ");
}

function itemHasQuantity(item = "") {
  const text = normalize(item);
  return /^\d+\s*x?\b/.test(text)
    || /\b\d+\s*(pizza|pizzas|combo|combos|frango|batata|batatas|refri|refrigerante|porcao|porcoes|bebida|bebidas)\b/.test(text)
    || hasAny(text, [
      "uma pizza",
      "um combo",
      "um frango",
      "uma batata",
      "dois combos",
      "duas pizzas",
      "duas pizza",
      "tres pizzas",
      "tres combos"
    ]);
}

function paymentLabel(payment) {
  return {
    dinheiro: "dinheiro",
    pix: "Pix",
    cartao: "cartao",
    vale: "vale"
  }[payment] || payment;
}

function startCollectingReply(siteUrl) {
  return [
    "Claro. Pode fazer seu pedido comigo por aqui.",
    "",
    "Me conta o que voce vai querer hoje. Pode incluir pizzas, frangos, batatas, combos e bebidas.",
    "",
    "Para eu encaminhar certinho, me mande:",
    "Nome:",
    "Endereco completo:",
    "Bairro ou ponto de referencia:",
    "Pedido:",
    "Forma de pagamento:",
    "Troco, se precisar:",
    "Observacao, se tiver:",
    "",
    "Se preferir, monte no cardapio que o pedido ja chega organizado aqui:",
    siteUrl
  ].join("\n");
}

function askMissingFieldsReply(data, missing) {
  if (missing.includes("troco")) {
    return [
      "Anotei ate agora:",
      formatOrderSummary(data),
      "",
      "Vai precisar de troco? Se sim, pra qual valor? Se nao, responda NAO."
    ].filter(Boolean).join("\n");
  }

  const labels = missingFieldLabels(missing);

  if (labels.length === 1) {
    return `Beleza. Agora me passa seu ${labels[0]}, por favor.`;
  }

  return `So falta ${joinHuman(labels)}. Pode me mandar por aqui?`;
}

function continueCollectingReply(data) {
  const missing = orderCompleteness(data).missing;
  if (!missing.length) return "Continuando... me confirme se esta tudo certo.";
  return `Continuando... ${askMissingFieldsReply(data, missing)}`;
}

function confirmationReply(data) {
  return [
    "Confere aqui:",
    "",
    formatOrderSummary(data),
    "",
    "Se a quantidade nao estiver certa, responda ALTERAR.",
    "Esta tudo certo? Responda SIM para enviar ou ALTERAR para corrigir."
  ].join("\n");
}

function currentOrderStatusReply(data) {
  const summary = formatOrderSummary(data);
  const missing = orderCompleteness(data).missing;
  const reply = [
    "O que eu ja anotei:",
    summary || "Ainda nao anotei dados do pedido."
  ];

  if (missing.length) {
    reply.push("", `Ainda falta: ${joinHuman(missingFieldLabels(missing))}.`);
  }

  return reply.join("\n");
}

function missingFieldLabels(missing) {
  return missing.map((field) => ({
    nome: "nome",
    endereco: "endereco completo",
    pedido: "pedido",
    pagamento: "forma de pagamento",
    troco: "troco"
  }[field] || field));
}

function unsupportedMediaReply() {
  return UNSUPPORTED_MEDIA_REPLY;
}

function miniSiteMenuReply(siteUrl) {
  return [
    "Que bom que veio do site!",
    "Aqui voce pode ver o cardapio, fazer um pedido ou falar com a equipe.",
    "",
    "1 - Ver cardapio e promocoes",
    "2 - Fazer pedido comigo",
    "3 - Entrega e endereco",
    "4 - Pagamento",
    "5 - Falar com a equipe",
    "",
    siteUrl
  ].join("\n");
}

function joinHuman(values) {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} e ${values[1]}`;
  return `${values.slice(0, -1).join(", ")} e ${values[values.length - 1]}`;
}

function logStateChanged(phone, fromState, toState, reason) {
  if (fromState === toState) return;
  console.log("BCK_BIBI_STATE_CHANGED", JSON.stringify({
    phone: maskPhone(phone),
    fromState,
    toState,
    reason
  }));
}

async function isHumanHandoffActive(phone) {
  const handoff = await getHumanHandoff(phone);
  if (!handoff) return false;

  const expiresAt = Date.parse(handoff.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return false;
  }

  console.log("BCK_BIBI_HANDOFF_ACTIVE", JSON.stringify({
    phone: maskPhone(phone),
    expiresAt: handoff.expiresAt
  }));

  return true;
}

async function getHumanHandoff(phone) {
  const key = humanHandoffKey(phone);
  if (!key) return null;

  try {
    const store = await getBlobStore("bck-whatsapp-handoff");
    return await store.get(key, { consistency: "strong", type: "json" });
  } catch (error) {
    console.error("BCK_BIBI_HANDOFF_READ_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
    return null;
  }
}

async function saveHumanHandoff(phone, messageId) {
  const key = humanHandoffKey(phone);
  if (!key || !HUMAN_HANDOFF_MINUTES) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + HUMAN_HANDOFF_MINUTES * 60 * 1000).toISOString();

  try {
    const store = await getBlobStore("bck-whatsapp-handoff");
    await store.setJSON(key, {
      phone: onlyDigits(phone),
      startedAt: now.toISOString(),
      expiresAt,
      reason: "manual_order_received",
      messageId: messageId || null
    }, {
      metadata: {
        phone: onlyDigits(phone),
        expiresAt
      }
    });

    console.log("BCK_BIBI_HANDOFF_SAVED", JSON.stringify({
      phone: maskPhone(phone),
      expiresAt
    }));
  } catch (error) {
    console.error("BCK_BIBI_HANDOFF_SAVE_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
}

async function deleteHumanHandoff(phone) {
  const key = humanHandoffKey(phone);
  if (!key) return;

  try {
    const store = await getBlobStore("bck-whatsapp-handoff");
    await store.delete(key);
    console.log("BCK_BIBI_HANDOFF_RESET", JSON.stringify({
      phone: maskPhone(phone)
    }));
  } catch (error) {
    console.error("BCK_BIBI_HANDOFF_RESET_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
}

async function getOrderDraft(phone) {
  const key = humanHandoffKey(phone);
  if (!key) return null;

  try {
    const store = await getBlobStore("bck-whatsapp-order-drafts");
    const draft = await store.get(key, { consistency: "strong", type: "json" });
    if (!draft) return null;

    const expiresAt = Date.parse(draft.expiresAt || "");
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      await store.delete(key).catch(() => {});
      return null;
    }

    return draft;
  } catch (error) {
    console.error("BCK_BIBI_DRAFT_READ_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
    return null;
  }
}

async function saveOrderDraft(phone, text, messageId) {
  const key = humanHandoffKey(phone);
  if (!key || !text) return;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + ORDER_DRAFT_MINUTES * 60 * 1000).toISOString();

  try {
    const store = await getBlobStore("bck-whatsapp-order-drafts");
    await store.setJSON(key, {
      phone: onlyDigits(phone),
      text: String(text || "").slice(0, 1200),
      startedAt: now.toISOString(),
      expiresAt,
      messageId: messageId || null
    }, {
      metadata: {
        phone: onlyDigits(phone),
        expiresAt
      }
    });
  } catch (error) {
    console.error("BCK_BIBI_DRAFT_SAVE_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
}

async function deleteOrderDraft(phone) {
  const key = humanHandoffKey(phone);
  if (!key) return;

  try {
    const store = await getBlobStore("bck-whatsapp-order-drafts");
    await store.delete(key);
  } catch (error) {
    console.error("BCK_BIBI_DRAFT_DELETE_ERROR", JSON.stringify({
      phone: maskPhone(phone),
      message: error?.message || String(error),
      name: error?.name || "Error"
    }));
  }
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
      async delete(key) {
        bucket.delete(key);
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

function humanHandoffKey(phone) {
  const digits = onlyDigits(phone);
  return digits ? `customers/${digits}` : "";
}

function onlyDigits(value = "") {
  return String(value).replace(/\D/g, "");
}

function normalize(value = "") {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function currentGreeting() {
  try {
    const hourText = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false
    }).format(new Date());
    const hour = Number(hourText.replace(/\D/g, ""));
    if (hour >= 5 && hour < 12) return "Bom dia";
    if (hour >= 12 && hour < 18) return "Boa tarde";
    return "Boa noite";
  } catch {
    return "Ola";
  }
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

function isAssistantRequest(text) {
  return text === AI_ASSISTANT_KEYWORD
    || hasAny(text, [
      AI_ASSISTANT_NAME,
      "assistente virtual",
      "assistente ia",
      "inteligencia artificial",
      "falar com a bibi",
      "bibi",
      "bot"
    ]);
}

function isMenuRequest(text) {
  return ["menu", "opcoes", "opcao", "inicio", "comecar"].includes(text);
}

function orderSignals(text) {
  const wordsCount = text.split(/\s+/).filter(Boolean).length;
  const explicitFields = [
    "nome:",
    "endereco:",
    "pedido:",
    "pagamento:",
    "observacao:",
    "observacoes:"
  ].filter((field) => text.includes(field)).length;

  const hasFood = hasAny(text, FOOD_KEYWORDS);
  const hasAddressKeyword = hasAny(text, [
    "rua",
    "avenida",
    "av ",
    "bairro",
    "endereco",
    "numero",
    "casa",
    "apto",
    "apartamento",
    "ponto de referencia"
  ]);
  const hasPayment = hasAny(text, [
    "pix",
    "dinheiro",
    "cartao",
    "troco",
    "maquininha",
    "pagamento",
    "debito",
    "credito"
  ]);
  const hasOrderVerb = hasAny(text, [
    "quero",
    "queria",
    "vou querer",
    "manda",
    "me ve",
    "fazer pedido",
    "pedir",
    "pedido",
    "comprar"
  ]);
  const numericParts = text.match(/\b\d{1,5}\b/g) || [];
  const hasAddressNumber = numericParts.length > 0
    && wordsCount >= 6
    && !hasAny(text, [
      "fatias",
      "pedacos",
      "pedaco",
      "litro",
      "1/5",
      "500g",
      "500 gramas"
    ])
    && !(numericParts.length === 1 && hasAny(text, ["troco", "reais", "real"]));
  const hasAddress = hasAddressKeyword || hasAddressNumber;

  return {
    wordsCount,
    explicitFields,
    hasFood,
    hasAddress,
    hasPayment,
    hasOrderVerb
  };
}

function isManualOrder(text) {
  const signals = orderSignals(text);

  return signals.explicitFields >= 2
    || (signals.hasFood && signals.hasAddress && signals.wordsCount >= 10)
    || (signals.hasFood && signals.hasAddress && signals.hasPayment)
    || (signals.hasFood && signals.hasPayment && signals.wordsCount >= 10);
}

function isOrderDraft(text) {
  const signals = orderSignals(text);

  return signals.explicitFields >= 1
    || (signals.hasFood && signals.hasOrderVerb)
    || (signals.hasFood && signals.hasPayment)
    || hasAny(text, ["meu pedido", "pedido novo"]);
}

function isOrderHelpRequest(text) {
  return hasAny(text, [
    "nao entendi",
    "nao sei pedir",
    "nao sei fazer pedido",
    "como pedir",
    "como faco pedido",
    "como fazer pedido",
    "como funciona o pedido",
    "forma de fazer o pedido",
    "me ajuda a pedir",
    "ajuda pedido",
    "onde pedir",
    "onde faco pedido"
  ]);
}

function isOrderStartRequest(text) {
  return hasAny(text, [
    "quero fazer pedido",
    "queria fazer pedido",
    "fazer pedido",
    "fazer um pedido",
    "quero pedir",
    "queria pedir",
    "pedir por aqui",
    "pedido pelo whatsapp",
    "pedir pelo whatsapp",
    "fazer pedido comigo",
    "pedir com voce"
  ]);
}

function cameFromMiniSite(text) {
  return hasAny(text, [
    "vim pelo mini site",
    "vim pelo site",
    "mini site",
    "site da bck",
    "quero atendimento",
    "quero ajuda para escolher meu pedido"
  ]);
}

function isUnsupportedIncomingText(text) {
  return text.startsWith("__unsupported__:");
}

function looksLikeOrderStart(text) {
  const signals = orderSignals(text);
  return signals.hasFood && (signals.hasAddress || signals.hasPayment || signals.hasOrderVerb);
}

function isOrderStatusRequest(text) {
  if (!text || hasFoodSignal(text) || hasPaymentSignal(text)) return false;
  return hasAny(text, [
    "status",
    "o que ja anotei",
    "o que voce anotou",
    "o que vc anotou",
    "como esta meu pedido",
    "como ta meu pedido",
    "ver pedido",
    "pedido atual",
    "resumo do pedido",
    "meu pedido"
  ]);
}

function isNonOrderMessage(text) {
  return NON_ORDER_MESSAGES.some((message) => text === message || text.includes(message));
}

function isCancelRequest(text) {
  return hasAny(text, [
    "cancelar",
    "cancela",
    "quero menu",
    "depois eu vejo",
    "nao quero mais",
    "não quero mais",
    "voltar"
  ]);
}

function isPositiveConfirmation(text) {
  return [
    "sim",
    "ok",
    "isso",
    "pode enviar",
    "ta certo",
    "tá certo",
    "certo",
    "confirmado",
    "pode mandar"
  ].some((answer) => text === normalize(answer) || text.includes(normalize(answer)));
}

function isChangeRequest(text) {
  return hasAny(text, [
    "nao",
    "não",
    "errado",
    "quero mudar",
    "alterar",
    "corrigir",
    "mudar"
  ]);
}

function isDraftCompletion(text) {
  const signals = orderSignals(text);
  if (isClarifyingQuestion(text)) return false;

  const hasDeliveryDetails = signals.hasAddress
    || hasAny(text, [
      "referencia",
      "referencia:",
      "portao",
      "proximo",
      "perto",
      "esquina",
      "retirar",
      "retirada",
      "buscar"
    ]);

  return signals.explicitFields >= 1
    || (hasDeliveryDetails && signals.hasPayment)
    || (hasDeliveryDetails && signals.wordsCount >= 5);
}

function isClarifyingQuestion(text) {
  return text.includes("?")
    || hasAny(text, [
      "quanto",
      "qual valor",
      "qual preco",
      "aceita",
      "tem ",
      "pode",
      "consegue",
      "entrega",
      "taxa",
      "funciona",
      "aberto"
    ]);
}

function shouldResetConversation(text) {
  if (!text) return false;
  return RESET_KEYWORDS.some((keyword) => keyword && text === keyword)
    || RESET_KEYWORDS.some((keyword) => keyword && text.includes(keyword));
}

function shouldResetHumanHandoff(text) {
  return shouldResetConversation(text);
}

function isHumanRequest(text) {
  return hasAny(text, [
    "humano",
    "atendente",
    "pessoa",
    "responsavel",
    "falar com alguem",
    "falar com uma pessoa",
    "falar com atendente"
  ]);
}

function isRepeatOrderRequest(text) {
  return hasAny(text, [
    "mesmo pedido",
    "pedido de ontem",
    "igual ontem",
    "igual ao anterior",
    "repetir pedido",
    "repete o pedido"
  ]);
}

function isPickupRequest(text) {
  return hasAny(text, [
    "retirar",
    "retirada",
    "buscar",
    "pegar ai",
    "pegar no local",
    "balcao",
    "no local"
  ]);
}

function isGiftQuestion(text) {
  return hasAny(text, ["brinde", "gratis", "gratuito", "refri gratis", "acima de 100", "mais de 100"]);
}

function isPriceQuestion(text) {
  return hasAny(text, ["quanto fica", "quanto da", "qual valor", "valor", "preco", "precos", "total", "muda o preco"]);
}

function isPizzaFlavorQuestion(text) {
  return hasAny(text, ["meio a meio", "meia a meia", "dois sabores", "2 sabores", "sabor", "sabores"]);
}

function isCustomizationQuestion(text) {
  return hasAny(text, [
    "sem ",
    "tirar",
    "retirar",
    "trocar",
    "troca",
    "substituir",
    "nao quero",
    "observacao",
    "alergia",
    "alergico",
    "intolerancia"
  ]);
}

function formatCustomerOrder(orderText) {
  const cleaned = String(orderText || "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!cleaned) return "Pedido informado na conversa.";
  if (cleaned.length <= 900) return cleaned;

  return `${cleaned.slice(0, 900).trim()}\n...(pedido muito longo, equipe vai conferir a mensagem completa acima)`;
}

function isGreeting(text) {
  const exactGreetings = ["oi", "ola", "opa", "bom dia", "boa tarde", "boa noite", "e ai"];
  if (exactGreetings.includes(text)) return true;

  return ["oi", "ola", "opa", "bom dia", "boa tarde", "boa noite"].some((greeting) => {
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

if (process.env.NODE_ENV === "test") {
  exports._test = {
    buildAutoReply,
    isManualOrder,
    isOrderDraft,
    isDraftCompletion
  };
}
