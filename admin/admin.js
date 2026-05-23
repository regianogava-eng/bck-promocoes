(function () {
  "use strict";

  var BRANCH = "main";
  var CATALOG_PATH = "data/catalog.json";
  var IMAGE_DIR = "assets/images";
  var GIT_ROOT = "/.netlify/git/github";

  var state = {
    catalog: null,
    catalogSha: null,
    selectedCategory: "todos",
    query: "",
    dirty: false,
    editingId: null,
    pendingImages: {},
    lastNoticeTimer: null
  };

  var elements = {};

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    cacheElements();
    bindEvents();
    setupIdentity();
    loadCatalogFromPublic();
  }

  function cacheElements() {
    elements.sessionLabel = document.getElementById("sessionLabel");
    elements.saveLabel = document.getElementById("saveLabel");
    elements.categoryNav = document.getElementById("categoryNav");
    elements.productGrid = document.getElementById("productGrid");
    elements.searchInput = document.getElementById("searchInput");
    elements.notice = document.getElementById("notice");
    elements.loginButton = document.getElementById("loginButton");
    elements.logoutButton = document.getElementById("logoutButton");
    elements.reloadButton = document.getElementById("reloadButton");
    elements.saveButton = document.getElementById("saveButton");
    elements.newProductButton = document.getElementById("newProductButton");
    elements.activeCount = document.getElementById("activeCount");
    elements.comboCount = document.getElementById("comboCount");
    elements.featuredCount = document.getElementById("featuredCount");
    elements.dialog = document.getElementById("productDialog");
    elements.form = document.getElementById("productForm");
    elements.editorTitle = document.getElementById("editorTitle");
    elements.closeEditorButton = document.getElementById("closeEditorButton");
    elements.cancelEditorButton = document.getElementById("cancelEditorButton");
    elements.deleteProductButton = document.getElementById("deleteProductButton");
    elements.duplicateProductButton = document.getElementById("duplicateProductButton");
    elements.imagePreview = document.getElementById("imagePreview");
    elements.productImageFile = document.getElementById("productImageFile");
    elements.productImage = document.getElementById("productImage");
    elements.productTitle = document.getElementById("productTitle");
    elements.productDescription = document.getElementById("productDescription");
    elements.productPromoPrice = document.getElementById("productPromoPrice");
    elements.productOriginalPrice = document.getElementById("productOriginalPrice");
    elements.productBadge = document.getElementById("productBadge");
    elements.productBadgeType = document.getElementById("productBadgeType");
    elements.productActive = document.getElementById("productActive");
    elements.productFeatured = document.getElementById("productFeatured");
    elements.productCombo = document.getElementById("productCombo");
    elements.categoryChecks = document.getElementById("categoryChecks");
    elements.productComponents = document.getElementById("productComponents");
    elements.productSortScore = document.getElementById("productSortScore");
  }

  function bindEvents() {
    elements.loginButton.addEventListener("click", function () {
      if (window.netlifyIdentity) {
        window.netlifyIdentity.open();
      }
    });

    elements.logoutButton.addEventListener("click", function () {
      if (window.netlifyIdentity) {
        window.netlifyIdentity.logout();
      }
    });

    elements.reloadButton.addEventListener("click", function () {
      if (state.dirty && !window.confirm("Voce tem alteracoes nao salvas. Recarregar mesmo assim?")) {
        return;
      }
      loadCatalogFromPublic();
    });

    elements.saveButton.addEventListener("click", saveCatalog);

    elements.newProductButton.addEventListener("click", function () {
      if (!state.catalog) {
        showNotice("Espere o catalogo carregar antes de criar uma oferta.", "error");
        return;
      }
      openEditor(createBlankProduct());
    });

    elements.searchInput.addEventListener("input", function (event) {
      state.query = event.target.value.trim().toLowerCase();
      renderProducts();
    });

    elements.productGrid.addEventListener("click", function (event) {
      var editButton = event.target.closest("[data-edit-id]");
      var activeToggle = event.target.closest("[data-active-id]");

      if (editButton) {
        openEditor(findProduct(editButton.getAttribute("data-edit-id")));
      }

      if (activeToggle) {
        toggleProductActive(activeToggle.getAttribute("data-active-id"), activeToggle.checked);
      }
    });

    elements.productImage.addEventListener("input", function () {
      updateImagePreview(elements.productImage.value);
    });

    elements.productImageFile.addEventListener("change", handleImageSelection);

    elements.closeEditorButton.addEventListener("click", closeEditor);
    elements.cancelEditorButton.addEventListener("click", closeEditor);

    elements.deleteProductButton.addEventListener("click", deleteCurrentProduct);
    elements.duplicateProductButton.addEventListener("click", duplicateCurrentProduct);

    elements.form.addEventListener("submit", function (event) {
      event.preventDefault();
      applyEditorChanges();
    });
  }

  function setupIdentity() {
    if (!window.netlifyIdentity) {
      setSession(false);
      showNotice("O login do Netlify nao carregou. Recarregue a pagina ou abra o Decap antigo.", "error");
      return;
    }

    window.netlifyIdentity.on("init", function (user) {
      setSession(Boolean(user));
    });

    window.netlifyIdentity.on("login", function () {
      window.netlifyIdentity.close();
      setSession(true);
      showNotice("Login feito. Agora voce pode salvar no GitHub.", "ok");
      refreshCatalogSha();
    });

    window.netlifyIdentity.on("logout", function () {
      setSession(false);
      showNotice("Voce saiu do painel.", "");
    });

    window.netlifyIdentity.init();
    setSession(Boolean(window.netlifyIdentity.currentUser()));
  }

  function setSession(isLogged) {
    elements.sessionLabel.textContent = isLogged ? "Logado" : "Precisa entrar";
    elements.loginButton.classList.toggle("hidden", isLogged);
    elements.logoutButton.classList.toggle("hidden", !isLogged);
    elements.saveButton.disabled = !isLogged;
  }

  async function loadCatalogFromPublic() {
    setBusy("Carregando catalogo...");
    try {
      var response = await fetch("/" + CATALOG_PATH + "?v=" + Date.now(), { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Nao consegui carregar o catalogo.");
      }

      state.catalog = normalizeCatalog(await response.json());
      state.pendingImages = {};
      state.dirty = false;
      await refreshCatalogSha();
      renderAll();
      setReady("Catalogo carregado");
      showNotice("Painel pronto. Edite os cards e clique em Salvar no site.", "ok");
    } catch (error) {
      console.error(error);
      setReady("Erro ao carregar");
      showNotice(error.message || "Erro ao carregar o catalogo.", "error");
    }
  }

  async function refreshCatalogSha() {
    if (!currentUser()) {
      state.catalogSha = null;
      return;
    }

    try {
      var file = await gitGetFile(CATALOG_PATH);
      state.catalogSha = file.sha || null;
    } catch (error) {
      state.catalogSha = null;
    }
  }

  function normalizeCatalog(catalog) {
    catalog = catalog || {};
    catalog.categories = Array.isArray(catalog.categories) ? catalog.categories : [];
    catalog.products = Array.isArray(catalog.products) ? catalog.products : [];

    if (!catalog.categories.some(function (category) { return category.id === "todos"; })) {
      catalog.categories.unshift({ id: "todos", label: "Todos", description: "Todas as ofertas" });
    }

    catalog.products = catalog.products.map(function (product, index) {
      return normalizeProduct(product, index);
    });

    return catalog;
  }

  function normalizeProduct(product, index) {
    var normalized = Object.assign({}, product || {});
    normalized.id = normalized.id || makeId(normalized.title || "oferta-" + index);
    normalized.active = normalized.active !== false;
    normalized.featured = Boolean(normalized.featured);
    normalized.combo = Boolean(normalized.combo);
    normalized.categories = Array.isArray(normalized.categories) ? normalized.categories : [];
    normalized.components = Array.isArray(normalized.components) ? normalized.components : [];
    normalized.title = normalized.title || "Nova oferta";
    normalized.description = normalized.description || "";
    normalized.image = normalized.image || "";
    normalized.originalPrice = toNumber(normalized.originalPrice);
    normalized.promoPrice = toNumber(normalized.promoPrice);
    normalized.badge = normalized.badge || "";
    normalized.badgeType = normalized.badgeType || "hot";
    normalized.sortScore = Number.isFinite(Number(normalized.sortScore)) ? Number(normalized.sortScore) : index + 1;
    return normalized;
  }

  function renderAll() {
    renderCategories();
    renderProducts();
    renderMetrics();
  }

  function renderCategories() {
    var categories = state.catalog.categories;
    elements.categoryNav.innerHTML = categories.map(function (category) {
      var count = category.id === "todos"
        ? state.catalog.products.length
        : state.catalog.products.filter(function (product) {
          return product.categories.indexOf(category.id) >= 0;
        }).length;

      return [
        '<button class="category-button ' + (state.selectedCategory === category.id ? "active" : "") + '" type="button" data-category="' + escapeAttr(category.id) + '">',
        '<strong>' + escapeHtml(category.label || category.id) + '</strong>',
        '<span>' + count + '</span>',
        '</button>'
      ].join("");
    }).join("");

    elements.categoryNav.querySelectorAll("[data-category]").forEach(function (button) {
      button.addEventListener("click", function () {
        state.selectedCategory = button.getAttribute("data-category");
        renderCategories();
        renderProducts();
      });
    });
  }

  function renderMetrics() {
    var products = state.catalog.products;
    elements.activeCount.textContent = products.filter(function (product) { return product.active; }).length;
    elements.comboCount.textContent = products.filter(function (product) { return product.combo; }).length;
    elements.featuredCount.textContent = products.filter(function (product) { return product.featured; }).length;
  }

  function renderProducts() {
    var products = filteredProducts();

    if (!products.length) {
      elements.productGrid.innerHTML = '<section class="notice">Nenhuma oferta encontrada nesta aba.</section>';
      return;
    }

    elements.productGrid.innerHTML = products.map(function (product) {
      var categories = product.categories.map(categoryLabel).filter(Boolean);
      var description = product.description || "";
      var image = product.image || "";
      var statusText = product.active ? "Ativa" : "Inativa";

      return [
        '<article class="product-card ' + (product.active ? "" : "inactive") + '">',
        '<div class="card-image">',
        image ? '<img src="' + escapeAttr(assetUrl(image)) + '" alt="' + escapeAttr(product.title) + '">' : "",
        product.badge ? '<span class="badge ' + escapeAttr(product.badgeType || "hot") + '">' + escapeHtml(product.badge) + '</span>' : "",
        '</div>',
        '<div class="card-body">',
        '<h3>' + escapeHtml(product.title) + '</h3>',
        '<p>' + escapeHtml(description.slice(0, 118)) + (description.length > 118 ? "..." : "") + '</p>',
        '<div class="price-row">',
        '<strong>' + formatCurrency(product.promoPrice) + '</strong>',
        product.originalPrice ? '<del>' + formatCurrency(product.originalPrice) + '</del>' : "",
        '</div>',
        '<div class="chip-row">',
        '<span class="chip">' + escapeHtml(statusText) + '</span>',
        product.featured ? '<span class="chip">Destaque</span>' : "",
        product.combo ? '<span class="chip">Combo</span>' : "",
        categories.slice(0, 2).map(function (category) { return '<span class="chip">' + escapeHtml(category) + '</span>'; }).join(""),
        '</div>',
        '<div class="card-actions">',
        '<button class="btn secondary" type="button" data-edit-id="' + escapeAttr(product.id) + '">Editar</button>',
        '<label class="mini-toggle"><input type="checkbox" data-active-id="' + escapeAttr(product.id) + '"' + (product.active ? " checked" : "") + '> On</label>',
        '</div>',
        '</div>',
        '</article>'
      ].join("");
    }).join("");
  }

  function filteredProducts() {
    var query = state.query;
    return state.catalog.products
      .filter(function (product) {
        if (state.selectedCategory !== "todos" && product.categories.indexOf(state.selectedCategory) < 0) {
          return false;
        }

        if (!query) {
          return true;
        }

        var searchable = [
          product.title,
          product.description,
          product.badge,
          product.categories.join(" "),
          product.components.join(" ")
        ].join(" ").toLowerCase();

        return searchable.indexOf(query) >= 0;
      })
      .sort(function (a, b) {
        return Number(a.sortScore || 0) - Number(b.sortScore || 0);
      });
  }

  function openEditor(product) {
    if (!product) {
      return;
    }

    state.editingId = product.id;
    elements.editorTitle.textContent = product.title || "Nova oferta";
    elements.productImageFile.value = "";
    elements.productImage.value = product.image || "";
    elements.productTitle.value = product.title || "";
    elements.productDescription.value = product.description || "";
    elements.productPromoPrice.value = product.promoPrice || "";
    elements.productOriginalPrice.value = product.originalPrice || "";
    elements.productBadge.value = product.badge || "";
    elements.productBadgeType.value = product.badgeType || "hot";
    elements.productActive.checked = product.active !== false;
    elements.productFeatured.checked = Boolean(product.featured);
    elements.productCombo.checked = Boolean(product.combo);
    elements.productComponents.value = Array.isArray(product.components) ? product.components.join("\n") : "";
    elements.productSortScore.value = product.sortScore || "";
    renderCategoryChecks(product.categories || []);
    updateImagePreview(product.image);

    if (elements.dialog.showModal) {
      elements.dialog.showModal();
    } else {
      elements.dialog.setAttribute("open", "open");
    }
  }

  function closeEditor() {
    state.editingId = null;
    if (elements.dialog.open && elements.dialog.close) {
      elements.dialog.close();
    } else {
      elements.dialog.removeAttribute("open");
    }
  }

  function renderCategoryChecks(selected) {
    var selectedSet = new Set(selected || []);
    elements.categoryChecks.innerHTML = state.catalog.categories
      .filter(function (category) { return category.id !== "todos"; })
      .map(function (category) {
        return [
          '<label class="check-card">',
          '<input type="checkbox" value="' + escapeAttr(category.id) + '"' + (selectedSet.has(category.id) ? " checked" : "") + '>',
          '<span>' + escapeHtml(category.label || category.id) + '</span>',
          '</label>'
        ].join("");
      }).join("");
  }

  function applyEditorChanges() {
    var product = findProduct(state.editingId);
    if (!product) {
      product = createBlankProduct();
      state.catalog.products.push(product);
    }

    product.title = elements.productTitle.value.trim() || "Oferta sem nome";
    product.id = product.id || makeId(product.title);
    product.description = elements.productDescription.value.trim();
    product.image = elements.productImage.value.trim();
    product.promoPrice = toNumber(elements.productPromoPrice.value);
    product.originalPrice = toNumber(elements.productOriginalPrice.value);
    product.badge = elements.productBadge.value.trim();
    product.badgeType = elements.productBadgeType.value || "hot";
    product.active = elements.productActive.checked;
    product.featured = elements.productFeatured.checked;
    product.combo = elements.productCombo.checked;
    product.categories = getCheckedCategories();
    product.components = elements.productComponents.value
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
    product.sortScore = toNumber(elements.productSortScore.value);

    if (!product.categories.length) {
      product.categories = ["combos"];
    }

    markDirty("Alteracao aplicada. Falta salvar no site.");
    closeEditor();
    renderAll();
  }

  function getCheckedCategories() {
    return Array.from(elements.categoryChecks.querySelectorAll("input:checked"))
      .map(function (input) { return input.value; });
  }

  function handleImageSelection(event) {
    var file = event.target.files && event.target.files[0];
    if (!file || !state.editingId) {
      return;
    }

    var extension = file.name.split(".").pop() || "jpg";
    var title = elements.productTitle.value || file.name;
    var filename = makeId(title) + "-" + Date.now() + "." + extension.toLowerCase();
    var path = IMAGE_DIR + "/" + filename;

    state.pendingImages[state.editingId] = file;
    elements.productImage.value = path;
    updateImagePreview(URL.createObjectURL(file));
    markDirty("Foto escolhida. Clique em Aplicar e depois Salvar no site.");
  }

  function updateImagePreview(path) {
    elements.imagePreview.src = path ? assetUrl(path) : "";
  }

  function deleteCurrentProduct() {
    var product = findProduct(state.editingId);
    if (!product) {
      closeEditor();
      return;
    }

    if (!window.confirm("Excluir esta oferta do catalogo?")) {
      return;
    }

    state.catalog.products = state.catalog.products.filter(function (item) {
      return item.id !== product.id;
    });

    delete state.pendingImages[product.id];
    markDirty("Oferta excluida. Falta salvar no site.");
    closeEditor();
    renderAll();
  }

  function duplicateCurrentProduct() {
    var product = findProduct(state.editingId);
    if (!product) {
      return;
    }

    var copy = normalizeProduct(JSON.parse(JSON.stringify(product)), state.catalog.products.length + 1);
    copy.id = makeId(copy.title) + "-" + Date.now();
    copy.title = copy.title + " copia";
    copy.featured = false;
    copy.sortScore = state.catalog.products.length + 1;
    state.catalog.products.push(copy);
    markDirty("Oferta duplicada. Falta salvar no site.");
    closeEditor();
    renderAll();
  }

  function toggleProductActive(id, active) {
    var product = findProduct(id);
    if (!product) {
      return;
    }

    product.active = Boolean(active);
    markDirty(active ? "Oferta ativada. Falta salvar no site." : "Oferta pausada. Falta salvar no site.");
    renderAll();
  }

  async function saveCatalog() {
    if (!state.catalog) {
      showNotice("O catalogo ainda nao carregou.", "error");
      return;
    }

    if (!currentUser()) {
      showNotice("Entre com o Netlify Identity antes de salvar.", "error");
      if (window.netlifyIdentity) {
        window.netlifyIdentity.open();
      }
      return;
    }

    setBusy("Salvando...");

    try {
      await uploadPendingImages();
      syncLegacyGroups();

      var cleanCatalog = cleanForSave(state.catalog);
      var latest = await gitGetFile(CATALOG_PATH).catch(function () {
        return { sha: state.catalogSha };
      });

      await gitPutFile(CATALOG_PATH, JSON.stringify(cleanCatalog, null, 2) + "\n", latest.sha, "Update BCK catalog from custom admin");
      state.catalogSha = null;
      state.pendingImages = {};
      state.dirty = false;
      await refreshCatalogSha();
      setReady("Salvo no GitHub");
      showNotice("Salvo. O Netlify vai publicar no site em alguns segundos.", "ok");
    } catch (error) {
      console.error(error);
      setReady("Erro ao salvar");
      showNotice(readableError(error), "error");
    }
  }

  async function uploadPendingImages() {
    var entries = Object.entries(state.pendingImages);
    for (var index = 0; index < entries.length; index += 1) {
      var id = entries[index][0];
      var file = entries[index][1];
      var product = findProduct(id);
      if (!product || !file) {
        continue;
      }

      setBusy("Salvando foto " + (index + 1) + " de " + entries.length + "...");
      var content = await fileToBase64(file);
      var existing = await gitGetFile(product.image).catch(function () { return null; });
      await gitPutBase64File(product.image, content, existing && existing.sha, "Upload BCK product image");
    }
  }

  function syncLegacyGroups() {
    var groups = {
      combos: [],
      frango: [],
      pizza: [],
      batata: [],
      carne: [],
      bebidas: [],
      hamburguer: []
    };

    state.catalog.products.forEach(function (product) {
      var cleanProduct = cleanProductForSave(product);
      (product.categories || []).forEach(function (category) {
        var groupKey = category === "porcoes-carne" ? "carne" : category;
        if (groups[groupKey]) {
          groups[groupKey].push(cleanProduct);
        }
      });
    });

    state.catalog.promotionGroups = Object.assign({}, state.catalog.promotionGroups || {}, groups);
  }

  function cleanForSave(catalog) {
    return {
      categories: catalog.categories || [],
      products: (catalog.products || []).map(cleanProductForSave),
      baseProducts: catalog.baseProducts || {},
      promotionGroups: catalog.promotionGroups || {}
    };
  }

  function cleanProductForSave(product) {
    return {
      id: product.id,
      active: product.active !== false,
      featured: Boolean(product.featured),
      combo: Boolean(product.combo),
      categories: Array.isArray(product.categories) ? product.categories : [],
      title: product.title || "",
      description: product.description || "",
      image: product.image || "",
      originalPrice: toNumber(product.originalPrice),
      promoPrice: toNumber(product.promoPrice),
      badge: product.badge || "",
      badgeType: product.badgeType || "hot",
      components: Array.isArray(product.components) ? product.components : [],
      sortScore: toNumber(product.sortScore)
    };
  }

  async function gitGetFile(path) {
    var response = await fetch(GIT_ROOT + "/contents/" + encodePath(path) + "?ref=" + encodeURIComponent(BRANCH), {
      headers: await gitHeaders()
    });

    if (!response.ok) {
      throw new Error("Git Gateway nao encontrou " + path + ".");
    }

    return response.json();
  }

  async function gitPutFile(path, text, sha, message) {
    return gitPutBase64File(path, encodeUtf8ToBase64(text), sha, message);
  }

  async function gitPutBase64File(path, base64, sha, message) {
    var body = {
      message: message || "Update BCK admin content",
      content: base64,
      branch: BRANCH
    };

    if (sha) {
      body.sha = sha;
    }

    var response = await fetch(GIT_ROOT + "/contents/" + encodePath(path), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, await gitHeaders()),
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var text = await response.text();
      throw new Error(text || "Git Gateway recusou o salvamento.");
    }

    return response.json();
  }

  async function gitHeaders() {
    var user = currentUser();
    if (!user) {
      throw new Error("Entre no painel antes de salvar.");
    }

    var token = user.token && user.token.access_token;
    if (typeof user.jwt === "function") {
      token = await user.jwt();
    }

    if (!token) {
      throw new Error("Nao consegui confirmar seu login no Netlify.");
    }

    return {
      Authorization: "Bearer " + token
    };
  }

  function currentUser() {
    return window.netlifyIdentity && window.netlifyIdentity.currentUser();
  }

  function createBlankProduct() {
    var id = "nova-oferta-" + Date.now();
    return normalizeProduct({
      id: id,
      active: true,
      featured: false,
      combo: state.selectedCategory === "combos",
      categories: state.selectedCategory === "todos" ? ["combos"] : [state.selectedCategory],
      title: "Nova oferta",
      description: "Descricao curta da promocao.",
      image: "",
      originalPrice: 0,
      promoPrice: 0,
      badge: "Oferta limitada",
      badgeType: "hot",
      components: [],
      sortScore: state.catalog ? state.catalog.products.length + 1 : 1
    }, state.catalog ? state.catalog.products.length + 1 : 1);
  }

  function findProduct(id) {
    return state.catalog && state.catalog.products.find(function (product) {
      return product.id === id;
    });
  }

  function categoryLabel(id) {
    var category = state.catalog.categories.find(function (item) {
      return item.id === id;
    });
    return category ? category.label : id;
  }

  function makeId(value) {
    return String(value || "item")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 70) || "item";
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") {
      return 0;
    }
    if (typeof value === "number") {
      return Number.isFinite(value) ? value : 0;
    }

    var normalized = String(value).trim().replace(/[^\d,.-]/g, "");
    if (normalized.indexOf(",") >= 0 && normalized.indexOf(".") >= 0) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else if (normalized.indexOf(",") >= 0) {
      normalized = normalized.replace(",", ".");
    }

    var number = Number(normalized);
    return Number.isFinite(number) ? number : 0;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL"
    }).format(toNumber(value));
  }

  function assetUrl(path) {
    if (!path) {
      return "";
    }
    if (/^(https?:|blob:|data:)/.test(path)) {
      return path;
    }
    return "/" + String(path).replace(/^\/+/, "");
  }

  function fileToBase64(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result).split(",")[1]);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function encodeUtf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function encodePath(path) {
    return String(path)
      .split("/")
      .map(encodeURIComponent)
      .join("/");
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value);
  }

  function markDirty(message) {
    state.dirty = true;
    elements.saveLabel.textContent = "Alteracoes nao salvas";
    showNotice(message || "Alteracao feita. Falta salvar no site.", "");
  }

  function setBusy(message) {
    elements.saveLabel.textContent = message;
    elements.saveButton.disabled = true;
  }

  function setReady(message) {
    elements.saveLabel.textContent = message;
    elements.saveButton.disabled = !currentUser();
  }

  function showNotice(message, type) {
    window.clearTimeout(state.lastNoticeTimer);
    elements.notice.hidden = false;
    elements.notice.className = "notice" + (type ? " " + type : "");
    elements.notice.textContent = message;
    state.lastNoticeTimer = window.setTimeout(function () {
      if (!state.dirty && type !== "error") {
        elements.notice.hidden = true;
      }
    }, 6000);
  }

  function readableError(error) {
    var message = error && error.message ? error.message : String(error || "");

    if (message.indexOf("401") >= 0 || message.indexOf("403") >= 0 || message.toLowerCase().indexOf("permission") >= 0) {
      return "Sem permissao para salvar. Confira se seu usuario do Netlify Identity tem acesso ao Git Gateway.";
    }

    if (message.toLowerCase().indexOf("git gateway") >= 0) {
      return "O Git Gateway recusou o salvamento. Tente sair e entrar de novo, ou use o Decap antigo como backup.";
    }

    return message || "Nao consegui salvar agora.";
  }
})();
