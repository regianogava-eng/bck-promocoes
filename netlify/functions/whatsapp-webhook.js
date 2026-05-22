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
