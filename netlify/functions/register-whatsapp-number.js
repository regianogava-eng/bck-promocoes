const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const CONFIRMATION_TEXT = "REGISTER_BCK_WHATSAPP_9520";
const DISABLE_AFTER = Date.parse("2026-06-12T03:00:00Z");

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: JSON_HEADERS, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  if (Date.now() > DISABLE_AFTER) {
    return json(410, { ok: false, error: "temporary_function_expired" });
  }

  let request;
  try {
    request = JSON.parse(event.body || "{}");
  } catch {
    return json(400, { ok: false, error: "invalid_json" });
  }

  if (request.confirm !== CONFIRMATION_TEXT) {
    return json(403, { ok: false, error: "confirmation_required" });
  }

  const pin = String(request.pin || "").trim();
  if (!/^\d{6}$/.test(pin)) {
    return json(422, { ok: false, error: "invalid_pin" });
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_API_VERSION || "v25.0";

  const missing = [
    ["WHATSAPP_ACCESS_TOKEN", token],
    ["WHATSAPP_PHONE_NUMBER_ID", phoneNumberId]
  ].filter(([, value]) => !value).map(([name]) => name);

  if (missing.length) {
    return json(500, { ok: false, error: "whatsapp_env_missing", missing });
  }

  const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/register`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      pin
    })
  });

  const detail = await readResponse(response);

  console.log("BCK_WHATSAPP_REGISTER_RESULT", JSON.stringify({
    ok: response.ok,
    status: response.status,
    phoneNumberId,
    apiVersion,
    metaErrorCode: detail?.error?.code || null,
    metaErrorType: detail?.error?.type || null
  }));

  return json(response.ok ? 200 : response.status, {
    ok: response.ok,
    phoneNumberId,
    apiVersion,
    metaStatus: response.status,
    meta: detail
  });
};

async function readResponse(response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function json(statusCode, payload) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(payload)
  };
}
