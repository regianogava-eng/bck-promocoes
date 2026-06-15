const config = window.BCK_CONFIG;
const COMBO_BUILDER_FALLBACK_GROUPS = [
  { key: "pizza", label: "Pizza", source: "pizzas", required: true },
  { key: "frango", label: "Frango", source: "frangos", required: true },
  { key: "batata", label: "Batata", source: "batatas", required: true },
  { key: "bebida", label: "Bebida", source: "bebidas", required: true }
];
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DEFAULT_SCHEDULE_DAYS = [
  { key: "sun", label: "Domingo", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" },
  { key: "mon", label: "Segunda", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" },
  { key: "tue", label: "Terca", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" },
  { key: "wed", label: "Quarta", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" },
  { key: "thu", label: "Quinta", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" },
  { key: "fri", label: "Sexta", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" },
  { key: "sat", label: "Sabado", open: true, openTime: "17:00", closeTime: "00:00", cutoffTime: "23:30" }
];
const CATALOG_API_URL = "/.netlify/functions/get-catalog";

let catalog = normalizeCatalog(window.BCK_CATALOG || { categories: [], products: [] });

const state = {
  selectedCategory: "todos",
  sort: "featured",
  cart: loadCart(),
  comboBuilder: {}
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: config.currency || "BRL"
});

function configuredMetaPixelId() {
  return String(config.placeholders?.metaPixelId || config.metaPixelId || "").trim();
}

function isConfiguredTrackingId(id) {
  return Boolean(id)
    && !id.includes("XXXX")
    && !/^0+$/.test(id);
}

function installMetaPixel() {
  const pixelId = configuredMetaPixelId();
  if (!isConfiguredTrackingId(pixelId) || typeof window.fbq === "function") return;

  window.fbq = function fbq() {
    if (window.fbq.callMethod) {
      window.fbq.callMethod.apply(window.fbq, arguments);
      return;
    }

    window.fbq.queue.push(arguments);
  };
  window._fbq = window.fbq;
  window.fbq.push = window.fbq;
  window.fbq.loaded = true;
  window.fbq.version = "2.0";
  window.fbq.queue = [];

  const script = document.createElement("script");
  script.async = true;
  script.src = "https://connect.facebook.net/pt_BR/fbevents.js";
  document.head.appendChild(script);

  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

function normalizeCatalog(rawCatalog = {}) {
  const groupCategoryMap = {
    combos: "combos",
    frango: "frango",
    pizza: "pizza",
    batata: "batata",
    carne: "porcoes-carne",
    bebidas: "bebidas",
    hamburguer: "hamburguer"
  };
  const groups = rawCatalog.promotionGroups && typeof rawCatalog.promotionGroups === "object"
    ? rawCatalog.promotionGroups
    : null;

  const groupedProducts = groups
    ? Object.entries(groups).flatMap(([groupId, products]) => {
        if (!Array.isArray(products)) return [];

        return products.map((product) => {
          const fallbackCategory = groupCategoryMap[groupId] || groupId;
          const categories = Array.isArray(product.categories) && product.categories.length
            ? product.categories
            : [fallbackCategory];
          const normalizedCategories = groupId === "combos" && !categories.includes("combos")
            ? ["combos", ...categories]
            : categories;

          return {
            ...product,
            categories: normalizedCategories,
            combo: typeof product.combo === "boolean" ? product.combo : groupId === "combos"
          };
        });
      })
    : [];

  const flatProducts = Array.isArray(rawCatalog.products) ? rawCatalog.products : [];

  return {
    ...rawCatalog,
    categories: Array.isArray(rawCatalog.categories) ? rawCatalog.categories : [],
    comboBuilder: normalizeComboBuilder(rawCatalog.comboBuilder),
    loyalty: normalizeLoyalty(rawCatalog.loyalty),
    schedule: normalizeSchedule(rawCatalog.schedule),
    products: flatProducts.length ? flatProducts : groupedProducts
  };
}

function normalizeComboBuilder(settings = {}) {
  const groups = Array.isArray(settings.groups) && settings.groups.length
    ? settings.groups
    : COMBO_BUILDER_FALLBACK_GROUPS;

  return {
    enabled: settings.enabled !== false,
    title: settings.title || "Monte seu Combo",
    description: settings.description || "Escolha pizza, frango, batata e bebida. O total e calculado na hora.",
    groups: groups.map((group, index) => ({
      key: group.key || COMBO_BUILDER_FALLBACK_GROUPS[index]?.key || `item-${index + 1}`,
      label: group.label || group.title || COMBO_BUILDER_FALLBACK_GROUPS[index]?.label || "Item",
      source: group.source || COMBO_BUILDER_FALLBACK_GROUPS[index]?.source || group.key,
      required: group.required !== false,
      itemIds: Array.isArray(group.itemIds) ? group.itemIds : []
    })),
    freeGift: normalizeFreeGift(settings.freeGift)
  };
}

function normalizeFreeGift(freeGift = {}) {
  return {
    enabled: freeGift.enabled !== false,
    threshold: Number.isFinite(Number(freeGift.threshold)) ? Number(freeGift.threshold) : 100,
    title: freeGift.title || "Refri gratis",
    description: freeGift.description || "Desbloqueado em combos montados acima de R$100.",
    itemId: freeGift.itemId || "refri-gelado"
  };
}

function normalizeLoyalty(loyalty = {}) {
  return {
    enabled: Boolean(loyalty.enabled),
    mode: loyalty.mode || "monthly-purchases",
    purchaseTarget: Number.isFinite(Number(loyalty.purchaseTarget)) ? Number(loyalty.purchaseTarget) : 8,
    rewardTitle: loyalty.rewardTitle || "Pedido gratis",
    orderIdField: loyalty.orderIdField || "id",
    historySource: loyalty.historySource || "netlify-blobs"
  };
}

function normalizeSchedule(settings = {}) {
  const days = Array.isArray(settings.days) ? settings.days : [];
  const daysByKey = new Map(days.map((day) => [day.key, day]));

  return {
    enabled: settings.enabled !== false,
    timezone: settings.timezone || "America/Sao_Paulo",
    openLabel: settings.openLabel || "Aberto agora",
    closedLabel: settings.closedLabel || "Fechado agora",
    blockCheckoutWhenClosed: settings.blockCheckoutWhenClosed !== false,
    closedCheckoutMessage: settings.closedCheckoutMessage
      || "A BCK esta fechada neste horario. Voce pode montar o carrinho, mas o envio do pedido abre no proximo horario de atendimento.",
    days: DEFAULT_SCHEDULE_DAYS.map((fallback) => normalizeScheduleDay(daysByKey.get(fallback.key), fallback))
  };
}

function normalizeScheduleDay(day = {}, fallback = DEFAULT_SCHEDULE_DAYS[0]) {
  return {
    key: fallback.key,
    label: day.label || fallback.label,
    open: day.open !== false,
    openTime: normalizeClockTime(day.openTime, fallback.openTime),
    closeTime: normalizeClockTime(day.closeTime, fallback.closeTime),
    cutoffTime: normalizeClockTime(day.cutoffTime, fallback.cutoffTime)
  };
}

function normalizeClockTime(value, fallback) {
  const time = String(value || "").trim();
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : fallback;
}

const els = {
  featuredDeal: document.querySelector("[data-featured-deal]"),
  tickerTrack: document.querySelector("[data-ticker-track]"),
  todayLabel: document.querySelector("[data-today-label]"),
  openStatus: document.querySelector("[data-open-status]"),
  hoursTitle: document.querySelector("[data-hours-title]"),
  hoursValue: document.querySelector("[data-hours-value]"),
  hoursNote: document.querySelector("[data-hours-note]"),
  countdownLabel: document.querySelector("[data-countdown-label]"),
  countdown: document.querySelector("[data-countdown]"),
  categoryRail: document.querySelector("[data-category-rail]"),
  productGrid: document.querySelector("[data-product-grid]"),
  comboBuilderSection: document.querySelector("[data-combo-builder-section]"),
  comboBuilderTitle: document.querySelector("[data-combo-builder-title]"),
  comboBuilderDescription: document.querySelector("[data-combo-builder-description]"),
  comboOptions: document.querySelector("[data-combo-options]"),
  comboTotal: document.querySelector("[data-combo-total]"),
  comboGiftStatus: document.querySelector("[data-combo-gift-status]"),
  comboSummary: document.querySelector("[data-combo-summary]"),
  comboAddButton: document.querySelector("[data-add-custom-combo]"),
  comboGrid: document.querySelector("[data-combo-grid]"),
  visibleCount: document.querySelector("[data-visible-count]"),
  sortSelect: document.querySelector("[data-sort-select]"),
  cartDrawer: document.querySelector("[data-cart-drawer]"),
  cartList: document.querySelector("[data-cart-list]"),
  cartEmpty: document.querySelector("[data-cart-empty]"),
  orderConfirmation: document.querySelector("[data-order-confirmation]"),
  orderConfirmationId: document.querySelector("[data-order-confirmation-id]"),
  checkoutForm: document.querySelector("[data-checkout-form]"),
  checkoutStatus: document.querySelector("[data-checkout-status]"),
  checkoutSubmit: document.querySelector("[data-checkout-submit]"),
  aiAssistantCard: document.querySelector("[data-ai-assistant-card]"),
  aiAssistantLabels: document.querySelectorAll("[data-ai-assistant-label]"),
  aiAssistantShort: document.querySelector("[data-ai-assistant-short]"),
  aiAssistantHeadline: document.querySelector("[data-ai-assistant-headline]"),
  aiAssistantDescription: document.querySelector("[data-ai-assistant-description]"),
  categoryTemplate: document.querySelector("#category-template"),
  productTemplate: document.querySelector("#product-template"),
  cartItemTemplate: document.querySelector("#cart-item-template")
};

function formatMoney(value) {
  return moneyFormatter.format(value);
}

function activeProducts() {
  return catalog.products.filter((product) => product.active);
}

async function loadCatalogData() {
  const liveLoaded = await loadCatalogFrom(CATALOG_API_URL + "?v=" + Date.now());
  if (liveLoaded) {
    return;
  }

  await loadCatalogFrom("data/catalog.json");
}

async function loadCatalogFrom(url) {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return false;

    const remoteCatalog = normalizeCatalog(await response.json());
    if (remoteCatalog.categories.length && remoteCatalog.products.length) {
      catalog = remoteCatalog;
      return true;
    }
  } catch (error) {
    console.info("Usando catálogo local de fallback.", error);
  }

  return false;
}

function productById(id) {
  return catalog.products.find((product) => product.id === id);
}

function productCategories(product) {
  return Array.isArray(product.categories) && product.categories.length
    ? product.categories
    : ["combos"];
}

function productComponents(product) {
  return Array.isArray(product.components) && product.components.length
    ? product.components
    : [product.title];
}

function productImage(product) {
  return product.image || "assets/images/hero-bck-feast.webp";
}

function comboBuilderSettings() {
  return catalog.comboBuilder || normalizeComboBuilder();
}

function loyaltySettings() {
  return catalog.loyalty || normalizeLoyalty();
}

function comboBuilderGroups() {
  return comboBuilderSettings().groups || COMBO_BUILDER_FALLBACK_GROUPS;
}

function baseProductsForGroup(group) {
  const source = group.source || group.key;
  const items = catalog.baseProducts && Array.isArray(catalog.baseProducts[source])
    ? catalog.baseProducts[source]
    : [];
  const allowedIds = Array.isArray(group.itemIds) && group.itemIds.length ? new Set(group.itemIds) : null;

  return items.filter((item) => {
    return item
      && item.active !== false
      && (!allowedIds || allowedIds.has(item.id));
  });
}

function comboGroupState(group) {
  const current = state.comboBuilder[group.key];

  if (current && typeof current === "object") {
    return {
      itemId: current.itemId || "",
      option: current.option || ""
    };
  }

  return {
    itemId: typeof current === "string" ? current : "",
    option: ""
  };
}

function setComboGroupState(group, itemId, option = "") {
  const item = baseProductsForGroup(group).find((candidate) => candidate.id === itemId);
  const options = Array.isArray(item?.options) ? item.options : [];
  state.comboBuilder[group.key] = {
    itemId,
    option: option || options[0] || ""
  };
}

function ensureComboBuilderSelection() {
  comboBuilderGroups().forEach((group) => {
    const items = baseProductsForGroup(group);
    if (!items.length) {
      state.comboBuilder[group.key] = { itemId: "", option: "" };
      return;
    }

    const current = comboGroupState(group);
    const selected = items.find((item) => item.id === current.itemId) || items[0];
    const options = Array.isArray(selected.options) ? selected.options : [];
    state.comboBuilder[group.key] = {
      itemId: selected.id,
      option: options.includes(current.option) ? current.option : options[0] || ""
    };
  });
}

function selectedComboItems() {
  return comboBuilderGroups().map((group) => {
    const current = comboGroupState(group);
    const item = baseProductsForGroup(group).find((candidate) => candidate.id === current.itemId);
    return {
      group,
      item,
      option: current.option
    };
  });
}

function comboSelectionComplete() {
  return selectedComboItems().every((selection) => {
    return selection.item || selection.group.required === false;
  });
}

function comboBuilderSubtotal() {
  return selectedComboItems().reduce((total, selection) => {
    return selection.item ? total + Number(selection.item.price || 0) : total;
  }, 0);
}

function comboBuilderGift(subtotal = comboBuilderSubtotal()) {
  const freeGift = comboBuilderSettings().freeGift || {};

  if (freeGift.enabled === false || subtotal < Number(freeGift.threshold || 0)) {
    return null;
  }

  const baseGift = Object.values(catalog.baseProducts || {})
    .flat()
    .find((item) => item && item.id === freeGift.itemId);

  return {
    id: freeGift.itemId || "brinde",
    title: freeGift.title || baseGift?.title || "Brinde",
    description: freeGift.description || baseGift?.description || "",
    price: 0
  };
}

function hasOriginalPrice(product) {
  return Number(product.originalPrice) > Number(product.promoPrice);
}

function savings(product) {
  if (!hasOriginalPrice(product)) return 0;
  return Math.max(0, Number(product.originalPrice) - Number(product.promoPrice));
}

function productMatches(product, categoryId) {
  return categoryId === "todos" || productCategories(product).includes(categoryId);
}

function sortedProducts(products) {
  const list = [...products];

  if (state.sort === "price-asc") {
    return list.sort((a, b) => a.promoPrice - b.promoPrice);
  }

  if (state.sort === "saving-desc") {
    return list.sort((a, b) => savings(b) - savings(a));
  }

  return list.sort((a, b) => b.sortScore - a.sortScore);
}

function categoryLabel(id) {
  const category = catalog.categories.find((item) => item.id === id);
  return category?.title || category?.label || "Promoção";
}

function cartItemKey(item) {
  return item.cartId || item.id;
}

function cartItemDetails(item) {
  if (!item) return null;

  if (item.type === "custom-combo") {
    return {
      id: item.id || item.cartId,
      type: item.type,
      title: item.title || "Combo montado",
      unitPrice: Number(item.unitPrice || 0),
      components: Array.isArray(item.components) ? item.components : [],
      selections: Array.isArray(item.selections) ? item.selections : [],
      gifts: Array.isArray(item.gifts) ? item.gifts : []
    };
  }

  const product = productById(item.id);
  if (!product) return null;

  return {
    id: product.id,
    type: "catalog-product",
    title: product.title,
    unitPrice: Number(product.promoPrice || 0),
    components: productComponents(product),
    product
  };
}

function cartCount() {
  return state.cart.reduce((total, item) => total + item.quantity, 0);
}

function cartSubtotal() {
  return state.cart.reduce((total, item) => {
    const details = cartItemDetails(item);
    return details ? total + details.unitPrice * item.quantity : total;
  }, 0);
}

function cartTotal() {
  return cartSubtotal() + (config.deliveryFee || 0);
}

function buildWhatsappUrl(message, phoneNumber = config.whatsappNumber) {
  return `https://wa.me/${phoneNumber}?text=${encodeURIComponent(message)}`;
}

function automationSettings() {
  return config.automation || {};
}

function aiAssistantSettings() {
  return automationSettings().aiAssistant || {};
}

function aiAssistantEnabled() {
  return aiAssistantSettings().enabled !== false;
}

function buildAssistantMessage() {
  const assistant = aiAssistantSettings();
  return assistant.whatsappMessage || `Oi, ${assistant.name || "BCK"}! Vim pelo mini site e quero ajuda para escolher meu pedido.`;
}

function buildAssistantUrl() {
  const assistant = aiAssistantSettings();
  return buildWhatsappUrl(buildAssistantMessage(), assistant.whatsappNumber || config.whatsappNumber);
}

function renderAiAssistant() {
  const assistant = aiAssistantSettings();
  const enabled = aiAssistantEnabled();
  const name = assistant.name || "Bibi";
  const label = assistant.label || `Conversar com ${name}`;

  if (els.aiAssistantCard) {
    els.aiAssistantCard.hidden = !enabled;
  }

  els.aiAssistantLabels.forEach((element) => {
    element.textContent = label;
  });

  if (els.aiAssistantShort) {
    els.aiAssistantShort.textContent = assistant.shortLabel || `${name} IA`;
  }

  if (els.aiAssistantHeadline) {
    els.aiAssistantHeadline.textContent = assistant.headline || `Fale com ${name}`;
  }

  if (els.aiAssistantDescription) {
    els.aiAssistantDescription.textContent = assistant.description || "Continue seu atendimento com a assistente virtual da BCK.";
  }
}

function createOrderId() {
  const prefix = automationSettings().orderPrefix || "BCK";
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(2, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

function configuredOrderApiUrl() {
  return automationSettings().apiReady?.orderApiUrl || "";
}

function paymentInstructions(payment) {
  const automation = automationSettings();

  if (payment === "Pix") {
    const pix = automation.pix || {};
    return [
      pix.instructions || "Faca o Pix e envie o comprovante pelo WhatsApp.",
      pix.key && pix.key !== "CADASTRE_A_CHAVE_PIX" ? `Chave Pix: ${pix.key}` : "Chave Pix: solicitar no WhatsApp",
      pix.receiverName ? `Recebedor: ${pix.receiverName}` : ""
    ].filter(Boolean).join("\n");
  }

  if (payment === "Cartão na entrega" || payment === "Cartao na entrega") {
    return automation.card?.instructions || "Pagamento no cartao na entrega.";
  }

  if (payment === "Dinheiro") {
    return automation.cash?.instructions || "Informe se precisa de troco.";
  }

  return "";
}

function deliveryEstimate() {
  const automation = automationSettings();
  const prep = automation.estimatedPrepMinutes || 35;
  const delivery = automation.estimatedDeliveryMinutes || 55;
  return {
    prepMinutes: prep,
    deliveryMinutes: delivery,
    text: `Preparo estimado: ${prep} min | Entrega estimada: ate ${delivery} min`
  };
}

function saveLastOrder(order) {
  try {
    localStorage.setItem("bck-last-order", JSON.stringify(order));
  } catch {
    // Storage is only a convenience for local recovery.
  }
}

async function submitOrderToApi(order) {
  const orderApiUrl = configuredOrderApiUrl();
  if (!orderApiUrl) return { skipped: true };

  try {
    const response = await fetch(orderApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
      keepalive: true
    });

    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { ok: response.ok, raw: text };
    }
  } catch (error) {
    console.info("Pedido salvo para WhatsApp. API futura indisponivel agora.", error);
    return { ok: false, error: "order_api_unavailable" };
  }
}

function submitOrderToApiWithTimeout(order, timeoutMs = 9000) {
  return Promise.race([
    submitOrderToApi(order),
    new Promise((resolve) => {
      window.setTimeout(() => resolve({ ok: false, error: "order_api_timeout" }), timeoutMs);
    })
  ]);
}

function applyOrderApiResult(order, result = {}) {
  if (result.loyalty) {
    order.loyalty = {
      ...(order.loyalty || {}),
      ...result.loyalty
    };
  }

  return order;
}

function ecommerceItem(product, quantity = 1) {
  return {
    item_id: product.id,
    item_name: product.title,
    item_category: productCategories(product)[0],
    price: product.promoPrice,
    discount: savings(product),
    quantity
  };
}

function ecommerceCartItem(item) {
  const details = cartItemDetails(item);
  if (!details) return null;

  return {
    item_id: details.id,
    item_name: details.title,
    item_category: details.type === "custom-combo" ? "combo-montado" : productCategories(details.product)[0],
    price: details.unitPrice,
    quantity: item.quantity
  };
}

function metaPixelPayload(payload = {}) {
  const items = Array.isArray(payload.ecommerce?.items) ? payload.ecommerce.items : [];
  const contents = items
    .map((item) => {
      const id = item.item_id || item.id || item.item_name || item.title;
      if (!id) return null;

      return {
        id: String(id),
        quantity: Number(item.quantity || 1),
        item_price: Number(item.price || item.unitPrice || 0)
      };
    })
    .filter(Boolean);
  const value = Number.isFinite(Number(payload.value))
    ? Number(payload.value)
    : contents.reduce((total, item) => total + item.item_price * item.quantity, 0);
  const contentName = payload.content_name
    || items.map((item) => item.item_name || item.title).filter(Boolean).join(" + ");
  const contentCategory = payload.content_category
    || items.map((item) => item.item_category).filter(Boolean)[0];

  return {
    currency: config.currency || "BRL",
    value,
    contents,
    content_ids: contents.map((item) => item.id),
    content_type: payload.content_type || "product",
    ...(contentName ? { content_name: contentName } : {}),
    ...(contentCategory ? { content_category: contentCategory } : {}),
    ...(payload.transaction_id ? { order_id: payload.transaction_id } : {}),
    ...(payload.order_id ? { order_id: payload.order_id } : {})
  };
}

function sendMetaPixelStandardEvent(eventName, payload) {
  const pixelId = config.marketing?.metaPixelId;
  if (isConfiguredTrackingId(pixelId)) {
    window.fbq("trackSingle", pixelId, eventName, payload);
    return;
  }

  window.fbq("track", eventName, payload);
}

function trackEvent(eventName, payload = {}) {
  const normalizedName = {
    view_item: "view_item",
    add_to_cart: "add_to_cart",
    begin_checkout: "begin_checkout",
    purchase: "purchase",
    lead: "lead"
  }[eventName] || eventName;

  const data = {
    event: normalizedName,
    currency: config.currency,
    value: payload.value,
    ecommerce: payload.ecommerce,
    ...payload
  };

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(data);

  if (typeof window.gtag === "function") {
    window.gtag("event", normalizedName, data);
  }

  if (typeof window.fbq === "function") {
    const metaName = {
      view_item: "ViewContent",
      add_to_cart: "AddToCart",
      begin_checkout: "InitiateCheckout",
      purchase: "Purchase",
      lead: "Lead"
    }[normalizedName];

    if (metaName) {
      const metaPayload = metaPixelPayload(payload);
      sendMetaPixelStandardEvent(metaName, metaPayload);
      window.fbq("trackCustom", `BCK_${normalizedName}`, metaPayload);
    } else if (/^[A-Za-z0-9_]+$/.test(normalizedName)) {
      const { ecommerce, ...customPayload } = payload;
      window.fbq("trackCustom", normalizedName, {
        ...metaPixelPayload(payload),
        content_type: payload.content_type || "product",
        ...customPayload
      });
    }
  }
}

function renderFeaturedDeal() {
  const featured = activeProducts().find((product) => product.featured) || activeProducts()[0];
  if (!featured) return;

  els.featuredDeal.innerHTML = `
    <span class="deal-card__badge">${featured.badge}</span>
    <div class="deal-card__content">
      <h2>${featured.title}</h2>
      <p>${featured.description}</p>
      <div class="deal-components">
        ${productComponents(featured).map((component) => `<span>${component}</span>`).join("")}
      </div>
      <div class="price-line">
        ${hasOriginalPrice(featured) ? `<span class="old-price">${formatMoney(featured.originalPrice)}</span>` : ""}
        <strong>${formatMoney(featured.promoPrice)}</strong>
      </div>
      ${hasOriginalPrice(featured) ? `<span class="saving-pill">Economize ${formatMoney(savings(featured))}</span>` : ""}
      <button class="btn btn--primary btn--full" type="button" data-add-item="${featured.id}">
        Adicionar oferta do dia
      </button>
    </div>
  `;
}

function renderCategories() {
  els.categoryRail.textContent = "";

  catalog.categories.forEach((category) => {
    const node = els.categoryTemplate.content.firstElementChild.cloneNode(true);
    const count = category.id === "todos"
      ? activeProducts().length
      : activeProducts().filter((product) => productCategories(product).includes(category.id)).length;

    node.dataset.category = category.id;
    node.classList.toggle("is-active", category.id === state.selectedCategory);
    node.querySelector(".category-card__icon").textContent = category.icon;
    node.querySelector("strong").textContent = category.title;
    node.querySelector("small").textContent = `${count} ofertas`;
    node.setAttribute("aria-pressed", String(category.id === state.selectedCategory));

    if (category.id !== "hamburguer" || count > 0) {
      els.categoryRail.appendChild(node);
      return;
    }

    node.querySelector("small").textContent = "Pronto para ativar";
    els.categoryRail.appendChild(node);
  });
}

function renderProducts() {
  const filtered = sortedProducts(
    activeProducts().filter((product) => productMatches(product, state.selectedCategory))
  );

  els.visibleCount.textContent = filtered.length;
  els.productGrid.textContent = "";

  if (!filtered.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Nenhuma oferta ativa nessa categoria agora.";
    els.productGrid.appendChild(empty);
    return;
  }

  filtered.forEach((product) => {
    els.productGrid.appendChild(createProductCard(product));
  });
}

function renderComboBuilder() {
  if (!els.comboBuilderSection) return;

  const settings = comboBuilderSettings();
  if (settings.enabled === false) {
    els.comboBuilderSection.hidden = true;
    return;
  }

  ensureComboBuilderSelection();
  els.comboBuilderSection.hidden = false;
  els.comboBuilderTitle.textContent = settings.title || "Monte seu Combo";
  els.comboBuilderDescription.textContent = settings.description || "";
  els.comboOptions.textContent = "";

  selectedComboItems().forEach((selection) => {
    const items = baseProductsForGroup(selection.group);
    const choice = document.createElement("article");
    choice.className = "combo-choice";

    const heading = document.createElement("div");
    heading.className = "combo-choice__head";

    const title = document.createElement("strong");
    title.textContent = selection.group.label;

    const price = document.createElement("span");
    price.textContent = selection.item ? formatMoney(selection.item.price || 0) : "Sem item";

    heading.append(title, price);

    const itemSelect = document.createElement("select");
    itemSelect.dataset.comboSelect = selection.group.key;
    itemSelect.setAttribute("aria-label", selection.group.label);
    itemSelect.disabled = !items.length;

    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = `${item.title} - ${formatMoney(item.price || 0)}`;
      option.selected = item.id === selection.item?.id;
      itemSelect.appendChild(option);
    });

    if (!items.length) {
      const option = document.createElement("option");
      option.textContent = "Cadastre um item no catalogo";
      itemSelect.appendChild(option);
    }

    choice.append(heading, itemSelect);

    const options = Array.isArray(selection.item?.options) ? selection.item.options : [];
    if (options.length) {
      const optionSelect = document.createElement("select");
      optionSelect.dataset.comboOption = selection.group.key;
      optionSelect.setAttribute("aria-label", `${selection.group.label} opcao`);

      options.forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        option.selected = name === selection.option;
        optionSelect.appendChild(option);
      });

      choice.appendChild(optionSelect);
    }

    if (selection.item?.description) {
      const description = document.createElement("p");
      description.textContent = selection.item.description;
      choice.appendChild(description);
    }

    els.comboOptions.appendChild(choice);
  });

  const subtotal = comboBuilderSubtotal();
  const gift = comboBuilderGift(subtotal);
  const freeGift = settings.freeGift || {};
  const threshold = Number(freeGift.threshold || 0);
  els.comboTotal.textContent = formatMoney(subtotal);
  els.comboAddButton.disabled = !comboSelectionComplete();

  if (freeGift.enabled === false) {
    els.comboGiftStatus.textContent = "Brinde pausado no admin.";
  } else if (gift) {
    els.comboGiftStatus.textContent = `${gift.title} desbloqueado.`;
  } else {
    els.comboGiftStatus.textContent = `Faltam ${formatMoney(Math.max(0, threshold - subtotal))} para liberar ${freeGift.title || "brinde"}.`;
  }

  const summary = selectedComboItems()
    .filter((selection) => selection.item)
    .map((selection) => {
      const option = selection.option ? ` (${selection.option})` : "";
      return `${selection.group.label}: ${selection.item.title}${option}`;
    });

  if (gift) {
    summary.push(`Brinde: ${gift.title}`);
  }

  els.comboSummary.textContent = summary.join(" + ");
}

function renderCombos() {
  els.comboGrid.textContent = "";
  activeProducts()
    .filter((product) => product.combo)
    .sort((a, b) => b.sortScore - a.sortScore)
    .forEach((product) => {
      els.comboGrid.appendChild(createProductCard(product));
    });
}

function createProductCard(product) {
  const card = els.productTemplate.content.firstElementChild.cloneNode(true);
  const image = card.querySelector("img");
  const badge = card.querySelector(".badge");
  const category = card.querySelector(".product-card__category");
  const title = card.querySelector("h3");
  const description = card.querySelector("p");
  const oldPrice = card.querySelector(".old-price");
  const price = card.querySelector(".price-block strong");
  const saving = card.querySelector(".price-block small");
  const addButton = card.querySelector("[data-add-item]");
  const buyButton = card.querySelector("[data-open-checkout-from-item]");
  const viewButton = card.querySelector("[data-view-item]");

  image.src = productImage(product);
  image.alt = product.title;
  badge.textContent = product.badge;
  badge.classList.add(`badge--${product.badgeType || "best"}`);
  category.textContent = product.combo ? "Combo cruzado" : categoryLabel(productCategories(product)[0]);
  title.textContent = product.title;
  description.textContent = product.description;
  oldPrice.textContent = hasOriginalPrice(product) ? formatMoney(product.originalPrice) : "";
  oldPrice.hidden = !hasOriginalPrice(product);
  price.textContent = formatMoney(product.promoPrice);
  saving.textContent = hasOriginalPrice(product) ? `Economize ${formatMoney(savings(product))}` : "";
  saving.hidden = !hasOriginalPrice(product);
  addButton.dataset.addItem = product.id;
  buyButton.dataset.openCheckoutFromItem = product.id;
  viewButton.dataset.viewItem = product.id;

  return card;
}

function buildCustomComboCartItem() {
  if (!comboSelectionComplete()) return null;

  const settings = comboBuilderSettings();
  const subtotal = comboBuilderSubtotal();
  const gift = comboBuilderGift(subtotal);
  const selections = selectedComboItems()
    .filter((selection) => selection.item)
    .map((selection) => ({
      group: selection.group.key,
      groupLabel: selection.group.label,
      id: selection.item.id,
      title: selection.item.title,
      option: selection.option || "",
      price: Number(selection.item.price || 0)
    }));
  const components = selections.map((selection) => {
    const option = selection.option ? ` (${selection.option})` : "";
    return `${selection.groupLabel}: ${selection.title}${option}`;
  });
  const gifts = gift ? [gift] : [];

  gifts.forEach((item) => {
    components.push(`Brinde: ${item.title}`);
  });

  const cartId = `custom-combo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  return {
    id: "combo-montado",
    cartId,
    type: "custom-combo",
    title: settings.title || "Combo montado",
    quantity: 1,
    unitPrice: subtotal,
    components,
    selections,
    gifts,
    rules: {
      freeGiftThreshold: settings.freeGift?.threshold || 0,
      freeGiftUnlocked: Boolean(gift)
    }
  };
}

function addCustomComboToCart() {
  const item = buildCustomComboCartItem();
  if (!item) return;

  state.cart.push(item);
  saveCart();
  renderCart();
  openCart();
  trackEvent("add_to_cart", {
    value: item.unitPrice,
    ecommerce: {
      items: [{
        item_id: item.id,
        item_name: item.title,
        item_category: "combo-montado",
        price: item.unitPrice,
        quantity: 1
      }]
    }
  });
}

function addToCart(productId, quantity = 1) {
  const product = productById(productId);
  if (!product || !product.active) return;

  const current = state.cart.find((item) => item.id === productId && item.type !== "custom-combo");
  if (current) {
    current.quantity += quantity;
  } else {
    state.cart.push({ id: productId, quantity });
  }

  saveCart();
  renderCart();
  openCart();
  trackEvent("add_to_cart", {
    value: product.promoPrice * quantity,
    ecommerce: {
      items: [ecommerceItem(product, quantity)]
    }
  });
}

function changeQuantity(itemKey, delta) {
  const current = state.cart.find((item) => cartItemKey(item) === itemKey);
  if (!current) return;

  current.quantity += delta;
  if (current.quantity <= 0) {
    state.cart = state.cart.filter((item) => cartItemKey(item) !== itemKey);
  }

  saveCart();
  renderCart();
}

function removeFromCart(itemKey) {
  state.cart = state.cart.filter((item) => cartItemKey(item) !== itemKey);
  saveCart();
  renderCart();
}

function renderCart() {
  els.cartList.textContent = "";

  state.cart.forEach((item) => {
    const details = cartItemDetails(item);
    if (!details) return;

    const row = els.cartItemTemplate.content.firstElementChild.cloneNode(true);
    const key = cartItemKey(item);
    row.querySelector("h3").textContent = details.title;
    row.querySelector("p").textContent = details.components.join(" + ");
    row.querySelector(".cart-item__subtotal").textContent = formatMoney(details.unitPrice * item.quantity);
    row.querySelector("output").textContent = item.quantity;
    row.querySelector("[data-decrease-item]").dataset.decreaseItem = key;
    row.querySelector("[data-increase-item]").dataset.increaseItem = key;
    row.querySelector("[data-remove-item]").dataset.removeItem = key;
    els.cartList.appendChild(row);
  });

  const count = cartCount();
  const subtotal = cartSubtotal();
  const total = cartTotal();

  document.querySelectorAll("[data-cart-count]").forEach((el) => {
    el.textContent = count;
  });

  document.querySelectorAll("[data-cart-subtotal]").forEach((el) => {
    el.textContent = formatMoney(subtotal);
  });

  document.querySelectorAll("[data-cart-total]").forEach((el) => {
    el.textContent = formatMoney(total);
  });

  document.querySelectorAll("[data-cart-total-mobile]").forEach((el) => {
    el.textContent = formatMoney(total);
  });

  els.cartEmpty.hidden = count > 0;
}

function buildOrderPayload(formData) {
  const payment = formData.get("payment");
  const estimate = deliveryEstimate();
  const orderId = createOrderId();
  const loyalty = loyaltySettings();
  const items = state.cart
    .map((item) => {
      const details = cartItemDetails(item);
      if (!details) return null;

      return {
        id: details.id,
        type: details.type,
        title: details.title,
        quantity: item.quantity,
        unitPrice: details.unitPrice,
        subtotal: details.unitPrice * item.quantity,
        components: details.components,
        selections: details.selections || [],
        gifts: details.gifts || []
      };
    })
    .filter(Boolean);

  return {
    id: orderId,
    source: "site-promocoes-bck",
    sourceUrl: window.location.href,
    status: "received",
    createdAt: new Date().toISOString(),
    customer: {
      name: formData.get("customerName"),
      phone: formData.get("phone"),
      address: formData.get("address"),
      notes: formData.get("notes") || "Sem observações"
    },
    payment,
    paymentInstructions: paymentInstructions(payment),
    estimates: estimate,
    totals: {
      subtotal: cartSubtotal(),
      deliveryFee: config.deliveryFee || 0,
      total: cartTotal()
    },
    automation: {
      orderApiUrlConfigured: Boolean(configuredOrderApiUrl()),
      whatsappCloudApiConfigured: Boolean(automationSettings().apiReady?.whatsappCloudApi)
    },
    loyalty: {
      enabled: Boolean(loyalty.enabled),
      mode: loyalty.mode,
      purchaseTarget: loyalty.purchaseTarget,
      rewardTitle: loyalty.rewardTitle,
      orderIdField: loyalty.orderIdField,
      historySource: loyalty.historySource,
      orderId
    },
    items
  };
}

function buildOrderMessage(order) {
  const itemLines = order.items.map((item) => {
    const components = Array.isArray(item.components) ? item.components : [];
    return [
      `${item.quantity}x ${item.title}`,
      components.length ? `${item.type === "custom-combo" ? "Combo montado" : "Itens"}: ${components.join(" + ")}` : "",
      `Unitário: ${formatMoney(item.unitPrice)}`,
      `Subtotal: ${formatMoney(item.subtotal)}`
    ].filter(Boolean).join("\n");
  });

  return [
    `NOVO PEDIDO - ${config.storeName}`,
    `Pedido: #${order.id}`,
    "",
    "Cliente:",
    `Nome: ${order.customer.name}`,
    `Telefone: ${order.customer.phone}`,
    `Endereço: ${order.customer.address}`,
    `Observações: ${order.customer.notes}`,
    "",
    "Itens:",
    itemLines.join("\n\n"),
    "",
    `Subtotal: ${formatMoney(order.totals.subtotal)}`,
    `Entrega: ${formatMoney(order.totals.deliveryFee)}`,
    `Total: ${formatMoney(order.totals.total)}`,
    `Pagamento: ${order.payment}`,
    order.paymentInstructions ? `Instrucao de pagamento:\n${order.paymentInstructions}` : "",
    order.estimates?.text || "",
    automationSettings().customerNextStepText || "",
    ...loyaltyMessageLines(order.loyalty),
    "",
    `Origem: ${order.source}`,
    `Horário: ${new Date(order.createdAt).toLocaleString("pt-BR")}`
  ].filter(Boolean).join("\n");
}

function loyaltyMessageLines(loyalty = {}) {
  if (!loyalty.enabled || !loyalty.purchaseTarget) return [];

  const purchaseCount = Number(loyalty.purchaseCount);
  const purchaseTarget = Number(loyalty.purchaseTarget);
  const remaining = Number(loyalty.remaining);
  const rewardTitle = loyalty.rewardTitle || "Pedido gratis";

  if (!Number.isFinite(purchaseCount) || !Number.isFinite(purchaseTarget) || !Number.isFinite(remaining)) {
    return [
      "",
      "FIDELIDADE BCK:",
      "Contador nao confirmou este pedido agora. Validar antes de liberar premio."
    ];
  }

  if (loyalty.rewardUnlocked) {
    return [
      "",
      "FIDELIDADE BCK:",
      `Cliente completou ${purchaseCount}/${purchaseTarget} pedidos no mes.`,
      `Premio liberado: ${rewardTitle}.`
    ];
  }

  if (loyalty.rewardStatus === "available") {
    return [
      "",
      "FIDELIDADE BCK:",
      `${rewardTitle} ja esta disponivel para este telefone neste mes.`,
      `Historico: ${purchaseCount}/${purchaseTarget} pedidos no mes.`
    ];
  }

  return [
    "",
    "FIDELIDADE BCK:",
    `${purchaseCount}/${purchaseTarget} pedidos no mes. Faltam ${remaining}.`
  ];
}

function submitOrder(event) {
  event.preventDefault();

  if (!cartCount()) {
    openCart();
    return;
  }

  const scheduleStatus = getScheduleStatus();
  if (scheduleStatus.schedule.blockCheckoutWhenClosed && !scheduleStatus.acceptingOrders) {
    renderScheduleStatus();
    if (els.checkoutStatus) {
      els.checkoutStatus.hidden = false;
      els.checkoutStatus.textContent = scheduleStatus.next?.text
        ? `${scheduleStatus.schedule.closedCheckoutMessage} ${scheduleStatus.next.text}.`
        : scheduleStatus.schedule.closedCheckoutMessage;
    }
    return;
  }

  const formData = new FormData(els.checkoutForm);
  const order = buildOrderPayload(formData);
  const checkoutWindow = window.open("about:blank", "_blank");
  if (checkoutWindow) {
    checkoutWindow.opener = null;
    checkoutWindow.document.title = "Abrindo WhatsApp BCK";
    checkoutWindow.document.body.innerHTML = "<p style=\"font-family: sans-serif; padding: 24px;\">Preparando pedido BCK...</p>";
  }

  trackEvent("purchase", {
    transaction_id: order.id,
    value: order.totals.total,
    ecommerce: {
      items: order.items.map((item) => ({
        item_id: item.id,
        item_name: item.title,
        price: item.unitPrice,
        quantity: item.quantity
      }))
    }
  });

  trackEvent("lead", {
    value: order.totals.total,
    payment_type: order.payment
  });

  trackEvent(config.marketing?.metaEvents?.checkoutLead || "Lead_Checkout_WhatsApp", {
    value: order.totals.total,
    payment_type: order.payment,
    order_id: order.id,
    content_name: "Checkout WhatsApp BCK",
    content_type: "checkout",
    ecommerce: {
      items: order.items.map((item) => ({
        item_id: item.id,
        item_name: item.title,
        price: item.unitPrice,
        quantity: item.quantity
      }))
    }
  });

  window.BCK_LAST_ORDER = order;
  saveLastOrder(order);
  submitOrderToApiWithTimeout(order).then((result) => {
    window.BCK_LAST_ORDER_API_RESULT = result;
    applyOrderApiResult(order, result);
    window.BCK_LAST_ORDER = order;
    saveLastOrder(order);

    const url = buildWhatsappUrl(buildOrderMessage(order));
    if (checkoutWindow && !checkoutWindow.closed) {
      checkoutWindow.location.href = url;
    } else {
      window.open(url, "_blank", "noopener");
    }

    clearCartAfterOrder();
    showOrderConfirmation(order);
  });
}

function openCart() {
  els.cartDrawer.hidden = false;
}

function closeCart() {
  els.cartDrawer.hidden = true;
}

function clearCartAfterOrder() {
  state.cart = [];
  saveCart();
  renderCart();
  closeCart();
}

function showOrderConfirmation(order) {
  if (!els.orderConfirmation) return;

  els.orderConfirmationId.textContent = `Pedido #${order.id}`;
  els.orderConfirmation.hidden = false;
  window.clearTimeout(showOrderConfirmation.timer);
  showOrderConfirmation.timer = window.setTimeout(() => {
    els.orderConfirmation.hidden = true;
  }, 12000);
}

function closeOrderConfirmation() {
  if (els.orderConfirmation) {
    els.orderConfirmation.hidden = true;
  }
}

function openCheckout() {
  if (!cartCount()) {
    openCart();
    return;
  }

  trackEvent("begin_checkout", {
    value: cartTotal(),
    ecommerce: {
      items: state.cart.map(ecommerceCartItem).filter(Boolean)
    }
  });

  closeCart();
  document.querySelector("#checkout").scrollIntoView({ behavior: "smooth", block: "start" });
  const firstInput = els.checkoutForm.querySelector("input");
  window.setTimeout(() => firstInput.focus({ preventScroll: true }), 450);
}

function openAiAssistant() {
  if (!aiAssistantEnabled()) return;

  const assistant = aiAssistantSettings();
  trackEvent("lead", {
    value: cartTotal(),
    assistant_name: assistant.name || "Bibi",
    source: "ai_assistant_cta"
  });

  const url = buildAssistantUrl();
  const assistantWindow = window.open(url, "_blank", "noopener");
  if (!assistantWindow) {
    window.location.href = url;
  }
}

function saveCart() {
  localStorage.setItem("bck-promos-cart", JSON.stringify(state.cart));
}

function loadCart() {
  try {
    return JSON.parse(localStorage.getItem("bck-promos-cart")) || [];
  } catch {
    return [];
  }
}

function storeSchedule() {
  return catalog.schedule || normalizeSchedule();
}

function timeToMinutes(value, fallback = "00:00") {
  const time = normalizeClockTime(value, fallback);
  const [hour, minute] = time.split(":").map((part) => Number(part));
  return (hour * 60) + minute;
}

function formatTimeLabel(value) {
  return normalizeClockTime(value, "00:00").replace(":00", "h").replace(":", "h");
}

function formatScheduleWindow(day) {
  if (!day || day.open === false) return "Fechado";
  return `${formatTimeLabel(day.openTime)} as ${formatTimeLabel(day.closeTime)}`;
}

function zonedNowParts(date = new Date(), timeZone = "America/Sao_Paulo") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});

  const weekday = String(parts.weekday || "sun").toLowerCase().slice(0, 3);
  const keyMap = { sun: "sun", mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat" };
  const dayKey = keyMap[weekday] || "sun";

  return {
    dayKey,
    dayIndex: WEEKDAY_KEYS.indexOf(dayKey),
    minutes: (Number(parts.hour || 0) * 60) + Number(parts.minute || 0)
  };
}

function dayWindow(day, endField = "closeTime") {
  if (!day || day.open === false) return null;

  const start = timeToMinutes(day.openTime, "17:00");
  let end = timeToMinutes(day[endField] || day.closeTime, day.closeTime || "00:00");
  if (end <= start) end += 1440;

  return { start, end };
}

function isWithinDayWindow(day, minutes, endField) {
  const window = dayWindow(day, endField);
  return Boolean(window && minutes >= window.start && minutes < window.end);
}

function findScheduleDay(schedule, key) {
  return schedule.days.find((day) => day.key === key);
}

function findNextAcceptingTime(schedule, dayIndex, minutes) {
  for (let offset = 0; offset < 8; offset += 1) {
    const nextIndex = (dayIndex + offset) % WEEKDAY_KEYS.length;
    const day = findScheduleDay(schedule, WEEKDAY_KEYS[nextIndex]);
    if (!day || day.open === false) continue;

    const window = dayWindow(day, "cutoffTime");
    if (!window) continue;

    if (offset === 0 && window.start <= minutes) continue;

    return {
      day,
      offset,
      text: offset === 0
        ? `Abre hoje as ${formatTimeLabel(day.openTime)}`
        : offset === 1
          ? `Abre amanha as ${formatTimeLabel(day.openTime)}`
          : `Abre ${day.label} as ${formatTimeLabel(day.openTime)}`
    };
  }

  return null;
}

function getScheduleStatus(date = new Date()) {
  const schedule = storeSchedule();
  if (!schedule.enabled) {
    return { open: true, acceptingOrders: true, schedule, today: null, activeDay: null, next: null };
  }

  const now = zonedNowParts(date, schedule.timezone);
  const today = findScheduleDay(schedule, WEEKDAY_KEYS[now.dayIndex]) || schedule.days[0];
  const previousIndex = (now.dayIndex + WEEKDAY_KEYS.length - 1) % WEEKDAY_KEYS.length;
  const previous = findScheduleDay(schedule, WEEKDAY_KEYS[previousIndex]);
  const todayOpen = isWithinDayWindow(today, now.minutes, "closeTime");
  const previousOpen = isWithinDayWindow(previous, now.minutes + 1440, "closeTime");
  const activeDay = todayOpen ? today : previousOpen ? previous : today;
  const open = todayOpen || previousOpen;
  const compareMinutes = previousOpen && !todayOpen ? now.minutes + 1440 : now.minutes;
  const acceptingOrders = open && isWithinDayWindow(activeDay, compareMinutes, "cutoffTime");
  const next = acceptingOrders ? null : findNextAcceptingTime(schedule, now.dayIndex, now.minutes);

  return {
    open,
    acceptingOrders,
    schedule,
    today,
    activeDay,
    next,
    reason: open ? "orders_closed" : "store_closed"
  };
}

function renderScheduleStatus() {
  const status = getScheduleStatus();
  const schedule = status.schedule;
  const today = status.today || status.activeDay;
  const shouldBlock = schedule.blockCheckoutWhenClosed && !status.acceptingOrders;

  if (els.openStatus) {
    els.openStatus.textContent = status.acceptingOrders
      ? schedule.openLabel
      : status.open
        ? "Pedidos encerrados"
        : schedule.closedLabel;
    els.openStatus.classList.toggle("is-closed", !status.acceptingOrders);
  }

  if (els.hoursTitle) {
    els.hoursTitle.textContent = today ? `Horario de ${today.label}` : "Horario do delivery";
  }

  if (els.hoursValue) {
    els.hoursValue.textContent = today ? formatScheduleWindow(today) : "17h as 00h";
  }

  if (els.hoursNote) {
    if (status.acceptingOrders && status.activeDay) {
      els.hoursNote.textContent = `Pedidos pelo site ate ${formatTimeLabel(status.activeDay.cutoffTime)}. A equipe confirma pelo WhatsApp.`;
    } else {
      els.hoursNote.textContent = status.next?.text
        ? `${status.next.text}. Voce ainda pode montar o carrinho.`
        : "Voce ainda pode montar o carrinho, mas o envio do pedido esta fechado.";
    }
  }

  if (els.checkoutStatus) {
    els.checkoutStatus.hidden = !shouldBlock;
    if (shouldBlock) {
      els.checkoutStatus.textContent = status.next?.text
        ? `${schedule.closedCheckoutMessage} ${status.next.text}.`
        : schedule.closedCheckoutMessage;
    }
  }

  if (els.checkoutSubmit) {
    els.checkoutSubmit.disabled = shouldBlock;
    els.checkoutSubmit.textContent = shouldBlock ? "Pedido fechado agora" : "Enviar pedido completo";
  }
}

function updateTodayLabel() {
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date());
  els.todayLabel.textContent = `Promoções de hoje, ${label}`;
}

function updateCountdown() {
  renderScheduleStatus();

  const status = getScheduleStatus();
  if (status.schedule.enabled && !status.acceptingOrders) {
    if (els.countdownLabel) {
      els.countdownLabel.textContent = status.next?.text || "Horario fechado";
    }
    els.countdown.textContent = "--:--:--";
    return;
  }

  const now = new Date();
  const end = new Date(now);
  const cutoff = status.activeDay?.cutoffTime || config.marketing?.orderCutoffTime || "23:30";
  const cutoffLabel = cutoff.replace(":", "h");
  const [cutoffHour, cutoffMinute] = cutoff.split(":").map((part) => Number(part));
  const hour = Number.isFinite(cutoffHour) ? cutoffHour : 23;
  const minute = Number.isFinite(cutoffMinute) ? cutoffMinute : 30;

  end.setHours(hour, minute, 0, 0);
  if (end <= now) {
    end.setDate(end.getDate() + 1);
  }

  const ms = Math.max(0, end - now);
  const hours = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
  if (els.countdownLabel) {
    els.countdownLabel.textContent = end.getDate() === now.getDate()
      ? `Peça até ${cutoffLabel}`
      : "Próxima rodada em";
  }
  els.countdown.textContent = `${hours}:${minutes}:${seconds}`;
}

function duplicateTicker() {
  const clones = [...els.tickerTrack.children].map((child) => child.cloneNode(true));
  clones.forEach((child) => els.tickerTrack.appendChild(child));
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      state.selectedCategory = categoryButton.dataset.category;
      renderCategories();
      renderProducts();
      return;
    }

    const addButton = event.target.closest("[data-add-item]");
    if (addButton) {
      addToCart(addButton.dataset.addItem);
      return;
    }

    if (event.target.closest("[data-add-custom-combo]")) {
      addCustomComboToCart();
      return;
    }

    const buyButton = event.target.closest("[data-open-checkout-from-item]");
    if (buyButton) {
      addToCart(buyButton.dataset.openCheckoutFromItem);
      openCheckout();
      return;
    }

    const viewButton = event.target.closest("[data-view-item]");
    if (viewButton) {
      const product = productById(viewButton.dataset.viewItem);
      if (product) {
        trackEvent("view_item", {
          value: product.promoPrice,
          ecommerce: {
            items: [ecommerceItem(product)]
          }
        });
      }
      return;
    }

    if (event.target.closest("[data-open-cart]")) {
      openCart();
      return;
    }

    if (event.target.closest("[data-close-cart]")) {
      closeCart();
      return;
    }

    if (event.target.closest("[data-close-order-confirmation]")) {
      closeOrderConfirmation();
      return;
    }

    if (event.target.closest("[data-open-checkout]")) {
      openCheckout();
      return;
    }

    if (event.target.closest("[data-open-ai-assistant]")) {
      openAiAssistant();
      return;
    }

    const decrease = event.target.closest("[data-decrease-item]");
    if (decrease) {
      changeQuantity(decrease.dataset.decreaseItem, -1);
      return;
    }

    const increase = event.target.closest("[data-increase-item]");
    if (increase) {
      changeQuantity(increase.dataset.increaseItem, 1);
      return;
    }

    const remove = event.target.closest("[data-remove-item]");
    if (remove) {
      removeFromCart(remove.dataset.removeItem);
      return;
    }

    const tracked = event.target.closest("[data-track-click]");
    if (tracked) {
      trackEvent("click", {
        label: tracked.dataset.trackClick
      });
    }
  });

  document.addEventListener("change", (event) => {
    const comboSelect = event.target.closest("[data-combo-select]");
    if (comboSelect) {
      const group = comboBuilderGroups().find((item) => item.key === comboSelect.dataset.comboSelect);
      if (group) {
        setComboGroupState(group, comboSelect.value);
        renderComboBuilder();
      }
      return;
    }

    const comboOption = event.target.closest("[data-combo-option]");
    if (comboOption) {
      const group = comboBuilderGroups().find((item) => item.key === comboOption.dataset.comboOption);
      if (group) {
        const current = comboGroupState(group);
        setComboGroupState(group, current.itemId, comboOption.value);
        renderComboBuilder();
      }
    }
  });

  els.sortSelect.addEventListener("change", () => {
    state.sort = els.sortSelect.value;
    renderProducts();
  });

  els.checkoutForm.addEventListener("submit", submitOrder);
}

function exposeIntegrationHooks() {
  window.BCK_STORE = {
    config,
    catalog,
    getCart: () => [...state.cart],
    addToCart,
    addCustomComboToCart,
    removeFromCart,
    changeQuantity,
    buildOrderPayload,
    buildOrderMessage,
    buildAssistantMessage,
    openAiAssistant,
    submitOrderToApi,
    getScheduleStatus,
    trackEvent
  };
}

async function init() {
  installMetaPixel();
  await loadCatalogData();
  ensureComboBuilderSelection();
  updateTodayLabel();
  duplicateTicker();
  renderFeaturedDeal();
  renderCategories();
  renderProducts();
  renderComboBuilder();
  renderCombos();
  renderCart();
  renderAiAssistant();
  renderScheduleStatus();
  bindEvents();
  exposeIntegrationHooks();
  updateCountdown();
  setInterval(updateCountdown, 1000);

  trackEvent("page_view", {
    page_title: document.title
  });
}

init();
