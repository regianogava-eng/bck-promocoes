const crypto = require("crypto");
let OpenAIClient = null;
try {
  const openAIImport = require("openai");
  OpenAIClient = openAIImport.OpenAI || openAIImport.default || openAIImport;
} catch {
  OpenAIClient = null;
}

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,X-Hub-Signature-256"
};

const SITE_FALLBACK = "https://beerchicken-bck.netlify.app";
const STORE_NAME = process.env.BCK_STORE_NAME || "BCK Beer Chicken";
const CITY = process.env.BCK_CITY || "Cachoeiro";
const MAPS_CITY = process.env.BCK_MAPS_CITY || "Cachoeiro de Itapemirim - ES";
const DEFAULT_HOURS = process.env.BCK_OPERATING_HOURS || "Todos os dias, das 17h as 00h";
const AI_ASSISTANT_NAME = process.env.BCK_AI_ASSISTANT_NAME || "Bibi";
const AI_ASSISTANT_KEYWORD = normalize(process.env.BCK_AI_ASSISTANT_KEYWORD || "BIBI");
const SESSION_STORE = "bck-whatsapp-sessions";
const BIBI_ORDERS_STORE = "bck-bibi-orders";
const BIBI_NOTIFY_LOG_STORE = "bck-bibi-notification-logs";
const BIBI_PENDING_ORDER_STATUS = "aguardando_aprovacao_humana";
const AI_INTERPRETER_ENABLED = process.env.BCK_AI_INTERPRETER_ENABLED === "true";
const AI_INTERPRETER_MODEL = process.env.BCK_AI_INTERPRETER_MODEL || "gpt-4o-mini";
const CEP_LOOKUP_ENABLED = process.env.BCK_CEP_LOOKUP_ENABLED !== "false";
const CEP_LOOKUP_TIMEOUT_MS = Math.max(500, Number(process.env.BCK_CEP_LOOKUP_TIMEOUT_MS || 2500));
const BIBI_VERSION = "2026-06-16-v32-cep-maps-v3";
const SERVICE_MODES = {
  ATTENDANT: "atendente",
  SELLER: "vendedora",
  EXPRESS: "expresso"
};
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
const CHANGE_KEYWORDS = [
  "troco",
  "trico",
  "troca",
  "trocco"
].map(normalize);
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
  "familia",
  "família",
  "maracana",
  "maracanã",
  "pequena",
  "portuguesa",
  "porcao",
  "porcoes",
  "carne",
  "file",
  "polenta",
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
    const params = event.queryStringParameters || {};
    if (params.bck_health === "1") {
      return json(200, {
        ok: true,
        version: BIBI_VERSION,
        storeNotifyNumber: normalizeStoreNotifyNumber(process.env.BCK_STORE_NOTIFY_NUMBER || "5528999329677"),
        aiInterpreterEnabled: AI_INTERPRETER_ENABLED,
        aiInterpreterModel: AI_INTERPRETER_MODEL,
        aiInterpreterAccess: hasAIInterpreterAccess(),
        aiInterpreterSource: aiCredentialSource(),
        aiInterpreterSdkLoaded: Boolean(OpenAIClient),
        cepLookupEnabled: CEP_LOOKUP_ENABLED
      });
    }

    if (params.bck_notify_logs === "1") {
      return listNotificationLogs(event);
    }

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

  const statuses = extractMessageStatuses(payload);
  const statusUpdates = statuses.length ? await handleMessageStatuses(statuses) : [];
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

  return json(200, { ok: true, received: messages.length, statuses: statusUpdates.length, replies });
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

function extractMessageStatuses(payload) {
  const statuses = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change.value || {};
      const outgoingStatuses = Array.isArray(value.statuses) ? value.statuses : [];
      for (const item of outgoingStatuses) {
        statuses.push({
          id: item.id || "",
          status: item.status || "",
          timestamp: item.timestamp || "",
          recipientId: item.recipient_id || "",
          conversationId: item.conversation?.id || "",
          errors: Array.isArray(item.errors) ? item.errors : [],
          raw: item
        });
      }
    }
  }

  return statuses.filter((status) => status.id && status.status);
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
    chars: rawText.length,
    mode: classifyServiceMode(text, session),
    peak: isPeakServiceHour()
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
    result = await handleForwardedState({ message, session, rawText, text, siteUrl });
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
  const menuOrderStart = looksLikeOrderStart(text);
  const serviceMode = classifyServiceMode(text, session);

  if (serviceMode === SERVICE_MODES.SELLER) {
    const next = collectingSession(emptyOrderData(), "seller_guidance");
    logStateChanged(message.from, session.state, next.state, "seller_guidance");
    return withSession(next, sellerGuidanceReply(siteUrl, text));
  }

  if (isGenericPizzaRequest(text)) {
    const next = collectingSession(emptyOrderData(), "pizza_guidance");
    logStateChanged(message.from, session.state, next.state, "pizza_guidance");
    return withSession(next, pizzaGuidanceReply());
  }

  if (isGenericChickenRequest(text)) {
    const next = collectingSession(emptyOrderData(), "chicken_guidance");
    logStateChanged(message.from, session.state, next.state, "chicken_guidance");
    return withSession(next, chickenGuidanceReply());
  }

  if (isChoice(text, "1") || hasAny(text, ["cardapio", "cardápio", "promocao", "promocoes", "oferta", "ofertas"])) {
    return withSession(menuSession(), catalogReply(siteUrl, `${siteUrl}#catalogo`, `${siteUrl}#monte-seu-combo`));
  }

  if (isChoice(text, "2") || isOrderStartRequest(text)) {
    const next = collectingSession(emptyOrderData(), "start_order");
    logStateChanged(message.from, session.state, next.state, "start_order");
    return withSession(next, startCollectingReply(siteUrl, { mode: serviceMode }));
  }

  if (isChoice(text, "3") || (!menuOrderStart && hasAny(text, ["taxa", "entrega", "endereco", "bairro", "localizacao"]))) {
    return withSession(menuSession(), deliveryReply(siteUrl));
  }

  if (isChoice(text, "4") || (!menuOrderStart && hasAny(text, ["pagamento", "pix", "dinheiro", "cartao", "cartão", "maquininha"]))) {
    return withSession(menuSession(), paymentReply(siteUrl));
  }

  if (isChoice(text, "5") || isHumanRequest(text) || hasAny(text, ["atendimento humano", "falar com equipe", "falar com humano"])) {
    const teamNotification = await notifyStoreHumanRequest(message.from, message.id);
    if (!teamNotification.ok) {
      console.error("BCK_BIBI_HUMAN_NOTIFY_FAILED", JSON.stringify({
        customer: maskPhone(message.from),
        error: teamNotification.error,
        status: teamNotification.status || null,
        detail: teamNotification.detail || null
      }));
    } else {
      console.log("BCK_BIBI_HUMAN_NOTIFY_SENT", JSON.stringify({
        customer: maskPhone(message.from),
        logId: teamNotification.notificationLog?.logId || null,
        metaMessageId: teamNotification.messageId || null
      }));
    }

    const next = forwardedSession(session.data, "human_requested");
    logStateChanged(message.from, session.state, next.state, "human_requested");
    return withSession(next, humanReply(teamNotification.ok));
  }

  if (isAssistantRequest(text) || isMenuRequest(text) || isGreeting(text) || cameFromMiniSite(text)) {
    return withSession(menuSession(), cameFromMiniSite(text) ? miniSiteMenuReply(siteUrl) : mainMenu(siteUrl));
  }

  if (menuOrderStart) {
    const data = mergeOrderData(emptyOrderData(), await extractOrderFieldsSmart(rawText, emptyOrderData(), "menu_order"));
    const next = collectingSession(data, "partial_order_from_menu");
    const completeness = orderCompleteness(next.data);
    logStateChanged(message.from, session.state, next.state, "partial_order_from_menu");

    if (completeness.complete) {
      return forwardCompletedOrder(message, next, "complete_from_menu");
    }

    return withSession(next, askMissingFieldsReply(next.data, completeness.missing, { mode: serviceMode }));
  }

  return withSession(menuSession(), mainMenu(siteUrl));
}

async function handleCollectingState({ message, session, rawText, text, siteUrl }) {
  const data = session.data || emptyOrderData();
  const serviceMode = classifyServiceMode(text, session);

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

  if (!next.data.items.length && serviceMode === SERVICE_MODES.SELLER) {
    return withSession(next, sellerGuidanceReply(siteUrl, text));
  }

  if (!next.data.items.length && isGenericPizzaRequest(text)) {
    return withSession(next, pizzaGuidanceReply());
  }

  if (!next.data.items.length && isGenericChickenRequest(text)) {
    return withSession(next, chickenGuidanceReply());
  }

  if (isOnlyMissingChange(pendingBefore) && shouldAnswerChange(text)) {
    next.data = {
      ...next.data,
      changeFor: parseChangeAnswer(text, { allowNumericOnly: true }) || "nao"
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
    return withSession(next, askMissingFieldsReply(next.data, ["troco"], { mode: serviceMode }));
  }

  if (isNonOrderMessage(text)) {
    return withSession(next, continueCollectingReply(next.data));
  }

  const incoming = contextualizeIncomingOrderData(await extractOrderFieldsSmart(rawText, next.data, "collecting_order"), next.data, rawText);
  next.data = mergeOrderData(next.data, incoming);
  const completeness = orderCompleteness(next.data);

  if (completeness.complete) {
    return forwardCompletedOrder(message, next, "all_fields_collected");
  }

  return withSession(next, askMissingFieldsReply(next.data, completeness.missing, { mode: serviceMode }));
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
    return forwardCompletedOrder(message, session, "confirmed");
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
  const orderRecord = buildPhaseOneOrderRecord({
    customerPhone: message.from,
    data: session.data,
    reason,
    sourceMessageId: message.id
  });
  const queueResult = await savePhaseOneOrder(orderRecord);

  if (!queueResult.ok) {
    console.error("BCK_BIBI_ORDER_QUEUE_FAILED", JSON.stringify({
      customer: maskPhone(message.from),
      orderId: orderRecord.id,
      error: queueResult.error
    }));
  } else {
    console.log("BCK_BIBI_ORDER_QUEUED", JSON.stringify({
      customer: maskPhone(message.from),
      orderId: orderRecord.id,
      status: orderRecord.status
    }));
  }

  const storeNotification = await notifyStoreManualOrder(message.from, summary, orderRecord, queueResult);
  if (!storeNotification.ok) {
    console.error("BCK_BIBI_STORE_NOTIFY_FAILED", JSON.stringify({
      customer: maskPhone(message.from),
      orderId: orderRecord.id,
      error: storeNotification.error,
      status: storeNotification.status || null,
      detail: storeNotification.detail || null
    }));
  } else {
    console.log("BCK_BIBI_STORE_NOTIFY_SENT", JSON.stringify({
      customer: maskPhone(message.from),
      orderId: orderRecord.id,
      logId: storeNotification.notificationLog?.logId || null,
      metaMessageId: storeNotification.messageId || null,
      chars: summary.length
    }));
  }

  const next = forwardedSession(session.data, reason);
  logStateChanged(message.from, session.state, next.state, reason);

  if (!storeNotification.ok) {
    return withSession(next, [
      "Recebi seu pedido e montei o resumo para conferencia.",
      `Protocolo: ${orderRecord.id}`,
      "",
      "Mas nao consegui avisar a equipe automaticamente agora.",
      "",
      "Resumo do pedido:",
      summary,
      "",
      "Por favor, chame a equipe no numero oficial: (28) 99932-9677."
    ].join("\n"));
  }

  return withSession(next, [
    "Certo, recebi e encaminhei seu pedido para a equipe conferir antes de confirmar.",
    `Protocolo: ${orderRecord.id}`,
    "",
    summary,
    "",
    "Eles vao conferir valores, disponibilidade e detalhes do pedido, depois te respondem por aqui com a confirmacao."
  ].join("\n"));
}

async function handleForwardedState({ message, session, rawText, text, siteUrl }) {
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

  if (isChoice(text, "5") || isHumanRequest(text) || hasAny(text, ["atendimento humano", "falar com equipe", "falar com humano"])) {
    const teamNotification = await notifyStoreHumanRequest(message.from);
    if (!teamNotification.ok) {
      console.error("BCK_BIBI_HUMAN_NOTIFY_FAILED", JSON.stringify({
        customer: maskPhone(message.from),
        error: teamNotification.error,
        status: teamNotification.status || null,
        detail: teamNotification.detail || null
      }));
    } else {
      console.log("BCK_BIBI_HUMAN_NOTIFY_SENT", JSON.stringify({
        customer: maskPhone(message.from),
        logId: teamNotification.notificationLog?.logId || null,
        metaMessageId: teamNotification.messageId || null
      }));
    }

    const next = forwardedSession(session.data, "human_requested_again");
    return withSession(next, humanReply(teamNotification.ok));
  }

  if (isChoice(text, "2") || isOrderStartRequest(text)) {
    const next = collectingSession(emptyOrderData(), "start_order_after_handoff");
    logStateChanged(message.from, session.state, next.state, "start_order_after_handoff");
    return withSession(next, startCollectingReply(siteUrl, { mode: classifyServiceMode(text, session) }));
  }

  if (looksLikeOrderStart(text)) {
    const data = mergeOrderData(emptyOrderData(), await extractOrderFieldsSmart(rawText, emptyOrderData(), "handoff_order"));
    const next = collectingSession(data, "order_after_handoff");
    const completeness = orderCompleteness(next.data);
    logStateChanged(message.from, session.state, next.state, "order_after_handoff");

    if (completeness.complete) {
      return forwardCompletedOrder(message, next, "complete_after_handoff");
    }

    return withSession(next, askMissingFieldsReply(next.data, completeness.missing, { mode: classifyServiceMode(text, session) }));
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
    console.error("WhatsApp send failed", JSON.stringify({
      to: maskPhone(to),
      status: response.status,
      detail
    }));
    return {
      ok: false,
      error: "whatsapp_send_failed",
      status: response.status,
      detail: safeJsonDetail(detail)
    };
  }

  let responseBody = {};
  try {
    responseBody = await response.json();
  } catch {
    responseBody = {};
  }

  return {
    ok: true,
    messageId: responseBody?.messages?.[0]?.id || "",
    contacts: Array.isArray(responseBody?.contacts) ? responseBody.contacts : [],
    raw: responseBody
  };
}

function safeJsonDetail(detail) {
  try {
    const parsed = JSON.parse(detail);
    const error = parsed?.error || parsed;
    return {
      message: error?.message || "",
      code: error?.code || null,
      subcode: error?.error_subcode || null,
      title: error?.error_user_title || ""
    };
  } catch {
    return { message: String(detail || "").slice(0, 300) };
  }
}

async function notifyStoreManualOrder(customerPhone, orderText, orderRecord = null, queueResult = null) {
  const to = normalizeStoreNotifyNumber(process.env.BCK_STORE_NOTIFY_NUMBER || "5528999329677");
  if (!to) {
    return { ok: false, error: "store_notify_number_missing" };
  }

  const body = formatManualOrderNotification(customerPhone, orderText, orderRecord, queueResult);
  const sent = await sendTextMessage(to, body);
  const notificationLog = await saveStoreNotificationLog({
    type: "store_order_review",
    to,
    customerPhone,
    orderId: orderRecord?.id || "",
    body,
    sendResult: sent
  });

  return { ...sent, notificationLog };
}

async function notifyStoreHumanRequest(customerPhone, sourceMessageId = "") {
  const to = normalizeStoreNotifyNumber(process.env.BCK_STORE_NOTIFY_NUMBER || "5528999329677");
  if (!to) {
    return { ok: false, error: "store_notify_number_missing" };
  }

  const body = formatHumanRequestNotification(customerPhone);
  const sent = await sendTextMessage(to, body);
  const notificationLog = await saveStoreNotificationLog({
    type: "store_human_request",
    to,
    customerPhone,
    sourceMessageId,
    body,
    sendResult: sent
  });

  return { ...sent, notificationLog };
}

function normalizeStoreNotifyNumber(value = "") {
  const digits = onlyDigits(value);
  if (!digits) return "";
  if (digits.startsWith("55")) return digits;
  if (digits.length === 11) return `55${digits}`;
  if (digits.length === 9) return `5528${digits}`;
  return digits;
}

function formatHumanRequestNotification(customerPhone) {
  const receivedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  return [
    "ATENDIMENTO SOLICITADO VIA BIBI",
    "",
    `Cliente WhatsApp: +${onlyDigits(customerPhone)}`,
    `Recebido: ${receivedAt}`,
    "",
    "O cliente escolheu a opcao 5 - Falar com a equipe.",
    "Acompanhe a conversa da Bibi/Cloud API ou chame o cliente pelo telefone acima."
  ].join("\n");
}

function formatManualOrderNotification(customerPhone, orderText, orderRecord = null, queueResult = null) {
  const receivedAt = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const warnings = orderRecord?.review?.warnings || [];
  const mapLinks = orderMapLinks(orderText);
  const queueWarning = queueResult && !queueResult.ok
    ? ["Fila interna: nao salvou automaticamente. Conferir pela conversa da Bibi/Cloud API."]
    : [];

  return [
    "NOVO PEDIDO BIBI - CONFERIR",
    "",
    orderRecord?.id ? `Protocolo: ${orderRecord.id}` : "",
    `Status: ${orderRecord?.status || BIBI_PENDING_ORDER_STATUS}`,
    "",
    `Cliente WhatsApp: +${onlyDigits(customerPhone)}`,
    `Recebido: ${receivedAt}`,
    "",
    "PEDIDO MONTADO PELA BIBI:",
    "",
    formatCustomerOrderForTeam(orderText),
    "",
    mapLinks.length ? "ROTAS:" : "",
    ...mapLinks,
    mapLinks.length ? "" : "",
    "ATENCAO:",
    "A Bibi nao confirmou preco, taxa, disponibilidade nem regra de promocao.",
    "Conferir tamanho, sabores, borda/adicionais, pagamento e troco antes de confirmar.",
    "",
    warnings.length ? "PONTOS PARA CONFERIR:" : "",
    ...warnings.map((warning) => `- ${warning}`),
    ...queueWarning,
    "",
    "Acesse a conversa da Bibi/Cloud API ou chame o cliente pelo telefone acima para confirmar."
  ].filter((line, index, lines) => line !== "" || lines[index - 1] !== "").join("\n");
}

async function saveStoreNotificationLog({ type, to, customerPhone, orderId = "", sourceMessageId = "", body = "", sendResult = {} } = {}) {
  const now = new Date().toISOString();
  const metaMessageId = sendResult.messageId || "";
  const logId = createNotificationLogId(metaMessageId);
  const status = sendResult.ok ? "accepted_by_meta" : "send_failed";
  const record = {
    id: logId,
    type: type || "store_notification",
    status,
    createdAt: now,
    updatedAt: now,
    to: onlyDigits(to),
    customerPhone: onlyDigits(customerPhone),
    orderId,
    sourceMessageId,
    metaMessageId,
    messageChars: String(body || "").length,
    messagePreview: String(body || "").slice(0, 500),
    sendError: sendResult.ok ? null : sendResult.error || "unknown_send_error",
    sendDetail: sendResult.ok ? null : sendResult.detail || null,
    contacts: sendResult.contacts || [],
    statusHistory: [{
      status,
      at: now,
      source: "send_api",
      metaMessageId
    }]
  };

  try {
    const store = await getBlobStore(BIBI_NOTIFY_LOG_STORE);
    await store.setJSON(`logs/${logId}`, record, {
      metadata: notificationMetadata(record)
    });

    if (metaMessageId) {
      await store.setJSON(notificationMessageKey(metaMessageId), record, {
        metadata: notificationMetadata(record)
      });
    }

    if (orderId) {
      await store.setJSON(`orders/${orderId}/${logId}`, {
        id: logId,
        orderId,
        metaMessageId,
        status,
        to: record.to,
        createdAt: now
      }, {
        metadata: notificationMetadata(record)
      });
    }

    console.log("BCK_BIBI_STORE_NOTIFY_ACCEPTED", JSON.stringify({
      logId,
      orderId: orderId || null,
      to: maskPhone(record.to),
      customer: maskPhone(record.customerPhone),
      metaMessageId: metaMessageId || null,
      status
    }));

    return { ok: true, logId, metaMessageId, status };
  } catch (error) {
    console.error("BCK_BIBI_STORE_NOTIFY_LOG_FAILED", JSON.stringify({
      logId,
      orderId: orderId || null,
      to: maskPhone(to),
      error: error?.message || String(error)
    }));
    return { ok: false, logId, metaMessageId, status, error: error?.message || String(error) };
  }
}

async function handleMessageStatuses(statuses = []) {
  const updates = [];

  for (const status of statuses) {
    updates.push(await saveStoreNotificationStatus(status));
  }

  return updates;
}

async function saveStoreNotificationStatus(status = {}) {
  const now = new Date().toISOString();
  const statusAt = metaTimestampToIso(status.timestamp) || now;
  const messageKey = notificationMessageKey(status.id);

  try {
    const store = await getBlobStore(BIBI_NOTIFY_LOG_STORE);
    const existing = await store.get(messageKey, { consistency: "strong", type: "json" });
    const historyEntry = {
      status: status.status,
      at: statusAt,
      receivedAt: now,
      source: "meta_webhook_status",
      recipientId: onlyDigits(status.recipientId),
      conversationId: status.conversationId || "",
      errors: safeStatusErrors(status.errors)
    };
    const record = existing && typeof existing === "object"
      ? {
          ...existing,
          status: status.status,
          updatedAt: now,
          to: existing.to || onlyDigits(status.recipientId),
          recipientId: onlyDigits(status.recipientId),
          conversationId: status.conversationId || existing.conversationId || "",
          statusHistory: [...(Array.isArray(existing.statusHistory) ? existing.statusHistory : []), historyEntry]
        }
      : {
          id: createNotificationLogId(status.id),
          type: "whatsapp_status_without_send_log",
          status: status.status,
          createdAt: now,
          updatedAt: now,
          to: onlyDigits(status.recipientId),
          recipientId: onlyDigits(status.recipientId),
          customerPhone: "",
          orderId: "",
          metaMessageId: status.id,
          conversationId: status.conversationId || "",
          statusHistory: [historyEntry]
        };

    await store.setJSON(messageKey, record, {
      metadata: notificationMetadata(record)
    });
    await store.setJSON(`logs/${record.id}`, record, {
      metadata: notificationMetadata(record)
    });

    console.log("BCK_BIBI_STORE_MESSAGE_STATUS", JSON.stringify({
      logId: record.id,
      orderId: record.orderId || null,
      to: maskPhone(record.to || record.recipientId),
      metaMessageId: status.id,
      status: status.status,
      at: statusAt,
      errors: historyEntry.errors.length
    }));

    return { ok: true, logId: record.id, status: status.status, metaMessageId: status.id };
  } catch (error) {
    console.error("BCK_BIBI_STORE_MESSAGE_STATUS_FAILED", JSON.stringify({
      metaMessageId: status.id || null,
      status: status.status || null,
      error: error?.message || String(error)
    }));
    return { ok: false, status: status.status || "", metaMessageId: status.id || "", error: error?.message || String(error) };
  }
}

function createNotificationLogId(metaMessageId = "") {
  const now = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const hash = metaMessageId
    ? crypto.createHash("sha256").update(metaMessageId).digest("hex").slice(0, 10).toUpperCase()
    : crypto.randomBytes(3).toString("hex").toUpperCase();
  return `NOTIFY-${now}-${hash}`;
}

function notificationMessageKey(metaMessageId = "") {
  const hash = crypto.createHash("sha256").update(String(metaMessageId || "")).digest("hex");
  return `messages/${hash}`;
}

function notificationMetadata(record = {}) {
  return {
    status: record.status || "",
    type: record.type || "",
    to: record.to || record.recipientId || "",
    orderId: record.orderId || "",
    metaMessageId: record.metaMessageId || "",
    updatedAt: record.updatedAt || ""
  };
}

function metaTimestampToIso(value = "") {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Date(timestamp * 1000).toISOString();
}

function safeStatusErrors(errors = []) {
  return (Array.isArray(errors) ? errors : []).map((error) => ({
    code: error?.code || null,
    title: error?.title || "",
    message: error?.message || error?.error_data?.details || "",
    details: error?.error_data?.details || ""
  }));
}

async function listNotificationLogs(event) {
  const auth = notificationLogAuth(event);
  if (!auth.ok) {
    return json(auth.statusCode, {
      ok: false,
      error: auth.error,
      message: auth.message
    });
  }

  const params = event.queryStringParameters || {};
  const limit = Math.min(50, Math.max(1, Number(params.limit || 20)));

  try {
    const store = await getBlobStore(BIBI_NOTIFY_LOG_STORE);
    const listed = await store.list({ prefix: "logs/" });
    const blobs = Array.isArray(listed?.blobs) ? listed.blobs : [];
    const records = [];

    for (const blob of blobs.slice(-100)) {
      const record = await store.get(blob.key, { consistency: "strong", type: "json" });
      if (record) records.push(redactNotificationLog(record));
    }

    records.sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

    return json(200, {
      ok: true,
      version: BIBI_VERSION,
      count: Math.min(records.length, limit),
      logs: records.slice(0, limit)
    });
  } catch (error) {
    return json(500, {
      ok: false,
      error: "notification_log_read_failed",
      message: error?.message || String(error)
    });
  }
}

function notificationLogAuth(event) {
  const expected = process.env.BCK_NOTIFY_LOG_TOKEN || process.env.BCK_ADMIN_TOKEN || "";
  if (!expected) {
    return {
      ok: false,
      statusCode: 503,
      error: "notification_log_token_not_configured",
      message: "Configure BCK_NOTIFY_LOG_TOKEN no Netlify para consultar os logs com seguranca."
    };
  }

  const params = event.queryStringParameters || {};
  const headers = event.headers || {};
  const provided = params.token
    || headers["x-bck-log-token"]
    || headers["X-Bck-Log-Token"]
    || "";

  if (provided !== expected) {
    return {
      ok: false,
      statusCode: 403,
      error: "notification_log_forbidden",
      message: "Token invalido para consultar logs."
    };
  }

  return { ok: true };
}

function redactNotificationLog(record = {}) {
  const history = Array.isArray(record.statusHistory) ? record.statusHistory : [];
  const preview = redactPhonesInText(record.messagePreview || "");
  return {
    id: record.id || "",
    type: record.type || "",
    status: record.status || "",
    createdAt: record.createdAt || "",
    updatedAt: record.updatedAt || "",
    to: maskPhone(record.to || record.recipientId || ""),
    customerPhone: maskPhone(record.customerPhone || ""),
    orderId: record.orderId || "",
    metaMessageId: record.metaMessageId || "",
    messageChars: record.messageChars || 0,
    messagePreview: preview ? `${preview.slice(0, 120)}...` : "",
    sendError: record.sendError || null,
    statusHistory: history.map((entry) => ({
      status: entry.status || "",
      at: entry.at || "",
      receivedAt: entry.receivedAt || "",
      source: entry.source || "",
      errors: Array.isArray(entry.errors) ? entry.errors.length : 0
    }))
  };
}

function redactPhonesInText(value = "") {
  return String(value || "").replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => {
    const digits = onlyDigits(match);
    return digits ? maskPhone(digits) : "********";
  });
}

function buildPhaseOneOrderRecord({ customerPhone, data = emptyOrderData(), reason = "completed", sourceMessageId = "" } = {}) {
  const order = normalizeOrderData(data);
  const now = new Date().toISOString();
  const items = order.items.map((item, index) => buildPhaseOneItem(item, index));
  const record = {
    id: createBibiOrderId(now),
    source: "bibi-whatsapp",
    phase: "fase_1_human_review",
    status: BIBI_PENDING_ORDER_STATUS,
    createdAt: now,
    updatedAt: now,
    reason,
    customer: {
      phone: onlyDigits(customerPhone),
      name: order.name || ""
    },
    delivery: {
      address: order.address || "",
      reference: ""
    },
    items,
    payment: {
      method: order.payment || "",
      label: order.payment ? paymentLabel(order.payment) : "",
      changeFor: order.payment === "dinheiro" ? order.changeFor || "" : ""
    },
    notes: order.notes || "",
    pricing: {
      calculatedByBibi: false,
      total: null,
      currency: "BRL",
      note: "Preco, taxa e promocao devem ser conferidos por humano antes da confirmacao."
    },
    review: {
      required: true,
      owner: "equipe_bck",
      warnings: phaseOneWarnings(order)
    },
    rawSummary: formatOrderSummary(order),
    sourceMessageId: sourceMessageId || ""
  };

  return record;
}

function buildPhaseOneItem(item, index) {
  const raw = String(item || "").trim();
  const hasQuantity = itemHasQuantity(raw);
  return {
    id: `item-${index + 1}`,
    raw,
    summary: hasQuantity ? raw : `1x ${raw}`,
    quantityAssumed: !hasQuantity,
    needsHumanReview: true
  };
}

function createBibiOrderId(dateIso = new Date().toISOString()) {
  const compactDate = String(dateIso)
    .replace(/\D/g, "")
    .slice(2, 14);
  const random = crypto.randomBytes(2).toString("hex").toUpperCase();
  return `BIBI-${compactDate}-${random}`;
}

function phaseOneWarnings(orderData = emptyOrderData()) {
  const order = normalizeOrderData(orderData);
  const warnings = [];

  if (!order.name) warnings.push("Nome do cliente nao identificado.");
  if (!order.address) warnings.push("Endereco nao identificado.");
  if (!order.items.length) warnings.push("Itens do pedido nao identificados.");
  if (!order.payment) warnings.push("Forma de pagamento nao identificada.");
  if (order.payment === "dinheiro" && !order.changeFor) warnings.push("Cliente informou dinheiro, mas nao informou troco.");

  for (const item of order.items) {
    if (!itemHasQuantity(item)) {
      warnings.push(`Quantidade assumida como 1 para: ${item}`);
    }

    const text = normalize(item);
    if (hasAny(text, ["meio a meio", "metade", "borda", "catupiry", "cheddar", "12 fatias", "12 pedacos", "maracana", "familia"])) {
      warnings.push(`Conferir tamanho, sabores e adicionais: ${item}`);
    }
  }

  return uniqueList(warnings);
}

async function savePhaseOneOrder(orderRecord) {
  if (!orderRecord?.id) {
    return { ok: false, error: "invalid_order_record" };
  }

  const key = `orders/${orderRecord.id}`;
  const customerKey = orderRecord.customer?.phone
    ? `customers/${orderRecord.customer.phone}/${orderRecord.id}`
    : "";

  try {
    const store = await getBlobStore(BIBI_ORDERS_STORE);
    await store.setJSON(key, orderRecord, {
      metadata: {
        status: orderRecord.status,
        phase: orderRecord.phase,
        phone: orderRecord.customer?.phone || "",
        createdAt: orderRecord.createdAt
      }
    });

    if (customerKey) {
      await store.setJSON(customerKey, {
        id: orderRecord.id,
        status: orderRecord.status,
        createdAt: orderRecord.createdAt,
        phone: orderRecord.customer.phone
      }, {
        metadata: {
          status: orderRecord.status,
          orderId: orderRecord.id
        }
      });
    }

    return { ok: true, key };
  } catch (error) {
    return {
      ok: false,
      key,
      error: error?.message || String(error)
    };
  }
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
    addressDraft: "",
    items: [],
    payment: "",
    changeFor: "",
    notes: ""
  };
}

function normalizeOrderData(data = {}) {
  const order = {
    ...emptyOrderData(),
    name: String(data.name || ""),
    address: String(data.address || ""),
    addressDraft: String(data.addressDraft || ""),
    payment: String(data.payment || ""),
    changeFor: String(data.changeFor || ""),
    notes: String(data.notes || ""),
    items: cleanOrderItems(Array.isArray(data.items) ? data.items.filter(Boolean).map(String) : [])
  };

  if (isSuspiciousAddress(order.address)) {
    order.address = "";
  }

  if (order.address) {
    order.addressDraft = "";
  }

  if (order.changeFor && !order.payment) {
    order.payment = "dinheiro";
  }

  if (order.payment !== "dinheiro") {
    order.changeFor = "";
  }

  return order;
}

const AI_ORDER_INTERPRETATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "name", "address", "items", "payment", "changeFor", "notes", "confidence", "warnings"],
  properties: {
    intent: {
      type: "string",
      enum: ["order", "question", "human_request", "noise"]
    },
    name: { type: "string" },
    address: { type: "string" },
    items: {
      type: "array",
      items: { type: "string" }
    },
    payment: {
      type: "string",
      enum: ["", "dinheiro", "pix", "cartao", "vale"]
    },
    changeFor: { type: "string" },
    notes: { type: "string" },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    warnings: {
      type: "array",
      items: { type: "string" }
    }
  }
};

async function extractOrderFieldsSmart(rawText = "", current = emptyOrderData(), context = "order") {
  let ruleExtraction = extractOrderFields(rawText);
  ruleExtraction = await enrichAddressWithCep(rawText, current, ruleExtraction);
  if (!shouldUseAIInterpreter(rawText)) return ruleExtraction;

  const aiResult = await interpretOrderFieldsWithAI(rawText, current, ruleExtraction, context);
  if (!aiResult.ok) {
    console.warn("BCK_BIBI_AI_INTERPRETER_SKIPPED", JSON.stringify({
      reason: aiResult.error || "unknown",
      context
    }));
    return ruleExtraction;
  }

  let merged = mergeRuleAndAIOrderData(ruleExtraction, aiResult.data);
  merged = await enrichAddressWithCep(rawText, current, merged);
  console.log("BCK_BIBI_AI_INTERPRETER_USED", JSON.stringify({
    context,
    confidence: aiResult.confidence,
    ruleFields: presentOrderFields(ruleExtraction),
    aiFields: presentOrderFields(aiResult.data),
    mergedFields: presentOrderFields(merged)
  }));

  return merged;
}

function shouldUseAIInterpreter(rawText = "") {
  if (!AI_INTERPRETER_ENABLED) return false;
  if (!hasAIInterpreterAccess()) return false;

  const text = normalize(rawText);
  if (!text || text.length < 8) return false;
  if (text.startsWith("__unsupported__") || isNonOrderMessage(text)) return false;

  return true;
}

function hasAIInterpreterAccess() {
  return Boolean(aiApiKey() && aiBaseUrl());
}

async function interpretOrderFieldsWithAI(rawText = "", current = emptyOrderData(), ruleExtraction = emptyOrderData(), context = "order") {
  const requestBody = {
    model: AI_INTERPRETER_MODEL,
    instructions: aiInterpreterInstructions(),
    input: JSON.stringify({
      context,
      currentOrder: normalizeOrderData(current),
      ruleExtraction: normalizeOrderData(ruleExtraction),
      customerMessage: String(rawText || "").slice(0, 1200)
    }),
    text: {
      format: {
        type: "json_schema",
        name: "bibi_order_interpretation",
        strict: true,
        schema: AI_ORDER_INTERPRETATION_SCHEMA
      }
    },
    max_output_tokens: 600
  };

  try {
    const body = await createAIResponse(requestBody);

    const text = openAIResponseText(body);
    if (!text) return { ok: false, error: "ai_response_empty" };

    const parsed = JSON.parse(text);
    const data = sanitizeAIOrderData(parsed);
    return {
      ok: true,
      data,
      confidence: Number(parsed.confidence || 0)
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error)
    };
  }
}

async function createAIResponse(requestBody) {
  if (OpenAIClient) {
    const options = {};
    const apiKey = aiApiKey();
    const baseURL = aiBaseUrl();
    if (apiKey) options.apiKey = apiKey;
    if (baseURL) options.baseURL = baseURL;

    const client = new OpenAIClient(options);
    return client.responses.create(requestBody);
  }

  const url = aiResponsesUrl();
  const apiKey = aiApiKey();
  if (!url || !apiKey) {
    const error = new Error("ai_credentials_missing");
    error.code = "ai_credentials_missing";
    throw error;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(requestBody)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body?.error?.message || body?.error || "ai_response_failed");
    error.code = "ai_response_failed";
    error.status = response.status;
    throw error;
  }

  return body;
}

function aiBaseUrl() {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL) {
    return cleanAIBaseUrl(process.env.OPENAI_BASE_URL);
  }

  if (process.env.NETLIFY_AI_GATEWAY_KEY && process.env.NETLIFY_AI_GATEWAY_BASE_URL) {
    return cleanAIBaseUrl(process.env.NETLIFY_AI_GATEWAY_BASE_URL);
  }

  if (process.env.OPENAI_API_KEY) return "https://api.openai.com/v1";
  return "";
}

function aiApiKey() {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  if (process.env.NETLIFY_AI_GATEWAY_KEY && process.env.NETLIFY_AI_GATEWAY_BASE_URL) {
    return process.env.NETLIFY_AI_GATEWAY_KEY;
  }
  return "";
}

function aiResponsesUrl() {
  const baseUrl = aiBaseUrl();
  if (!baseUrl) return "";
  return /\/v1$/i.test(baseUrl) ? `${baseUrl}/responses` : `${baseUrl}/v1/responses`;
}

function cleanAIBaseUrl(value = "") {
  return String(value || "").replace(/\/+$/, "");
}

function aiCredentialSource() {
  if (process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL) return "openai_env";
  if (process.env.NETLIFY_AI_GATEWAY_KEY && process.env.NETLIFY_AI_GATEWAY_BASE_URL) return "netlify_ai_gateway";
  if (process.env.OPENAI_API_KEY) return "openai_direct";
  if (process.env.OPENAI_BASE_URL || process.env.NETLIFY_AI_GATEWAY_BASE_URL) return "base_url_without_key";
  return "missing";
}

function aiInterpreterInstructions() {
  return [
    "Voce interpreta mensagens de WhatsApp da BCK Beer Chicken.",
    "A Bibi esta na fase segura: ela ajuda a vender, mas nao confirma pedido sozinha.",
    "Prioridade maxima: concluir o pedido sem atrapalhar cliente decidido.",
    "Extraia somente dados explicitamente presentes na mensagem do cliente.",
    "Nao invente preco, taxa, disponibilidade, promocao, brinde, prazo, total, telefone ou confirmacao.",
    "Seu trabalho e separar nome, endereco, itens, pagamento, troco e observacoes.",
    "Se o cliente ja mandou pedido claro, preserve os itens e nao crie sugestoes adicionais.",
    "Se o cliente estiver indeciso, ainda assim extraia apenas o que ele escreveu; sugestoes ficam fora do JSON.",
    "Se o cliente escrever 'troco', 'trico', 'troca' ou 'trocco' para/de/pra algum valor, isso e troco em dinheiro, nunca endereco.",
    "Endereco deve ser endereco de entrega. Pedido deve conter comida ou bebida.",
    "Itens devem conter apenas comida, bebida, tamanho, sabor e adicionais.",
    "Nunca coloque endereco, bairro, entrega, pagamento, troco ou nome dentro de itens.",
    "Se uma frase misturar pedido com entrega e troco, corte o item antes de entrega/endereco/troco/pagamento.",
    "Use strings vazias quando nao houver informacao suficiente.",
    "Responda somente no JSON estruturado solicitado."
  ].join(" ");
}

function openAIResponseText(body = {}) {
  if (typeof body.output_text === "string") return body.output_text;

  const output = Array.isArray(body.output) ? body.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part.text === "string") return part.text;
      if (typeof part.content === "string") return part.content;
    }
  }

  return "";
}

function sanitizeAIOrderData(value = {}) {
  const data = emptyOrderData();
  const name = String(value.name || "").trim();
  const address = String(value.address || "").trim();
  const payment = parsePayment(normalize(value.payment || ""));
  const changeFor = parseChangeAnswer(String(value.changeFor || ""), { allowNumericOnly: true })
    || parseChangeAnswer(`troco ${value.changeFor || ""}`);

  if (name && isValidName(name)) data.name = name;
  if (address && isValidAddress(address)) data.address = address;

  const items = Array.isArray(value.items) ? value.items : [];
  data.items = uniqueList(items
    .map((item) => String(item || "").trim())
    .map(cleanOrderItem)
    .filter((item) => item.length >= 3)
    .filter((item) => !isPaymentOrChangeLine(item))
    .filter((item) => !isValidAddress(item))
    .slice(0, 8));

  if (payment) data.payment = payment;
  if (changeFor) {
    data.changeFor = changeFor;
    if (!data.payment) data.payment = "dinheiro";
  }

  const notes = String(value.notes || "").trim();
  if (notes && notes.length <= 240) data.notes = notes;

  return normalizeOrderData(data);
}

function mergeRuleAndAIOrderData(ruleExtraction = emptyOrderData(), aiExtraction = emptyOrderData()) {
  const rule = normalizeOrderData(ruleExtraction);
  const ai = normalizeOrderData(aiExtraction);
  const merged = normalizeOrderData(rule);

  if (!merged.name && ai.name) merged.name = ai.name;
  if (!merged.address && ai.address) merged.address = ai.address;
  if (!merged.payment && ai.payment) merged.payment = ai.payment;
  if (!merged.changeFor && ai.changeFor) merged.changeFor = ai.changeFor;
  if (!merged.notes && ai.notes) merged.notes = ai.notes;

  const ruleItems = ai.items.length
    ? merged.items.filter((item) => !shouldReplaceRuleItemWithAI(item, ai.items))
    : merged.items;
  merged.items = cleanOrderItems([...ruleItems, ...ai.items]);

  return normalizeOrderData(merged);
}

function shouldReplaceRuleItemWithAI(ruleItem = "", aiItems = []) {
  const text = normalize(ruleItem);
  if (!text || !aiItems.length) return false;
  if (text.length < 45) return false;

  const hasCleanerAIItem = aiItems.some((item) => {
    const aiText = normalize(item);
    return aiText.length >= 8 && (text.includes(aiText) || aiText.includes(text));
  });
  const looksMixed = hasPaymentSignal(text)
    || hasAddressSignal(text)
    || hasAny(text, ["entrega", "entregar", "sou ", "meu nome", "troco", "troca", "pagamento"]);

  return hasCleanerAIItem || looksMixed;
}

async function enrichAddressWithCep(rawText = "", current = emptyOrderData(), incoming = emptyOrderData()) {
  const cep = extractCep(rawText);
  const weakAddress = isWeakNumberAddress(incoming.address);
  if (!CEP_LOOKUP_ENABLED || !cep || (incoming.address && !weakAddress)) return incoming;

  const cepAddress = await lookupCepAddress(cep);
  if (!cepAddress?.street) return incoming;

  const next = { ...incoming };
  const number = extractHouseNumberForCep(rawText);
  if (number) {
    next.address = formatCepAddress(cepAddress, number);
    next.addressDraft = "";
  } else if (!next.addressDraft || isCepOnlyAddress(next.addressDraft)) {
    next.addressDraft = formatCepAddressDraft(cepAddress);
  }

  if (next.addressDraft && normalize(current.addressDraft || "") === normalize(next.addressDraft)) {
    return incoming;
  }

  return next;
}

function extractCep(value = "") {
  const match = String(value || "").match(/(?:^|\D)(\d{5})-?(\d{3})(?:\D|$)/);
  return match ? `${match[1]}${match[2]}` : "";
}

function isCepOnlyAddress(value = "") {
  if (!extractCep(value)) return false;
  const withoutCep = normalize(value)
    .replace(/\bcep\b/g, "")
    .replace(/\b\d{5}-?\d{3}\b/g, "")
    .replace(/[^\w]+/g, "")
    .trim();
  return !withoutCep;
}

function isWeakNumberAddress(value = "") {
  const text = normalize(value);
  if (!text) return false;
  return /^\d{1,6}[a-zA-Z]?$/.test(text)
    || /^(?:numero|número|num|n|nº|casa)\s*[:º.\-]?\s*\d{1,6}[a-zA-Z]?$/.test(text);
}

async function lookupCepAddress(cep = "") {
  const cleanCep = extractCep(cep) || onlyDigits(cep).slice(0, 8);
  if (cleanCep.length !== 8) return null;

  const viaCep = await fetchCepJson(`https://viacep.com.br/ws/${cleanCep}/json/`);
  if (viaCep && !viaCep.erro) {
    return normalizeCepAddress({
      cep: viaCep.cep || cleanCep,
      street: viaCep.logradouro,
      neighborhood: viaCep.bairro,
      city: viaCep.localidade,
      state: viaCep.uf
    });
  }

  const brasilApi = await fetchCepJson(`https://brasilapi.com.br/api/cep/v2/${cleanCep}`);
  if (brasilApi && !brasilApi.errors) {
    return normalizeCepAddress({
      cep: brasilApi.cep || cleanCep,
      street: brasilApi.street,
      neighborhood: brasilApi.neighborhood,
      city: brasilApi.city,
      state: brasilApi.state
    });
  }

  return null;
}

async function fetchCepJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CEP_LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn("BCK_BIBI_CEP_LOOKUP_SKIPPED", JSON.stringify({
      message: error?.name === "AbortError" ? "timeout" : error?.message || String(error)
    }));
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeCepAddress(value = {}) {
  const address = {
    cep: formatCep(value.cep || ""),
    street: String(value.street || "").trim(),
    neighborhood: String(value.neighborhood || "").trim(),
    city: String(value.city || "").trim(),
    state: String(value.state || "").trim().toUpperCase()
  };

  if (!address.street || !address.neighborhood) return null;
  return address;
}

function formatCep(value = "") {
  const digits = onlyDigits(value);
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits;
}

function extractHouseNumberForCep(rawText = "") {
  const explicit = String(rawText || "").match(/\b(?:numero|número|num|n|nº|casa)\s*[:º.\-]?\s*(\d{1,6}[a-zA-Z]?)\b/i);
  if (explicit) return explicit[1];

  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const numericLine = lines.find((line) => /^\d{1,6}[a-zA-Z]?$/.test(line));
  return numericLine || "";
}

function formatCepAddress(address, number = "") {
  const street = [address.street, number].filter(Boolean).join(", ");
  return [
    street,
    address.neighborhood,
    [address.city, address.state].filter(Boolean).join(" - "),
    address.cep ? `CEP ${address.cep}` : ""
  ].filter(Boolean).join(" - ");
}

function formatCepAddressDraft(address) {
  return [
    address.street,
    address.neighborhood,
    [address.city, address.state].filter(Boolean).join(" - "),
    address.cep ? `CEP ${address.cep}` : ""
  ].filter(Boolean).join(" - ");
}

function presentOrderFields(data = emptyOrderData()) {
  const order = normalizeOrderData(data);
  return {
    name: Boolean(order.name),
    address: Boolean(order.address),
    items: order.items.length,
    payment: Boolean(order.payment),
    changeFor: Boolean(order.changeFor),
    notes: Boolean(order.notes)
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
  if (explicitName && isValidName(explicitName)) {
    extracted.name = explicitName;
    extracted.nameIsExplicit = true;
  }

  const explicitAddress = explicitField(rawText, ["endereco", "endereço"]);
  if (explicitAddress && isValidAddress(explicitAddress)) {
    extracted.address = explicitAddress;
    extracted.addressIsExplicit = true;
  }

  const explicitOrder = explicitField(rawText, ["pedido", "itens", "item"]);
  if (explicitOrder && hasFoodSignal(normalize(explicitOrder))) extracted.items.push(explicitOrder);

  const explicitPayment = explicitField(rawText, ["pagamento", "forma de pagamento"]);
  if (explicitPayment) extracted.payment = parsePayment(normalize(explicitPayment));

  const explicitChange = explicitField(rawText, ["troco", "troco para", "troco pra", "troca", "troca para", "troca pra"]);
  if (explicitChange) {
    extracted.changeFor = parseChangeAnswer(`troco ${explicitChange}`)
      || parseChangeAnswer(explicitChange, { allowNumericOnly: true });
    if (extracted.changeFor && !extracted.payment) extracted.payment = "dinheiro";
  }

  for (const line of lines) {
    const normalizedLine = normalize(line);
    const payment = parsePayment(normalizedLine);
    if (payment) extracted.payment = payment;

    const changeFor = parseChangeAnswer(normalizedLine);
    if (changeFor) extracted.changeFor = changeFor;

    if (isPaymentOrChangeLine(normalizedLine) && !hasFoodSignal(normalizedLine) && !isValidAddress(line)) {
      continue;
    }

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

  if (!extracted.address) {
    const addressDraft = possibleAddressDraftFromLines(lines, extracted);
    if (addressDraft) extracted.addressDraft = addressDraft;
  }

  extracted.items = cleanOrderItems(extracted.items);
  return extracted;
}

function mergeOrderData(current = emptyOrderData(), incoming = emptyOrderData()) {
  const next = normalizeOrderData(current);
  if (incoming.name && (!next.name || incoming.nameIsExplicit)) next.name = incoming.name;
  if (incoming.address) {
    const address = next.addressDraft
      ? [next.addressDraft, incoming.address].filter(Boolean).join(" ")
      : incoming.address;
    next.address = isValidAddress(address) ? address : incoming.address;
    next.addressDraft = "";
  }
  if (incoming.addressDraft && !next.address) {
    const address = combineAddressDraft(next.addressDraft, incoming.addressDraft);
    if (isValidAddress(address)) {
      next.address = address;
      next.addressDraft = "";
    } else {
      next.addressDraft = address;
    }
  }
  if (incoming.payment) next.payment = incoming.payment;
  if (!incoming.payment && incoming.changeFor && !next.payment) next.payment = "dinheiro";
  if (incoming.notes) next.notes = incoming.notes;

  if (incoming.items?.length) {
    next.items = cleanOrderItems([...next.items, ...incoming.items]);
  }

  if (next.payment !== "dinheiro") {
    next.changeFor = "";
  } else if (incoming.changeFor) {
    next.changeFor = incoming.changeFor;
  }

  return next;
}

function combineAddressDraft(currentDraft = "", incomingDraft = "") {
  const draft = String(currentDraft || "").trim();
  const fragment = String(incomingDraft || "").trim();
  if (!draft) return fragment;
  if (!fragment) return draft;

  if (isWeakNumberAddress(fragment)) {
    const number = cleanHouseNumber(fragment);
    const parts = draft.split(/\s+-\s+/);
    if (parts.length > 1) {
      return [[parts[0], number].filter(Boolean).join(", "), ...parts.slice(1)].join(" - ");
    }
  }

  return [draft, fragment].filter(Boolean).join(" ");
}

function cleanHouseNumber(value = "") {
  const match = String(value || "").match(/(\d{1,6}[a-zA-Z]?)/);
  return match ? match[1] : String(value || "").trim();
}

function contextualizeIncomingOrderData(incoming = emptyOrderData(), current = emptyOrderData(), rawText = "") {
  const next = { ...incoming };
  const order = normalizeOrderData(current);
  const onlyNameDetected = next.name
    && !next.nameIsExplicit
    && !next.address
    && !next.items?.length
    && !next.payment
    && !next.changeFor;

  if (order.name && !order.address && onlyNameDetected) {
    next.addressDraft = next.name;
    next.name = "";
    return next;
  }

  const fragment = addressFragmentFromText(rawText, order, next);
  if (fragment) {
    next.addressDraft = fragment;
  }

  return next;
}

function addressFragmentFromText(rawText = "", current = emptyOrderData(), incoming = emptyOrderData()) {
  if (incoming.address || incoming.name || incoming.items?.length || incoming.payment || incoming.changeFor) return "";

  const lines = String(rawText || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length !== 1) return "";

  const value = lines[0];
  const text = normalize(value);
  if (!text || text === normalize(current.name) || isNonOrderMessage(text) || hasFoodSignal(text) || isPaymentOrChangeLine(text)) {
    return "";
  }

  const hasLetters = /[a-zA-ZÀ-ÿ]{2,}/.test(value);
  const isHouseNumber = /^\d{1,6}[a-zA-Z]?$/.test(text);
  if (isHouseNumber || hasAddressSignal(text) || (current.name && !current.address && hasLetters)) {
    return value;
  }

  return "";
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
    && !hasAddressSignal(normalizedText);
}

function isValidAddress(value) {
  const text = String(value || "").trim();
  const normalizedText = normalize(text);
  const textWithoutCep = normalizedText.replace(/\b\d{5}-?\d{3}\b/g, " ");
  const hasNumber = /\b\d{1,6}\b/.test(textWithoutCep);
  const hasComplement = /[a-zA-ZÀ-ÿ]{3,}/.test(text)
    || hasAddressSignal(normalizedText);
  return hasNumber
    && hasComplement
    && !hasFoodSignal(normalizedText)
    && !hasPaymentSignal(normalizedText)
    && !parseChangeAnswer(normalizedText)
    && !isSuspiciousAddress(text);
}

function possibleAddressFromLines(lines) {
  for (let index = 0; index < lines.length; index += 1) {
    if (isPaymentOrChangeLine(lines[index]) || isPaymentOrChangeLine(lines[index + 1])) continue;
    const joined = [lines[index], lines[index + 1]].filter(Boolean).join(" ");
    if (isValidAddress(joined)) return joined;
  }
  return "";
}

function possibleAddressDraftFromLines(lines, extracted = emptyOrderData()) {
  const candidates = [];
  const name = normalize(extracted.name || "");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = normalize(line);
    if (!text || text === name || hasFoodSignal(text) || isPaymentOrChangeLine(text) || isNonOrderMessage(text)) continue;
    if (isCepOnlyAddress(line)) continue;
    if (/^\d{1,6}[a-zA-Z]?$/.test(text)) continue;

    const previous = normalize(lines[index - 1] || "");
    const next = normalize(lines[index + 1] || "");
    const hasAddressContext = hasAddressSignal(text) || hasAddressSignal(previous) || hasAddressSignal(next);

    if (hasAddressContext && /[a-zA-ZÀ-ÿ]{3,}/.test(line)) {
      candidates.push(line);
    }
  }

  const draft = candidates.join(" ").trim();
  return draft && !isSuspiciousAddress(draft) ? draft : "";
}

function isSuspiciousAddress(value = "") {
  const text = normalize(value);
  if (!text) return false;
  return hasPaymentSignal(text)
    || Boolean(parseChangeAnswer(text))
    || hasAny(text, [...CHANGE_KEYWORDS, "pix", "dinheiro", "cartao", "maquininha", "debito", "credito"]);
}

function isPaymentOrChangeLine(value = "") {
  const text = normalize(value);
  if (!text) return false;
  return hasPaymentSignal(text) || Boolean(parseChangeAnswer(text));
}

function hasAddressSignal(text) {
  return hasAny(text, [
    "rua",
    "avenida",
    "bairro",
    "vila",
    "cep",
    "referencia",
    "ponto de referencia",
    "perto",
    "proximo",
    "casa",
    "apto",
    "apartamento",
    "numero",
    "lote",
    "quadra",
    "travessa",
    "estrada",
    "rodovia",
    "centro",
    "jardim",
    "alto",
    "baixo"
  ]);
}

function hasFoodSignal(text) {
  return hasAny(text, FOOD_KEYWORDS);
}

function hasPaymentSignal(text) {
  return Boolean(parsePayment(text)) || hasAny(text, CHANGE_KEYWORDS);
}

function cleanOrderItems(items = []) {
  return uniqueList(items
    .map(cleanOrderItem)
    .filter((item) => item.length >= 3)
    .filter((item) => hasFoodSignal(normalize(item)))
    .filter((item) => !isPaymentOrChangeLine(item))
    .filter((item) => !isValidAddress(item)));
}

function cleanOrderItem(item = "") {
  let value = String(item || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) return "";

  value = value.replace(/^(?:eu\s+)?(?:quero|queria|vou querer|pode mandar|me ve|manda|pedido)\s+/i, "");

  const lower = normalize(value);
  const cutPatterns = [
    /\b(?:entrega|entregar|endereco|endereço|bairro|rua|avenida|av\.?|forma de pagamento|pagamento|pagar|troco|trico|troca|trocco)\b/i,
    /\b(?:para|pra)\s*(?:r\$?\s*)?\d{1,4}(?:[,.]\d{1,2})?\b/i
  ];

  let cutIndex = -1;
  for (const pattern of cutPatterns) {
    const match = value.match(pattern);
    if (match && hasFoodSignal(lower.slice(0, match.index))) {
      cutIndex = cutIndex === -1 ? match.index : Math.min(cutIndex, match.index);
    }
  }

  if (cutIndex > 0) value = value.slice(0, cutIndex).trim();

  return value
    .replace(/[,.:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePayment(text) {
  if (hasAny(text, ["dinheiro", ...CHANGE_KEYWORDS])) return "dinheiro";
  if (hasAny(text, ["pix"])) return "pix";
  if (hasAny(text, ["cartao", "cartão", "maquininha", "debito", "débito", "credito", "crédito"])) return "cartao";
  if (hasAny(text, ["vale"])) return "vale";
  return "";
}

function parseChangeAnswer(text, options = {}) {
  const normalizedText = normalize(text);
  if (["nao", "sem"].includes(normalizedText)
    || hasAny(normalizedText, ["sem troco", "nao precisa", "dispensa troco", "nao vou precisar de troco"])) {
    return "nao";
  }
  const directChange = normalizedText.match(/\b(?:troco|trico|troca|trocco)\s*(?:para|pra|de|em)?\s*(?:r\$?\s*)?(\d{1,4}(?:[,.]\d{1,2})?)\b/);
  if (directChange) return directChange[1].replace(",", ".");

  const shortChange = normalizedText.match(/^(?:para|pra)\s*(?:r\$?\s*)?(\d{1,4}(?:[,.]\d{1,2})?)\b/);
  if (shortChange) return shortChange[1].replace(",", ".");

  if (!options.allowNumericOnly) return "";

  const numericOnly = normalizedText.match(/^\d{1,4}(?:[,.]\d{1,2})?$/);
  return numericOnly ? numericOnly[0].replace(",", ".") : "";
}

function shouldAnswerChange(text) {
  return Boolean(parseChangeAnswer(text, { allowNumericOnly: true }));
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

function startCollectingReply(siteUrl, options = {}) {
  if (isPeakServiceHour() || options.mode === SERVICE_MODES.EXPRESS) {
    return [
      "Fechando rapidinho.",
      "",
      "Me mande em uma mensagem:",
      "Nome, endereco, CEP se souber, pedido e pagamento.",
      "",
      "Eu organizo e envio para a equipe conferir."
    ].join("\n");
  }

  return [
    "Claro. Pode fazer seu pedido comigo por aqui.",
    "",
    "Me conta o que voce vai querer hoje. Pode incluir pizzas, frangos, batatas, combos e bebidas.",
    "",
    "Para eu encaminhar certinho, me mande:",
    "Nome:",
    "Endereco completo:",
    "CEP da rua, se souber:",
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

function sellerGuidanceReply(siteUrl, text = "") {
  if (isPeakServiceHour()) {
    return [
      "Te ajudo sim.",
      "",
      "Para agilizar, escolha uma linha:",
      "1 - Pizza",
      "2 - Frango",
      "3 - Combo",
      "",
      "Se ja souber, mande direto: nome, endereco, pedido e pagamento."
    ].join("\n");
  }

  if (hasAny(text, ["promo", "promocao", "promocoes", "oferta", "ofertas", "barato", "desconto"])) {
    return [
      "Posso te mostrar as opcoes do cardapio sem inventar valor.",
      "",
      "Sugestoes da casa:",
      "- Pizza + Borda + Refri",
      "- Frango + Batata + Bebida",
      "- Batata Recheada + Refri",
      "",
      "Quer pizza, frango ou combo?"
    ].join("\n");
  }

  return [
    "Posso te ajudar a escolher.",
    "",
    "Sugestoes da casa:",
    "- Pizza + Borda + Refri",
    "- Frango + Batata + Bebida",
    "- Pizza pequena com borda",
    "",
    "Voce prefere pizza ou frango?",
    "",
    "Cardapio:",
    siteUrl
  ].join("\n");
}

function pizzaGuidanceReply() {
  if (isPeakServiceHour()) {
    return [
      "Perfeito. Vamos agilizar a pizza.",
      "",
      "Me mande tamanho + sabor.",
      "Exemplo: Familia frango com catupiry.",
      "",
      "Depois eu pego endereco e pagamento."
    ].join("\n");
  }

  return [
    "Otima escolha.",
    "",
    "Voce prefere Familia ou Maracana?",
    "Depois me diga o sabor.",
    "",
    "Se quiser, pode incluir borda recheada junto."
  ].join("\n");
}

function chickenGuidanceReply() {
  if (isPeakServiceHour()) {
    return [
      "Boa. Para agilizar o frango, me mande a quantidade ou o combo que voce quer.",
      "",
      "Se ja souber, mande junto nome, endereco e pagamento."
    ].join("\n");
  }

  return [
    "Boa escolha.",
    "",
    "Voce quer frango sozinho ou combo com batata e bebida?",
    "",
    "A equipe confere valor e disponibilidade antes de confirmar."
  ].join("\n");
}

function askMissingFieldsReply(data, missing, options = {}) {
  const order = normalizeOrderData(data);

  if (missing.includes("troco")) {
    return [
      "Anotei ate agora:",
      formatOrderSummary(order),
      "",
      "Vai precisar de troco? Se sim, pra qual valor? Se nao, responda NAO."
    ].filter(Boolean).join("\n");
  }

  const labels = missingFieldLabels(missing);

  if (missing.length === 1 && missing[0] === "endereco" && order.addressDraft) {
    return [
      "Anotei o endereco assim:",
      order.addressDraft,
      "",
      "Falta so o numero da casa/comercio. Pode me mandar?",
      "",
      "Se souber o CEP da rua, pode mandar tambem que ajuda a conferir."
    ].join("\n");
  }

  if (missing.length === 1 && missing[0] === "endereco") {
    return [
      "Beleza. Agora me passa o endereco completo, por favor.",
      "",
      "Se souber o CEP da rua, manda junto. Assim eu puxo rua e bairro certinho."
    ].join("\n");
  }

  if (labels.length === 1) {
    if (options.mode === SERVICE_MODES.EXPRESS || isPeakServiceHour()) {
      return `Falta so ${labels[0]}. Pode me mandar?`;
    }
    return `Beleza. Agora me passa seu ${labels[0]}, por favor.`;
  }

  if (options.mode === SERVICE_MODES.EXPRESS || isPeakServiceHour()) {
    return `Falta ${joinHuman(labels)}. Pode mandar em uma mensagem?`;
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
      },
      async list(options = {}) {
        const prefix = options.prefix || "";
        const blobs = [...bucket.keys()]
          .filter((key) => !prefix || key.startsWith(prefix))
          .map((key) => ({ key, etag: `test-${key}` }));
        return { blobs };
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

function currentSaoPauloHour() {
  try {
    const hourText = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      hour12: false
    }).format(new Date());
    return Number(hourText.replace(/\D/g, ""));
  } catch {
    return new Date().getHours();
  }
}

function isPeakServiceHour() {
  const hour = currentSaoPauloHour();
  return hour >= 18 && hour < 21;
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

function classifyServiceMode(text, session = menuSession()) {
  if (isExpressReply(text)) return SERVICE_MODES.EXPRESS;
  if (isSellerModeRequest(text)) return SERVICE_MODES.SELLER;

  const signals = orderSignals(text);
  if (signals.hasFood || signals.hasPayment || signals.hasOrderVerb || isOrderStartRequest(text)) {
    return SERVICE_MODES.ATTENDANT;
  }

  if (session.state === STATES.COLLECTING && text.split(/\s+/).filter(Boolean).length <= 2) {
    return SERVICE_MODES.EXPRESS;
  }

  return SERVICE_MODES.ATTENDANT;
}

function isExpressReply(text) {
  return [
    "sim",
    "nao",
    "não",
    "ok",
    "pix",
    "cartao",
    "cartão",
    "dinheiro",
    "manda",
    "manda sim",
    "pode mandar",
    "fechado",
    "fechou",
    "confirmado",
    "isso",
    "certo"
  ].some((answer) => text === normalize(answer));
}

function isSellerModeRequest(text) {
  if (isGenericPizzaRequest(text) || isGenericChickenRequest(text)) return false;

  return hasAny(text, [
    "nao sei",
    "não sei",
    "me indica",
    "me indique",
    "indica uma",
    "indique uma",
    "sugere",
    "sugestao",
    "sugestão",
    "o que tem",
    "qual melhor",
    "qual e melhor",
    "qual é melhor",
    "qual voce recomenda",
    "qual vc recomenda",
    "ajuda escolher",
    "me ajuda escolher",
    "quero ajuda para escolher",
    "tanto faz",
    "qualquer uma",
    "mais pedido",
    "mais pedidos",
    "barato",
    "desconto",
    "promo",
    "promocao",
    "promoção",
    "oferta"
  ]);
}

function isGenericPizzaRequest(text) {
  return [
    "pizza",
    "pizzas",
    "quero pizza",
    "queria pizza",
    "vou querer pizza",
    "manda pizza",
    "me ve pizza",
    "me vê pizza"
  ].some((value) => text === normalize(value));
}

function isGenericChickenRequest(text) {
  return [
    "frango",
    "quero frango",
    "queria frango",
    "vou querer frango",
    "manda frango",
    "frango frito",
    "frango crocante"
  ].some((value) => text === normalize(value));
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
    "trico",
    "troca",
    "trocco",
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
    && !(numericParts.length === 1 && hasAny(text, [...CHANGE_KEYWORDS, "reais", "real"]));
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

function formatCustomerOrderForTeam(orderText) {
  const cleaned = formatCustomerOrder(orderText);
  if (cleaned === "Pedido informado na conversa.") return cleaned;

  return cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

function orderMapLinks(orderText = "") {
  const address = extractAddressFromOrderSummary(orderText);
  if (!address) return [];

  const query = normalizeAddressForMap(address);
  const encoded = encodeURIComponent(query);
  return [
    `Google Maps: https://www.google.com/maps/search/?api=1&query=${encoded}`,
    `Waze: https://waze.com/ul?q=${encoded}&navigate=yes&utm_source=beerchicken-bck`
  ];
}

function extractAddressFromOrderSummary(orderText = "") {
  const line = String(orderText || "")
    .split(/\r?\n/)
    .find((item) => normalize(item).startsWith("endereco:"));
  return line ? line.replace(/^endereco:\s*/i, "").trim() : "";
}

function normalizeAddressForMap(address = "") {
  const text = String(address || "").trim();
  if (!text) return "";
  const normalizedText = normalize(text);
  if (normalizedText.includes("cachoeiro") || normalizedText.includes(" espirito santo") || /\b-\s*es\b/i.test(text)) {
    return text;
  }
  return `${text}, ${MAPS_CITY}`;
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
    buildPhaseOneOrderRecord,
    extractMessageStatuses,
    extractOrderFieldsSmart,
    formatManualOrderNotification,
    classifyServiceMode,
    isGenericPizzaRequest,
    isGenericChickenRequest,
    isSellerModeRequest,
    contextualizeIncomingOrderData,
    mergeOrderData,
    orderCompleteness,
    extractCep,
    lookupCepAddress,
    orderMapLinks,
    mergeRuleAndAIOrderData,
    sanitizeAIOrderData,
    isManualOrder,
    isOrderDraft,
    isDraftCompletion,
    saveStoreNotificationLog,
    saveStoreNotificationStatus
  };
}
