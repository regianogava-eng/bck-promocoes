const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, max-age=0"
};

const CATALOG_STORE = "bck-catalog";
const CATALOG_KEY = "catalog.json";

exports.handler = async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: JSON_HEADERS,
      body: ""
    };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "method_not_allowed" });
  }

  try {
    const store = await getBlobStore(CATALOG_STORE);
    const catalog = await store.get(CATALOG_KEY, { type: "json" });

    if (!catalog || !Array.isArray(catalog.products)) {
      return json(404, { ok: false, error: "catalog_not_found" });
    }

    return json(200, catalog);
  } catch (error) {
    console.error("BCK_CATALOG_READ_ERROR", error);
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

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  };
}
