(() => {
  "use strict";

  const $ = (selector) => document.querySelector(selector);
  const state = { products: [], category: "All", query: "", view: "discover", sort: "recommended", saved: new Set(), recommendations: [] };
  const categoryColors = ["#31594b", "#44405f", "#66503b", "#345166", "#614452", "#485a3c", "#5d493d"];
  const categoryGlyphs = { Electronics: "⌁", Home: "⌂", Kitchen: "✳", Sports: "↗", Beauty: "✦", Accessories: "◇", Uncategorized: "◈" };
  const stopWords = new Set(["the", "and", "for", "with", "from", "this", "that", "your", "into", "every", "daily", "made", "with"]);
  let toastTimer;

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = !quoted;
      else if (char === "," && !quoted) { row.push(cell); cell = ""; }
      else if ((char === "\n" || char === "\r") && !quoted) {
        if (char === "\r" && text[i + 1] === "\n") i += 1;
        row.push(cell); if (row.some((value) => value.trim())) rows.push(row);
        row = []; cell = "";
      } else cell += char;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    const [headers, ...data] = rows;
    return data.map((values) => Object.fromEntries(headers.map((key, index) => [key.trim(), (values[index] ?? "").trim()])))
      .map((item) => ({ id: item.product_id, name: item.name, category: item.category || "Uncategorized", price: Number(item.price), description: item.description || "" }))
      .filter((item) => item.id && item.name && Number.isFinite(item.price) && item.price >= 0);
  }

  function tokens(product) {
    return new Set(`${product.category} ${product.name} ${product.description}`.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stopWords.has(word)) ?? []);
  }

  function similarity(source, target) {
    const left = tokens(source), right = tokens(target);
    const intersection = [...left].filter((word) => right.has(word)).length;
    const union = new Set([...left, ...right]).size;
    const overlap = union ? intersection / union : 0;
    const sameCategory = source.category === target.category;
    return { score: (sameCategory ? 0.75 : 0) + overlap, sameCategory, shared: intersection };
  }

  function formatPrice(price) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(price); }

  function colorFor(category) {
    let hash = 0;
    for (const char of category) hash = (hash * 31 + char.charCodeAt(0)) | 0;
    return categoryColors[Math.abs(hash) % categoryColors.length];
  }

  function notify(message) {
    const toast = $("#toast");
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("visible"), 1900);
  }

  function getProduct(id) { return state.products.find((product) => product.id === id); }

  function filteredProducts() {
    let products = state.view === "saved" ? state.products.filter((product) => state.saved.has(product.id)) : [...state.products];
    if (state.category !== "All") products = products.filter((product) => product.category === state.category);
    const query = state.query.trim().toLowerCase();
    if (query) products = products.filter((product) => `${product.name} ${product.category} ${product.description}`.toLowerCase().includes(query));
    if (state.sort === "price-low") products.sort((a, b) => a.price - b.price);
    else if (state.sort === "price-high") products.sort((a, b) => b.price - a.price);
    else if (state.sort === "name") products.sort((a, b) => a.name.localeCompare(b.name));
    return products;
  }

  function cardMarkup(product, mode = "browse", rank = null) {
    const saved = state.saved.has(product.id);
    const label = mode === "recommendation" && rank
      ? (rank.sameCategory ? "SAME CATEGORY" : rank.shared ? "DETAIL MATCH" : "DISCOVERY PICK")
      : (categoryGlyphs[product.category] || "✦");
    return `<article class="product-card">
      <div class="product-visual" style="--card-bg:linear-gradient(135deg,${colorFor(product.category)},#1d2228)">
        <span class="visual-label">${escapeHtml(label)}</span>
        <span class="product-glyph" aria-hidden="true">${escapeHtml(categoryGlyphs[product.category] || "✦")}</span>
        <button class="favorite-button ${saved ? "saved" : ""}" data-action="favorite" data-id="${escapeHtml(product.id)}" aria-label="${saved ? "Remove from" : "Save to"} saved products" aria-pressed="${saved}">${saved ? "♥" : "♡"}</button>
      </div>
      <div class="product-info">
        <div class="product-meta"><span class="category-tag">${escapeHtml(product.category)}</span><span class="product-price">${formatPrice(product.price)}</span></div>
        <h3 class="product-name" title="${escapeHtml(product.name)}">${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(product.description)}</p>
        <div class="product-actions"><button class="card-action primary" data-action="similar" data-id="${escapeHtml(product.id)}">Find similar</button><button class="card-action" data-action="details" data-id="${escapeHtml(product.id)}">Details</button></div>
      </div>
    </article>`;
  }

  function renderCategories() {
    const categories = ["All", ...new Set(state.products.map((product) => product.category))];
    $("#category-nav").innerHTML = categories.map((category) => `<button class="category-link ${state.category === category ? "active" : ""}" data-category="${escapeHtml(category)}">${category === "All" ? "✧ &nbsp; All products" : escapeHtml(category)}</button>`).join("");
    const countByCategory = state.products.reduce((counts, product) => { counts[product.category] = (counts[product.category] || 0) + 1; return counts; }, {});
    $("#popular-categories").innerHTML = Object.entries(countByCategory).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category]) => `<button class="popular-category" data-category="${escapeHtml(category)}">${escapeHtml(category)}</button>`).join("");
    $("#category-chart").innerHTML = Object.entries(countByCategory).sort((a, b) => b[1] - a[1]).map(([category, count]) => `<div class="category-stat"><div class="category-stat-top"><button data-category="${escapeHtml(category)}">${escapeHtml(category)}</button><b>${count} ${count === 1 ? "product" : "products"}</b></div><div class="bar-track"><div class="bar-fill" style="width:${Math.max(8, count / state.products.length * 100)}%"></div></div></div>`).join("");
  }

  function renderSelector() {
    const select = $("#product-select");
    const current = select.value || state.products[0]?.id;
    select.innerHTML = state.products.map((product) => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${formatPrice(product.price)}</option>`).join("");
    if (getProduct(current)) select.value = current;
    renderPreview();
  }

  function renderPreview() {
    const product = getProduct($("#product-select").value);
    if (!product) return;
    $("#selected-preview").innerHTML = `<div class="preview-row"><span class="preview-category">${escapeHtml(product.category)}</span><span class="preview-price">${formatPrice(product.price)}</span></div><h4>${escapeHtml(product.name)}</h4><p>${escapeHtml(product.description)}</p>`;
  }

  function renderProducts() {
    const products = filteredProducts();
    $("#product-grid").innerHTML = products.map((product) => cardMarkup(product)).join("");
    $("#empty-state").hidden = products.length > 0;
    $("#product-grid").hidden = products.length === 0;
    $("#result-count").textContent = `${products.length} ${products.length === 1 ? "product" : "products"}`;
    const filters = [];
    if (state.view === "saved") filters.push(`<span class="filter-chip">♥ Saved picks</span>`);
    if (state.category !== "All") filters.push(`<span class="filter-chip">${escapeHtml(state.category)}</span>`);
    if (state.query.trim()) filters.push(`<span class="filter-chip">Search: “${escapeHtml(state.query.trim())}”</span>`);
    if (filters.length) filters.push(`<button class="filter-chip clear" data-action="clear">Clear all ×</button>`);
    $("#active-filter").innerHTML = filters.join("");
    $("#collection-title").textContent = state.view === "saved" ? "Your saved products." : (state.category === "All" ? "Find your next favorite." : `${state.category}, thoughtfully picked.`);
    $("#collection-subtitle").textContent = state.view === "saved" ? "Your personal shortlist, all in one place." : "Browse the collection or let us find a closer match.";
    $("#current-view-label").textContent = state.view === "saved" ? "SAVED PRODUCTS" : state.category.toUpperCase();
    document.querySelectorAll(".nav-link").forEach((button) => button.classList.toggle("active", button.dataset.view === state.view));
    renderCategories();
    updateSavedCount();
  }

  function updateSavedCount() {
    $("#saved-count").textContent = state.saved.size;
    $("#metric-saved").textContent = `${state.saved.size} ${state.saved.size === 1 ? "product" : "products"}`;
  }

  function showRecommendations(product) {
    const seen = new Set([product.id]);
    const matches = state.products.map((candidate) => ({ product: candidate, ...similarity(product, candidate) }))
      .filter((match) => !seen.has(match.product.id) && !seen.has(match.product.name.toLowerCase()))
      .sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name));
    const unique = [];
    const names = new Set();
    for (const match of matches) {
      const key = match.product.name.toLowerCase();
      if (!names.has(key)) { names.add(key); unique.push(match); }
      if (unique.length === 6) break;
    }
    state.recommendations = unique;
    $("#recommendation-caption").textContent = `Starting with ${product.name} · ${product.category}`;
    $("#recommendation-grid").innerHTML = unique.map((match, index) => cardMarkup(match.product, "recommendation", { ...match, score: match.score })).join("");
    $("#recommendations-section").hidden = false;
    $("#recommendations-section").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function toggleSaved(id) {
    const product = getProduct(id);
    if (!product) return;
    if (state.saved.has(id)) { state.saved.delete(id); notify(`${product.name} removed from saved products`); }
    else { state.saved.add(id); notify(`${product.name} added to saved products`); }
    try { localStorage.setItem("shopsmart-saved-v1", JSON.stringify([...state.saved])); } catch { /* Favorites still work for this session. */ }
    renderProducts();
    if (!$("#recommendations-section").hidden && state.recommendations.length) {
      $("#recommendation-grid").innerHTML = state.recommendations.map((match) => cardMarkup(match.product, "recommendation", match)).join("");
    }
  }

  function showDetails(id) {
    const product = getProduct(id);
    if (product) notify(`${product.name} · ${product.category} · ${formatPrice(product.price)}`);
  }

  function clearFilters() {
    state.view = "discover"; state.category = "All"; state.query = "";
    $("#search-input").value = "";
    renderProducts();
  }

  function bindEvents() {
    $("#category-nav").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (!button) return;
      state.category = button.dataset.category;
      state.view = "discover";
      renderProducts();
      $("#discover").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("#popular-categories").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (button) { state.category = button.dataset.category; state.view = "discover"; renderProducts(); }
    });
    $("#category-chart").addEventListener("click", (event) => {
      const button = event.target.closest("[data-category]");
      if (button) { state.category = button.dataset.category; state.view = "discover"; renderProducts(); $("#discover").scrollIntoView({ behavior: "smooth" }); }
    });
    $("#product-grid").addEventListener("click", (event) => handleCardClick(event));
    $("#recommendation-grid").addEventListener("click", (event) => handleCardClick(event));
    $("#search-input").addEventListener("input", (event) => { state.query = event.target.value; state.view = "discover"; renderProducts(); });
    $("#sort-select").addEventListener("change", (event) => { state.sort = event.target.value; renderProducts(); });
    $("#product-select").addEventListener("change", renderPreview);
    $("#recommend-button").addEventListener("click", () => { const product = getProduct($("#product-select").value); if (product) showRecommendations(product); });
    $("#close-recommendations").addEventListener("click", () => { $("#recommendations-section").hidden = true; });
    $("#clear-filters").addEventListener("click", clearFilters);
    $("#active-filter").addEventListener("click", (event) => { if (event.target.closest('[data-action="clear"]')) clearFilters(); });
    document.querySelectorAll(".nav-link").forEach((button) => button.addEventListener("click", () => {
      state.view = button.dataset.view; state.category = "All"; state.query = ""; $("#search-input").value = ""; renderProducts();
      $("#discover").scrollIntoView({ behavior: "smooth", block: "start" });
    }));
    document.addEventListener("keydown", (event) => {
      if (event.key === "/" && !["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName)) { event.preventDefault(); $("#search-input").focus(); }
      if (event.key === "Escape") $("#recommendations-section").hidden = true;
    });
  }

  function handleCardClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const { action, id } = button.dataset;
    if (action === "favorite") toggleSaved(id);
    if (action === "similar") { const product = getProduct(id); if (product) { $("#product-select").value = product.id; renderPreview(); showRecommendations(product); } }
    if (action === "details") showDetails(id);
    if (action === "clear") clearFilters();
  }

  async function init() {
    try {
      if (location.protocol === "file:" && Array.isArray(window.SHOPSMART_CATALOG)) {
        state.products = window.SHOPSMART_CATALOG;
      } else {
        const response = await fetch("./data/products.csv", { cache: "no-cache" });
        if (!response.ok) throw new Error(`Catalog request failed (${response.status})`);
        state.products = parseCsv(await response.text());
      }
      if (!state.products.length) throw new Error("The catalog has no valid products.");
      try {
        const stored = JSON.parse(localStorage.getItem("shopsmart-saved-v1") || "[]");
        state.saved = new Set(stored.filter((id) => state.products.some((product) => product.id === id)));
      } catch { state.saved = new Set(); }
      $("#metric-products").textContent = String(state.products.length).padStart(2, "0");
      $("#metric-categories").textContent = String(new Set(state.products.map((product) => product.category)).size).padStart(2, "0");
      bindEvents();
      renderSelector();
      renderProducts();
    } catch (error) {
      console.error("ShopSmart could not load the product catalog:", error);
      $("#product-grid").innerHTML = `<div class="empty-state"><span>!</span><h3>Catalog unavailable</h3><p>${escapeHtml(error.message)} Check that <code>data/products.csv</code> is included in the deployment.</p></div>`;
      $("#product-grid").hidden = false;
    }
  }

  init();
})();
