(function () {
  "use strict";

  var CONFIG = {
    endpoint: "https://beerchicken-bck.netlify.app/api/meta-capi/purchase",
    allowedHosts: ["www.pizzariabck.com.br", "pizzariabck.com.br"],
    storagePrefix: "bck_meta_capi_purchase_"
  };

  if (window.__BCK_META_CAPI_BRIDGE__) return;
  window.__BCK_META_CAPI_BRIDGE__ = true;
  markBridgeState("loaded");

  if (CONFIG.allowedHosts.indexOf(window.location.hostname) === -1) {
    markBridgeState("blocked_host");
    return;
  }

  markBridgeState("ready");

  interceptDataLayer();
  waitForFbq();

  function waitForFbq() {
    var attempts = 0;
    var timer = window.setInterval(function () {
      attempts += 1;

      if (typeof window.fbq === "function" && !window.fbq.__bckCapiWrapped) {
        wrapFbq(window.fbq);
        window.clearInterval(timer);
      }

      if (attempts > 120) {
        window.clearInterval(timer);
      }
    }, 250);
  }

  function wrapFbq(originalFbq) {
    function wrappedFbq() {
      try {
        captureFbqPurchase(arguments);
      } catch (error) {
        logDebug("fbq_capture_error", error);
      }

      return originalFbq.apply(this, arguments);
    }

    copyFbqProperties(originalFbq, wrappedFbq);
    wrappedFbq.__bckCapiWrapped = true;
    window.fbq = wrappedFbq;
    window._fbq = wrappedFbq;

    if (Array.isArray(originalFbq.queue)) {
      originalFbq.queue.forEach(function (queuedArgs) {
        captureFbqPurchase(queuedArgs);
      });
    }
  }

  function copyFbqProperties(source, target) {
    try {
      Object.keys(source).forEach(function (key) {
        target[key] = source[key];
      });
    } catch (error) {
      logDebug("fbq_copy_error", error);
    }

    target.queue = source.queue || target.queue || [];
    target.push = source.push || target.push;
    target.loaded = source.loaded;
    target.version = source.version;
    target.callMethod = source.callMethod;
  }

  function captureFbqPurchase(argsLike) {
    var args = Array.prototype.slice.call(argsLike);
    var method = String(args[0] || "");
    var eventName = "";
    var payload = {};
    var options = {};

    if (method === "track" || method === "trackCustom") {
      eventName = String(args[1] || "");
      payload = objectOrEmpty(args[2]);
      options = objectOrEmpty(args[3]);
    }

    if (method === "trackSingle" || method === "trackSingleCustom") {
      eventName = String(args[2] || "");
      payload = objectOrEmpty(args[3]);
      options = objectOrEmpty(args[4]);
    }

    if (eventName !== "Purchase") return;

    sendPurchase({
      event_id: eventIdFrom(payload, options),
      value: payload.value,
      currency: payload.currency || "BRL",
      order_id: payload.order_id || payload.transaction_id || "",
      content_ids: payload.content_ids,
      contents: payload.contents,
      content_type: payload.content_type || "product",
      content_name: payload.content_name || ""
    });
  }

  function interceptDataLayer() {
    window.dataLayer = window.dataLayer || [];
    if (window.dataLayer.__bckCapiWrapped) return;

    var originalPush = window.dataLayer.push;
    window.dataLayer.forEach(captureDataLayerPurchase);
    window.dataLayer.push = function () {
      var args = Array.prototype.slice.call(arguments);
      args.forEach(captureDataLayerPurchase);
      return originalPush.apply(window.dataLayer, args);
    };
    window.dataLayer.__bckCapiWrapped = true;
  }

  function captureDataLayerPurchase(item) {
    if (!item || typeof item !== "object") return;
    var name = String(item.event || item.event_name || "");
    if (name !== "purchase" && name !== "Purchase") return;

    sendPurchase({
      event_id: item.event_id || item.eventID || "",
      value: item.value,
      currency: item.currency || "BRL",
      order_id: item.order_id || item.transaction_id || "",
      content_ids: item.content_ids,
      contents: item.contents || (item.ecommerce && item.ecommerce.items),
      content_type: item.content_type || "product",
      content_name: item.content_name || ""
    });
  }

  function sendPurchase(data) {
    var eventId = String(data.event_id || "").trim();
    if (!eventId) {
      logDebug("purchase_without_event_id_ignored");
      return;
    }

    if (alreadySent(eventId)) {
      logDebug("purchase_already_sent", eventId);
      return;
    }

    var value = Number(data.value);
    if (!Number.isFinite(value) || value < 0) {
      logDebug("purchase_invalid_value_ignored", data.value);
      return;
    }

    markSent(eventId);

    var payload = {
      event_id: eventId,
      event_source_url: window.location.href,
      value: Math.round(value * 100) / 100,
      currency: String(data.currency || "BRL").toUpperCase(),
      order_id: data.order_id || "",
      content_ids: arrayOrEmpty(data.content_ids),
      contents: normalizeContents(data.contents),
      content_type: data.content_type || "product",
      content_name: data.content_name || "",
      fbp: cookieValue("_fbp"),
      fbc: cookieValue("_fbc")
    };

    window.fetch(CONFIG.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify(payload)
    }).catch(function (error) {
      unmarkSent(eventId);
      logDebug("capi_bridge_send_error", error);
    });
  }

  function eventIdFrom(payload, options) {
    return options.eventID
      || options.event_id
      || payload.eventID
      || payload.event_id
      || "";
  }

  function alreadySent(eventId) {
    try {
      return window.sessionStorage.getItem(CONFIG.storagePrefix + eventId) === "1";
    } catch (error) {
      return false;
    }
  }

  function markSent(eventId) {
    try {
      window.sessionStorage.setItem(CONFIG.storagePrefix + eventId, "1");
    } catch (error) {
      logDebug("storage_mark_error", error);
    }
  }

  function unmarkSent(eventId) {
    try {
      window.sessionStorage.removeItem(CONFIG.storagePrefix + eventId);
    } catch (error) {
      logDebug("storage_unmark_error", error);
    }
  }

  function cookieValue(name) {
    var parts = String(document.cookie || "").split(";");
    for (var i = 0; i < parts.length; i += 1) {
      var pair = parts[i].trim();
      if (pair.indexOf(name + "=") === 0) {
        return decodeURIComponent(pair.slice(name.length + 1));
      }
    }
    return "";
  }

  function normalizeContents(contents) {
    return arrayOrEmpty(contents)
      .map(function (item) {
        if (!item || typeof item !== "object") return null;
        var id = item.id || item.item_id || item.item_name || item.name || "";
        if (!id) return null;
        var quantity = Number(item.quantity || 1);
        var itemPrice = Number(item.item_price || item.price || 0);
        return {
          id: String(id),
          quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
          item_price: Number.isFinite(itemPrice) && itemPrice >= 0 ? Math.round(itemPrice * 100) / 100 : 0
        };
      })
      .filter(Boolean)
      .slice(0, 100);
  }

  function arrayOrEmpty(value) {
    return Array.isArray(value) ? value : [];
  }

  function objectOrEmpty(value) {
    return value && typeof value === "object" ? value : {};
  }

  function markBridgeState(state) {
    try {
      document.documentElement.setAttribute("data-bck-capi-bridge", state);
    } catch (error) {
      // Status marker only.
    }
  }

  function logDebug() {
    if (!window.localStorage || window.localStorage.getItem("BCK_CAPI_DEBUG") !== "1") return;
    try {
      window.console.log.apply(window.console, ["[BCK CAPI]"].concat(Array.prototype.slice.call(arguments)));
    } catch (error) {
      // Debug only.
    }
  }
})();
