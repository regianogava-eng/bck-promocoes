const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, max-age=0",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const CATALOG_STORE = "bck-catalog";
const CATALOG_KEY = "catalog.json";
const MAX_CATALOG_BYTES = 2 * 1024 * 1024;

exports.handler = async function handler(event, context) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: JSON_HEADERS,
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  if (!context || !context.clientContext || !context.clientContext.user) {
    return json(401, { ok: false, error: "identity_required" });
  }

  try {
    if (!event.body || event.body.length > MAX_CATALOG_BYTES) {
      return json(400, { ok: false, error: "invalid_catalog_size" });
    }

    const catalog = JSON.parse(event.body);
    const validationError = validateCatalog(catalog);
    if (validationError) {
      return json(400, { ok: false, error: validationError });
    }

    const store = await getBlobStore(CATALOG_STORE);
    await store.setJSON(CATALOG_KEY, catalog);

    return json(200, {
      ok: true,
      savedAt: new Date().toISOString(),
      savedBy: context.clientContext.user.email || context.clientContext.user.sub || "identity-user"
    });
  } catch (error) {
    console.error("BCK_CATALOG_SAVE_ERROR", error);
    return json(500, { ok: false, error: "catalog_storage_unavailable" });
  }
};

async function getBlobStore(name) {
  const { getStore } = await import("@netlify/blobs");
  const siteID = process.env.BCK_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.BCK_BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;

  if (siteID && token) {
    return getStore({ name, consistency: "strong", siteID, token });
  }

  return getStore({ name, consistency: "strong" });
}

function validateCatalog(catalog) {
  if (!catalog || typeof catalog !== "object") {
    return "catalog_invalid";
  }

  if (!Array.isArray(catalog.categories) || !Array.isArray(catalog.products)) {
    return "catalog_shape_invalid";
  }

  if (!catalog.categories.length) {
    return "catalog_categories_required";
  }

  const ids = new Set();
  for (const product of catalog.products) {
    if (!product || typeof product !== "object" || !product.id || !product.title) {
      return "catalog_product_invalid";
    }

    if (ids.has(product.id)) {
      return "catalog_product_duplicate";
    }

    ids.add(product.id);
  }

  return "";
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  };
}
