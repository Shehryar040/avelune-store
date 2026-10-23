// Admin dashboard state, DOM shortcuts, currency formatting, and safe text helpers.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { username: "", products: [], branches: [], orders: [], settings: {}, images: [] };
const money = (value) => `PKR ${Number(value || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const categoryName = (category) => ({ men: "Men", women: "Women", children: "Children" }[category] || category);

// Send authenticated admin requests and surface connectivity or authorization failures.
async function api(url, options = {}) {
    if (window.location.protocol === "file:") {
        throw new Error('The admin page must be opened through the store server. Run "npm start" in the project folder, then open http://localhost:3000/admin.');
    }
    let response;
    try {
        response = await fetch(url, {
            credentials: "same-origin",
            ...options,
            headers: { "Content-Type": "application/json", ...options.headers }
        });
    } catch {
        throw new Error('The store server could not be reached. Run "npm start" in the project folder, then reload the admin page.');
    }
    let result = null;
    if (response.status !== 204) {
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("application/json")) {
            const error = new Error(response.status === 404
                ? 'The store server does not recognize this admin request. Restart it with "npm start", then reload the admin page.'
                : "The admin server returned a web page instead of API data. Open the admin through the running store server.");
            error.status = response.status;
            throw error;
        }
        try {
            result = await response.json();
        } catch {
            throw new Error("The admin server returned an invalid API response. Restart it with \"npm start\", then reload the admin page.");
        }
    }
    if (!response.ok) {
        if (response.status === 401) showLogin();
        const error = new Error(result?.error || "The request could not be completed.");
        error.status = response.status;
        throw error;
    }
    return result;
}

// Switch between sign-in and dashboard views and display request errors to the admin.
function showLogin(message = "") {
    $("#admin-app").hidden = true;
    $("#login-shell").hidden = false;
    $("#login-message").textContent = message;
}

function showDashboard(username) {
    state.username = username;
    $("#login-shell").hidden = true;
    $("#admin-app").hidden = false;
    $("#admin-username").textContent = username;
    refreshData().catch(showError);
}

function showError(error) {
    console.error(error);
    window.alert(error.message || "Something went wrong. Please try again.");
}

// Load dashboard records together and refresh the rendered admin panels.
async function refreshData() {
    const [products, branches, orders, settings] = await Promise.all([
        api("/api/admin/products"),
        api("/api/admin/branches"),
        api("/api/admin/orders"),
        api("/api/settings")
    ]);
    state.products = products;
    state.branches = branches;
    state.orders = orders;
    state.settings = settings;
    renderAll();
}

function renderAll() {
    renderOverview();
    renderProducts();
    renderSales();
    renderBranches();
    renderOrders();
    renderSettings();
}

// Render overview counts, recent orders, searchable tables, and sales previews.
function renderOverview() {
    const pending = state.orders.filter((order) => order.status === "pending").length;
    const today = new Date().toISOString().slice(0, 10);
    $("#stat-products").textContent = state.products.filter((product) => product.active).length;
    $("#stat-pending").textContent = pending;
    $("#stat-today").textContent = state.orders.filter((order) => order.created_at.startsWith(today)).length;
    $("#stat-branches").textContent = state.branches.filter((branch) => branch.active).length;
    $("#pending-count").textContent = pending;
    const recent = state.orders.slice(0, 5);
    $("#recent-orders").innerHTML = recent.length ? recent.map((order) => `
        <tr>
            <td><strong>#${order.id}</strong></td>
            <td>${escapeHtml(order.customer_name)}</td>
            <td>${escapeHtml(new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleDateString())}</td>
            <td>${money(order.total)}</td>
            <td><span class="badge ${escapeHtml(order.status)}">${escapeHtml(order.status)}</span></td>
        </tr>`).join("") : `<tr><td colspan="5" class="empty-state">Your first order will appear here.</td></tr>`;
}

function renderProducts() {
    const query = $("#product-search").value.trim().toLowerCase();
    const category = $("#product-filter").value;
    const products = state.products.filter((product) =>
        (category === "all" || product.category === category) &&
        `${product.name} ${product.description}`.toLowerCase().includes(query)
    );
    $("#products-empty").hidden = products.length > 0;
    $("#products-table").innerHTML = products.map((product) => `
        <tr>
            <td><div class="product-cell"><img src="${escapeHtml(product.image)}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(product.description)}</small></span></div></td>
            <td>${escapeHtml(categoryName(product.category))}</td>
            <td><strong>${money(product.price)}</strong>${product.originalPrice > product.price ? `<br><small class="muted"><s>${money(product.originalPrice)}</s></small>${product.salePercent ? `<br><small class="sale-percent-label">${product.salePercent}% off</small>` : ""}` : ""}</td>
            <td>${product.stock === 0 ? `<span class="badge cancelled">Out of stock</span>` : product.stock <= 3 ? `<span class="badge pending">${product.stock} left</span>` : product.stock}</td>
            <td>${product.featured ? `<span class="badge active">Featured</span>` : `<span class="muted">—</span>`}</td>
            <td><span class="badge ${product.active ? "active" : "inactive"}">${product.active ? "Active" : "Archived"}</span></td>
            <td><div class="row-actions"><button class="icon-button" data-edit-product="${product.id}" title="Edit product" aria-label="Edit ${escapeHtml(product.name)}">✎</button>${product.active ? `<button class="icon-button delete" data-delete-product="${product.id}" title="Archive product" aria-label="Archive ${escapeHtml(product.name)}">×</button>` : ""}</div></td>
        </tr>`).join("");
}

function renderSales() {
    const activeProducts = state.products.filter((product) => product.active);
    const selectedId = $("#sale-product").value;
    $("#sale-product").innerHTML = activeProducts.map((product) =>
        `<option value="${product.id}">${escapeHtml(product.name)} — ${money(product.price)}</option>`
    ).join("");
    if (activeProducts.some((product) => String(product.id) === selectedId)) {
        $("#sale-product").value = selectedId;
    }
    const sales = activeProducts.filter((product) => product.salePercent > 0);
    $("#sales-empty").hidden = sales.length > 0;
    $("#sales-table").innerHTML = sales.map((product) => `
        <tr>
            <td><div class="product-cell"><img src="${escapeHtml(product.image)}" alt=""><span><strong>${escapeHtml(product.name)}</strong><small>${escapeHtml(categoryName(product.category))}</small></span></div></td>
            <td><span class="badge sale-badge">${product.salePercent}% off</span></td>
            <td><s class="muted">${money(product.originalPrice)}</s></td>
            <td><strong>${money(product.price)}</strong></td>
            <td><button class="button secondary" type="button" data-remove-sale="${product.id}">End sale</button></td>
        </tr>`).join("");
    updateSalePreview();
}

function updateSalePreview() {
    const product = state.products.find((item) => item.id === Number($("#sale-product").value));
    const percent = Number($("#sale-percent").value);
    const preview = $("#sale-preview");
    if (!product || !Number.isInteger(percent) || percent < 1 || percent > 99) {
        preview.textContent = "Choose a product and enter a whole-number discount from 1% to 99%.";
        return;
    }
    const salePrice = Math.round(product.originalPrice * (100 - percent)) / 100;
    preview.textContent = salePrice < product.originalPrice
        ? `${money(product.originalPrice)} regular price − ${percent}% = ${money(salePrice)} sale price`
        : "This discount is too small to change the product's price.";
}

// Render branch cards, customer orders, and editable store-contact settings.
function renderBranches() {
    $("#branches-list").innerHTML = state.branches.length ? state.branches.map((branch) => `
        <article class="branch-card">
            <div class="branch-card-header"><h3>${escapeHtml(branch.name)}</h3><span class="badge ${branch.active ? "active" : "inactive"}">${branch.active ? "Shown to customers" : "Hidden from customers"}</span></div>
            <p>${escapeHtml(branch.address)}</p><p>${escapeHtml(branch.phone || "No phone added")}</p><p>${escapeHtml(branch.hours || "Hours not set")}</p>
            <div class="branch-card-actions"><button class="branch-visibility-toggle ${branch.active ? "is-visible" : ""}" data-toggle-branch-visibility="${branch.id}" role="switch" aria-checked="${Boolean(branch.active)}" aria-label="${branch.active ? "Hide" : "Show"} ${escapeHtml(branch.name)} to customers"><span class="visibility-switch-track" aria-hidden="true"><span></span></span><span>${branch.active ? "On" : "Off"}</span></button><button class="button secondary" data-edit-branch="${branch.id}">Edit branch</button>${branch.active ? `<button class="button danger" data-delete-branch="${branch.id}">Archive</button>` : ""}<button class="button danger" data-permanently-delete-branch="${branch.id}">Delete permanently</button></div>
        </article>`).join("") : `<p class="empty-state">Add your first branch to show it on the storefront.</p>`;
}

function renderOrders() {
    const query = $("#order-search").value.trim().toLowerCase();
    const status = $("#order-filter").value;
    const orders = state.orders.filter((order) =>
        (status === "all" || order.status === status) &&
        `${order.id} ${order.customer_name} ${order.customer_email} ${order.phone} ${order.address}`.toLowerCase().includes(query)
    );
    $("#orders-empty").hidden = orders.length > 0;
    $("#orders-table").innerHTML = orders.map((order) => `
        <tr>
            <td><button class="text-button" data-view-order="${order.id}">#${order.id}</button></td>
            <td><strong>${escapeHtml(order.customer_name)}</strong><br><small>${escapeHtml(order.customer_email || "No email")}</small><br><small>${escapeHtml(order.phone)}</small><br><small>${escapeHtml(order.address)}</small></td>
            <td>${order.items.reduce((count, item) => count + item.quantity, 0)} item${order.items.length === 1 ? "" : "s"}${order.items.some((item) => item.itemMessage) ? `<br><small class="item-message-flag">✉ Item message</small>` : ""}</td>
            <td><strong>${money(order.total)}</strong></td>
            <td>${escapeHtml(new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleString())}</td>
            <td><select aria-label="Status for order ${order.id}" data-order-status="${order.id}" ${order.status === "cancelled" ? "disabled" : ""}>
                ${["pending", "confirmed", "shipped", "delivered", "cancelled"].map((value) => `<option value="${value}" ${order.status === value ? "selected" : ""}>${value[0].toUpperCase()}${value.slice(1)}</option>`).join("")}
            </select></td>
        </tr>`).join("");
}

function renderSettings() {
    const form = $("#settings-form");
    for (const [key, value] of Object.entries(state.settings)) {
        if (form.elements[key]) form.elements[key].value = value || "";
    }
}

// Change the visible dashboard section and update its selected navigation item.
function selectView(name) {
    $$(".nav-item[data-view]").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    $("#view-title").textContent = ({ overview: "Overview", products: "Products", sales: "Sales", branches: "Branches", orders: "Orders", store: "Store details", account: "Account security" })[name];
    document.body.classList.remove("menu-open");
}

// Load the image library and preview the image selected for a product.
async function loadImages() {
    state.images = await api("/api/admin/images/library");
    $("#image-select").innerHTML = `<option value="">Choose an image</option>` +
        state.images.map((image) => `<option value="${escapeHtml(image)}">${escapeHtml(image.split("/").pop())}</option>`).join("");
}

function showImagePreview(src, label = "") {
    const preview = $("#product-image-preview");
    preview.replaceChildren();
    if (!src) {
        const placeholder = document.createElement("span");
        placeholder.textContent = "Select an image to preview it here";
        preview.append(placeholder);
        return;
    }
    const image = document.createElement("img");
    image.src = src;
    image.alt = label ? `Preview of ${label}` : "Selected product image preview";
    preview.append(image);
}

// Populate product, branch, and order dialogs with the selected record's values.
function setForm(form, values) {
    form.reset();
    for (const [key, value] of Object.entries(values)) {
        const element = form.elements[key];
        if (!element) continue;
        if (element.type === "checkbox") element.checked = Boolean(value);
        else element.value = value ?? "";
    }
}

// Open product and branch forms, or show full customer and item details for an order.
function openProduct(product = null) {
    const form = $("#product-form");
    const imageSelect = $("#image-select");
    const currentImage = product?.image || "";
    if (currentImage && ![...imageSelect.options].some((option) => option.value === currentImage)) {
        const option = document.createElement("option");
        option.value = currentImage;
        option.textContent = currentImage.split("/").pop();
        imageSelect.append(option);
    }
    $("#image-upload").value = "";
    $("#image-upload-title").textContent = product ? "Change product image" : "Upload a product image";
    $("#image-upload-status").textContent = product
        ? "Current image will be kept unless you choose a replacement."
        : "Your image will upload securely when selected.";
    setForm(form, product ? {
        id: product.id,
        name: product.name,
        description: product.description,
        category: product.category,
        image: product.image,
        price: product.price,
        originalPrice: product.originalPrice,
        stock: product.stock,
        featured: product.featured,
        active: product.active
    } : { category: "men", price: 0, originalPrice: 0, stock: 10, active: true });
    showImagePreview(product?.image || "");
    $("#product-dialog-title").textContent = product ? "Edit product" : "Add product";
    $("#product-message").textContent = "";
    $("#product-dialog").showModal();
}

function openBranch(branch = null) {
    setForm($("#branch-form"), branch || { active: true });
    $("#branch-dialog-title").textContent = branch ? "Edit branch" : "Add branch";
    $("#branch-message").textContent = "";
    $("#branch-dialog").showModal();
}

function openOrder(order) {
    $("#order-dialog-title").textContent = `Order #${order.id}`;
    $("#order-detail").innerHTML = `
        <div class="order-meta">
            <div><small>Customer</small><strong>${escapeHtml(order.customer_name)}</strong></div>
            <div><small>Email</small><strong>${escapeHtml(order.customer_email || "Not provided")}</strong></div>
            <div><small>Phone</small><strong>${escapeHtml(order.phone)}</strong></div>
            <div><small>Delivery address</small><strong>${escapeHtml(order.address)}</strong></div>
            <div><small>Payment</small><strong>Cash on delivery</strong></div>
        </div>
        ${order.note ? `<p class="muted">${escapeHtml(order.note)}</p>` : ""}
        <div class="order-lines">${order.items.map((item) => `<div class="order-item"><div class="order-line"><span>${escapeHtml(item.productName)} × ${item.quantity}</span><strong>${money(item.unitPrice * item.quantity)}</strong></div>${item.itemMessage ? `<p class="order-item-message"><strong>Customer message:</strong> ${escapeHtml(item.itemMessage).replace(/\n/g, "<br>")}</p>` : ""}</div>`).join("")}<div class="order-line"><strong>Total</strong><strong>${money(order.total)}</strong></div></div>
        <p class="muted">Placed ${escapeHtml(new Date(`${order.created_at.replace(" ", "T")}Z`).toLocaleString())}</p>`;
    $("#order-dialog").showModal();
}

// Save product and branch forms, upload product images, and update store settings.
async function saveProduct(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#product-message");
    const values = Object.fromEntries(new FormData(form));
    values.price = Number(values.price);
    values.originalPrice = Number(values.originalPrice);
    values.stock = Number(values.stock);
    values.featured = form.elements.featured.checked;
    values.active = form.elements.active.checked;
    const id = values.id;
    delete values.id;
    message.textContent = "Saving…";
    try {
        await api(id ? `/api/admin/products/${id}` : "/api/admin/products", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(values)
        });
        $("#product-dialog").close();
        await refreshData();
    } catch (error) {
        message.textContent = error.message;
    }
}

async function saveBranch(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#branch-message");
    const values = Object.fromEntries(new FormData(form));
    values.active = form.elements.active.checked;
    const id = values.id;
    delete values.id;
    message.textContent = "Saving…";
    try {
        await api(id ? `/api/admin/branches/${id}` : "/api/admin/branches", {
            method: id ? "PUT" : "POST",
            body: JSON.stringify(values)
        });
        $("#branch-dialog").close();
        await refreshData();
    } catch (error) {
        message.textContent = error.message;
    }
}

async function uploadImage(event) {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const currentImage = $("#image-select").value;
    $("#product-message").textContent = "";
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        $("#product-message").textContent = "Choose a JPG, PNG, or WebP image.";
        $("#image-upload-status").textContent = "Unsupported file type.";
        input.value = "";
        return;
    }
    if (file.size > 3 * 1024 * 1024) {
        $("#product-message").textContent = "Images must be smaller than 3 MB.";
        $("#image-upload-status").textContent = "The selected image is larger than 3 MB.";
        input.value = "";
        return;
    }
    $("#image-upload-status").textContent = `Uploading ${file.name}…`;
    try {
        const imageData = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("The selected image could not be read."));
            reader.readAsDataURL(file);
        });
        showImagePreview(imageData, file.name);
        const result = await api("/api/admin/images", { method: "POST", body: JSON.stringify({ imageData }) });
        state.images.push(result.image);
        $("#image-select").insertAdjacentHTML("beforeend", `<option value="${escapeHtml(result.image)}">${escapeHtml(file.name)}</option>`);
        $("#image-select").value = result.image;
        showImagePreview(result.image, file.name);
        $("#image-upload-status").textContent = `${file.name} uploaded and selected.`;
    } catch (error) {
        $("#product-message").textContent = error.message;
        $("#image-upload-status").textContent = currentImage
            ? "Upload failed. The current image selection has been kept."
            : "Upload failed. Choose another image and try again.";
        $("#image-select").value = currentImage;
        input.value = "";
        showImagePreview(currentImage, $("#image-select").selectedOptions[0]?.textContent || "");
    }
}

async function saveSettings(event) {
    event.preventDefault();
    const message = $("#settings-message");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    message.textContent = "Saving…";
    try {
        await api("/api/admin/settings", { method: "PUT", body: JSON.stringify(values) });
        message.textContent = "Store details saved.";
        await refreshData();
    } catch (error) {
        message.textContent = error.message;
    }
}

// Delegate dashboard actions including navigation, editing, archiving, and sign-out.
document.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    try {
        if (target.dataset.view) selectView(target.dataset.view);
        if (target.dataset.go) selectView(target.dataset.go);
        if (target.id === "menu-toggle") document.body.classList.toggle("menu-open");
        if (target.id === "add-product") { await loadImages(); openProduct(); }
        if (target.id === "add-branch") openBranch();
        if (target.dataset.removeSale) {
            await api(`/api/admin/products/${target.dataset.removeSale}/sale`, {
                method: "PUT",
                body: JSON.stringify({ percent: 0 })
            });
            await refreshData();
        }
        if (target.dataset.editProduct) {
            await loadImages();
            openProduct(state.products.find((item) => item.id === Number(target.dataset.editProduct)));
        }
        if (target.dataset.editBranch) openBranch(state.branches.find((item) => item.id === Number(target.dataset.editBranch)));
        if (target.dataset.toggleBranchVisibility) {
            const branch = state.branches.find((item) => item.id === Number(target.dataset.toggleBranchVisibility));
            if (!branch) throw new Error("That branch could not be found. Refresh the admin page and try again.");
            target.disabled = true;
            await api(`/api/admin/branches/${branch.id}`, {
                method: "PUT",
                body: JSON.stringify({
                    name: branch.name,
                    address: branch.address,
                    phone: branch.phone || "",
                    hours: branch.hours || "",
                    mapUrl: branch.mapUrl || "",
                    active: !branch.active
                })
            });
            await refreshData();
        }
        if (target.dataset.deleteProduct && window.confirm("Archive this product? It will disappear from the storefront, but existing order records will be kept.")) {
            await api(`/api/admin/products/${target.dataset.deleteProduct}`, { method: "DELETE" });
            await refreshData();
        }
        if (target.dataset.deleteBranch && window.confirm("Archive this branch? It will no longer be shown to customers.")) {
            await api(`/api/admin/branches/${target.dataset.deleteBranch}`, { method: "DELETE" });
            await refreshData();
        }
        if (target.dataset.permanentlyDeleteBranch) {
            const branch = state.branches.find((item) => item.id === Number(target.dataset.permanentlyDeleteBranch));
            if (!branch) throw new Error("That branch could not be found. Refresh the admin page and try again.");
            if (window.confirm(`Permanently delete "${branch.name}"? This cannot be undone.`)) {
                try {
                    await api(`/api/admin/branches/${branch.id}/permanent`, { method: "DELETE" });
                } catch (error) {
                    if (error.status !== 404) throw error;
                    await api(`/api/admin/branches/${branch.id}`, { method: "DELETE" });
                    window.alert(`"${branch.name}" is now hidden from customers. The running server only supports archiving; restart it with "npm start" before using permanent deletion.`);
                }
                await refreshData();
            }
        }
        if (target.dataset.viewOrder) {
            const order = state.orders.find((item) => item.id === Number(target.dataset.viewOrder));
            if (order) openOrder(order);
        }
        if (target.dataset.close) $(`#${target.dataset.close}`).close();
        if (target.id === "logout-button") {
            await api("/api/admin/logout", { method: "POST", body: "{}" });
            showLogin();
        }
    } catch (error) {
        showError(error);
    }
});

// Handle order-status changes, product image previews, and image uploads.
document.addEventListener("change", async (event) => {
    if (event.target.matches("[data-order-status]")) {
        const orderId = event.target.dataset.orderStatus;
        try {
            await api(`/api/admin/orders/${orderId}/status`, {
                method: "PUT",
                body: JSON.stringify({ status: event.target.value })
            });
            await refreshData();
        } catch (error) {
            showError(error);
            await refreshData();
        }
    }
    if (event.target.id === "image-select") {
        showImagePreview(event.target.value, event.target.selectedOptions[0]?.textContent || "");
        $("#image-upload-status").textContent = event.target.value
            ? "Selected image will replace the current product image when saved."
            : "Your image will upload securely when selected.";
    }
    if (event.target.id === "image-upload") uploadImage(event).catch((error) => {
        $("#image-upload-status").textContent = "The image could not be read.";
        showError(error);
    });
});

// Handle admin sign-in, password visibility controls, and account-security updates.
$("#login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#login-message");
    message.textContent = "Signing in…";
    try {
        const result = await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        form.reset();
        message.textContent = "";
        showDashboard(result.username);
    } catch (error) {
        message.textContent = error.message;
    }
});

$("#password-toggle").addEventListener("click", (event) => {
    const button = event.currentTarget;
    const password = $("#admin-password");
    const isVisible = password.type === "password";
    password.type = isVisible ? "text" : "password";
    button.setAttribute("aria-pressed", String(isVisible));
    button.setAttribute("aria-label", isVisible ? "Hide password" : "Show password");
});

document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-password-target]");
    if (!button) return;
    const password = $(`[name="${button.dataset.passwordTarget}"]`);
    const isVisible = password.type === "password";
    password.type = isVisible ? "text" : "password";
    button.setAttribute("aria-pressed", String(isVisible));
    button.setAttribute("aria-label", isVisible ? "Hide password" : `Show ${button.dataset.passwordTarget.replace(/([A-Z])/g, " $1").toLowerCase()}`);
});

$("#account-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = $("#account-message");
    const values = Object.fromEntries(new FormData(form));
    message.textContent = "Updating account…";
    try {
        const result = await api("/api/admin/account", {
            method: "PUT",
            body: JSON.stringify(values)
        });
        state.username = result.username;
        $("#admin-username").textContent = result.username;
        form.reset();
        message.textContent = "Admin account updated. Other active sessions have been signed out.";
    } catch (error) {
        message.textContent = error.message;
    }
});

// Connect admin forms and search/filter inputs to their save, preview, and render actions.
$("#product-form").addEventListener("submit", saveProduct);
$("#branch-form").addEventListener("submit", saveBranch);
$("#settings-form").addEventListener("submit", saveSettings);
$("#sale-product").addEventListener("change", updateSalePreview);
$("#sale-percent").addEventListener("input", updateSalePreview);
$("#sale-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = $("#sale-message");
    const productId = Number($("#sale-product").value);
    const percent = Number($("#sale-percent").value);
    message.textContent = "Applying sale…";
    try {
        await api(`/api/admin/products/${productId}/sale`, {
            method: "PUT",
            body: JSON.stringify({ percent })
        });
        message.textContent = "Sale applied.";
        await refreshData();
    } catch (error) {
        message.textContent = error.message;
    }
});
$("#product-search").addEventListener("input", renderProducts);
$("#product-filter").addEventListener("change", renderProducts);
$("#order-search").addEventListener("input", renderOrders);
$("#order-filter").addEventListener("change", renderOrders);

// Revoke any previous browser session on entry, then require fresh credentials.
if (window.location.protocol === "file:") {
    showLogin('Open the admin through the store server, not as a local file. Run "npm start" in the project folder, then visit http://localhost:3000/admin.');
} else {
    showLogin();
    api("/api/admin/me")
        .then(() => api("/api/admin/logout", { method: "POST", body: "{}" }))
        .then(() => showLogin())
        .catch((error) => {
            if (error.status === 401) {
                showLogin();
                return;
            }
            showLogin(error.message);
        });
    window.addEventListener("pageshow", (event) => {
        if (event.persisted) window.location.reload();
    });
}
