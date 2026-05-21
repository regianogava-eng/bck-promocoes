const config = window.BCK_CONFIG;
let catalog = normalizeCatalog(window.BCK_CATALOG || { categories: [], products: [] });

const state = {
  selectedCategory: "todos",
  sort: "featured",
  cart: loadCart()
};

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: config.currency || "BRL"
});

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
    products: flatProducts.length ? flatProducts : groupedProducts
  };
}

const els = {
  featuredDeal: document.querySelector("[data-featured-deal]"),
  tickerTrack: document.querySelector("[data-ticker-track]"),
  todayLabel: document.querySelector("[data-today-label]"),
  countdown: document.querySelector("[data-countdown]"),
  categoryRail: document.querySelector("[data-category-rail]"),
  productGrid: document.querySelector("[data-product-grid]"),
  comboGrid: document.querySelector("[data-combo-grid]"),
  visibleCount: document.querySelector("[data-visible-count]"),
  sortSelect: document.querySelector("[data-sort-select]"),
  cartDrawer: document.querySelector("[data-cart-drawer]"),
  cartList: document.querySelector("[data-cart-list]"),
  cartEmpty: document.querySelector("[data-cart-empty]"),
  checkoutForm: document.querySelector("[data-checkout-form]"),
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
  try {
    const response = await fetch("data/catalog.json", { cache: "no-store" });
    if (!response.ok) return;

    const remoteCatalog = normalizeCatalog(await response.json());
    if (remoteCatalog.categories.length && remoteCatalog.products.length) {
      catalog = remoteCatalog;
    }
  } catch (error) {
    console.info("Usando catálogo local de fallback.", error);
  }
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
  return catalog.categories.find((category) => category.id === id)?.title || "Promoção";
}

function cartCount() {
  return state.cart.reduce((total, item) => total + item.quantity, 0);
}

function cartSubtotal() {
  return state.cart.reduce((total, item) => {
    const product = productById(item.id);
    return product ? total + product.promoPrice * item.quantity : total;
  }, 0);
}

function cartTotal() {
  return cartSubtotal() + (config.deliveryFee || 0);
}

function buildWhatsappUrl(message) {
  return `https://wa.me/${config.whatsappNumber}?text=${encodeURIComponent(message)}`;
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
      window.fbq("track", metaName, {
        currency: config.currency,
        value: payload.value,
        contents: payload.ecommerce?.items || [],
        content_type: "product"
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

function addToCart(productId, quantity = 1) {
  const product = productById(productId);
  if (!product || !product.active) return;

  const current = state.cart.find((item) => item.id === productId);
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

function changeQuantity(productId, delta) {
  const current = state.cart.find((item) => item.id === productId);
  if (!current) return;

  current.quantity += delta;
  if (current.quantity <= 0) {
    state.cart = state.cart.filter((item) => item.id !== productId);
  }

  saveCart();
  renderCart();
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.id !== productId);
  saveCart();
  renderCart();
}

function renderCart() {
  els.cartList.textContent = "";

  state.cart.forEach((item) => {
    const product = productById(item.id);
    if (!product) return;

    const row = els.cartItemTemplate.content.firstElementChild.cloneNode(true);
    row.querySelector("h3").textContent = product.title;
    row.querySelector("p").textContent = productComponents(product).join(" + ");
    row.querySelector(".cart-item__subtotal").textContent = formatMoney(product.promoPrice * item.quantity);
    row.querySelector("output").textContent = item.quantity;
    row.querySelector("[data-decrease-item]").dataset.decreaseItem = product.id;
    row.querySelector("[data-increase-item]").dataset.increaseItem = product.id;
    row.querySelector("[data-remove-item]").dataset.removeItem = product.id;
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
  const items = state.cart
    .map((item) => {
      const product = productById(item.id);
      if (!product) return null;
      return {
        id: product.id,
        title: product.title,
        quantity: item.quantity,
        unitPrice: product.promoPrice,
        subtotal: product.promoPrice * item.quantity,
        components: productComponents(product)
      };
    })
    .filter(Boolean);

  return {
    source: "site-promocoes-bck",
    createdAt: new Date().toISOString(),
    customer: {
      name: formData.get("customerName"),
      phone: formData.get("phone"),
      address: formData.get("address"),
      notes: formData.get("notes") || "Sem observações"
    },
    payment: formData.get("payment"),
    totals: {
      subtotal: cartSubtotal(),
      deliveryFee: config.deliveryFee || 0,
      total: cartTotal()
    },
    items
  };
}

function buildOrderMessage(order) {
  const itemLines = order.items.map((item) => {
    return [
      `${item.quantity}x ${item.title}`,
      `Itens: ${item.components.join(" + ")}`,
      `Unitário: ${formatMoney(item.unitPrice)}`,
      `Subtotal: ${formatMoney(item.subtotal)}`
    ].join("\n");
  });

  return [
    `NOVO PEDIDO - ${config.storeName}`,
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
    "",
    `Origem: ${order.source}`,
    `Horário: ${new Date(order.createdAt).toLocaleString("pt-BR")}`
  ].join("\n");
}

function submitOrder(event) {
  event.preventDefault();

  if (!cartCount()) {
    openCart();
    return;
  }

  const formData = new FormData(els.checkoutForm);
  const order = buildOrderPayload(formData);
  const message = buildOrderMessage(order);
  const url = buildWhatsappUrl(message);

  trackEvent("purchase", {
    transaction_id: `bck-${Date.now()}`,
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

  window.BCK_LAST_ORDER = order;
  window.open(url, "_blank", "noopener");
}

function openCart() {
  els.cartDrawer.hidden = false;
}

function closeCart() {
  els.cartDrawer.hidden = true;
}

function openCheckout() {
  if (!cartCount()) {
    openCart();
    return;
  }

  trackEvent("begin_checkout", {
    value: cartTotal(),
    ecommerce: {
      items: state.cart.map((item) => {
        const product = productById(item.id);
        return product ? ecommerceItem(product, item.quantity) : null;
      }).filter(Boolean)
    }
  });

  closeCart();
  document.querySelector("#checkout").scrollIntoView({ behavior: "smooth", block: "start" });
  const firstInput = els.checkoutForm.querySelector("input");
  window.setTimeout(() => firstInput.focus({ preventScroll: true }), 450);
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

function updateTodayLabel() {
  const label = new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit"
  }).format(new Date());
  els.todayLabel.textContent = `Promoções de hoje, ${label}`;
}

function updateCountdown() {
  const now = new Date();
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const ms = Math.max(0, end - now);
  const hours = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
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

    if (event.target.closest("[data-open-checkout]")) {
      openCheckout();
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
    removeFromCart,
    changeQuantity,
    buildOrderPayload,
    buildOrderMessage,
    trackEvent
  };
}

async function init() {
  await loadCatalogData();
  updateTodayLabel();
  duplicateTicker();
  renderFeaturedDeal();
  renderCategories();
  renderProducts();
  renderCombos();
  renderCart();
  bindEvents();
  exposeIntegrationHooks();
  updateCountdown();
  setInterval(updateCountdown, 1000);

  trackEvent("page_view", {
    page_title: document.title
  });
}

init();
