// Collection grid setup, currency formatting, and shared cart restoration.
const grid = document.querySelector("#product-grid");
const currency = (amount) => `PKR ${Number(amount).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;
let products = [];
let cart = [];
try {
    cart = window.AveluneCart.load();
} catch (error) {
    console.error("The saved shopping bag could not be restored.", error);
    localStorage.removeItem("avelune-cart");
    localStorage.removeItem("nonline-cart");
}
let selectedCategory = new URLSearchParams(location.search).get("category") || "all";

// Escape product-provided text and send JSON requests with explicit error handling.
function safeText(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
}

async function request(url, options = {}) {
    const response = await fetch(url, {
        ...options,
        headers: { "Content-Type": "application/json", ...options.headers }
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
}

// Render the products matching the selected audience or sale filter.
function renderProducts() {
    const visible = products.filter((product) =>
        selectedCategory === "all" ||
        (selectedCategory === "sale" && product.salePercent > 0) ||
        product.category === selectedCategory
    );
    grid.innerHTML = visible.length ? visible.map((product) => `
        <article class="product-card">
            <a class="product-image" href="product.html?id=${product.id}" data-customize aria-label="Customize ${safeText(product.name)}"><img src="${safeText(product.image)}" alt="${safeText(product.name)}" loading="lazy">
                ${product.originalPrice > product.price ? `<span class="sale-label">${product.salePercent ? `${product.salePercent}% off` : "Special price"}</span>` : ""}
            </a>
            <div class="product-info">
                <p class="product-category">${({ children: "Kids' clothing", women: "Women's clothing", men: "Men's clothing" })[product.category] || "Custom clothing"} · Heat-press ready</p>
                <h3>${safeText(product.name)}</h3>
                <p class="product-description">${safeText(product.description)}</p>
                <div class="product-bottom"><span class="product-price">${currency(product.price)} ${product.originalPrice > product.price ? `<del>${currency(product.originalPrice)}</del>` : ""}</span>
                <a class="add-to-bag" href="product.html?id=${product.id}" data-customize ${product.stock < 1 ? 'aria-disabled="true"' : ""}>${product.stock < 1 ? "Sold out" : "Make it yours"}</a></div>
            </div>
        </article>`).join("") : `<p class="empty-message">No products in this collection yet.</p>`;
}

// Save bag changes and refresh the drawer's products, quantities, and subtotal.
function saveCart() {
    window.AveluneCart.save(cart);
    renderCart();
}

function renderCart() {
    const ids = new Set(products.map((product) => product.id));
    cart = cart.filter((item) => ids.has(item.id));
    const count = cart.reduce((sum, item) => sum + item.quantity, 0);
    const total = cart.reduce((sum, item) => {
        const product = products.find((candidate) => candidate.id === item.id);
        return sum + (product ? (product.price + window.AveluneCart.optionsPrice(item)) * item.quantity : 0);
    }, 0);
    document.querySelector("#cart-count").textContent = count;
    document.querySelector("#cart-total").textContent = currency(total);
    document.querySelector("#checkout-open").disabled = count === 0;
    document.querySelector("#cart-items").innerHTML = cart.length ? cart.map((item, index) => {
        const product = products.find((candidate) => candidate.id === item.id);
        if (!product) return "";
        const unitPrice = product.price + window.AveluneCart.optionsPrice(item);
        return `<article class="cart-line"><img src="${safeText(product.image)}" alt=""><div><h3>${safeText(product.name)}</h3><p>${safeText(window.AveluneCart.variantText(item) || "Standard size")}</p><p>${currency(unitPrice)} each</p><div class="quantity-controls">
            <button type="button" data-quantity="${index}" data-change="-1" aria-label="Remove one ${safeText(product.name)}">−</button>
            <span>${item.quantity}</span><button type="button" data-quantity="${index}" data-change="1" aria-label="Add one ${safeText(product.name)}" ${item.quantity >= product.stock ? "disabled" : ""}>+</button></div></div>
            <label class="cart-item-message">Message (optional)<textarea data-item-message="${index}" aria-label="Message about ${safeText(product.name)}" rows="2" maxlength="500" placeholder="Add a note for this item">${safeText(item.message)}</textarea></label>
            <button class="cart-remove" data-remove="${index}" type="button">Remove</button></article>`;
    }).join("") : `<p class="cart-empty">Your bag is ready for something lovely.</p>`;
}

// Open or close the accessible shopping-bag drawer and its backdrop.
function openCart() {
    document.querySelector("#cart-drawer").classList.add("open");
    document.querySelector("#cart-backdrop").classList.add("open");
    document.querySelector("#cart-drawer").setAttribute("aria-hidden", "false");
}

function closeCart() {
    document.querySelector("#cart-drawer").classList.remove("open");
    document.querySelector("#cart-backdrop").classList.remove("open");
    document.querySelector("#cart-drawer").setAttribute("aria-hidden", "true");
}

// Wire audience filters, product customization links, bag editing, and drawer controls.
document.querySelector(".category-tabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    selectedCategory = button.dataset.category;
    document.querySelectorAll(".category-tab").forEach((tab) => {
        tab.classList.toggle("active", tab === button);
        tab.setAttribute("aria-pressed", String(tab === button));
    });
    renderProducts();
});

document.querySelector("#order-confirmation-close").addEventListener("click", () => {
    document.querySelector("#order-confirmation").hidden = true;
});

grid.addEventListener("click", (event) => {
    const link = event.target.closest("[data-customize]");
    if (link) location.href = link.href;
});

document.querySelector("#cart-items").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    const change = event.target.closest("[data-quantity]");
    if (remove) cart.splice(Number(remove.dataset.remove), 1);
    if (change) {
        const item = cart[Number(change.dataset.quantity)];
        if (item) item.quantity += Number(change.dataset.change);
        cart = cart.filter((entry) => entry.quantity > 0);
    }
    saveCart();
});

document.querySelector("#cart-items").addEventListener("input", (event) => {
    const input = event.target.closest("[data-item-message]");
    if (!input) return;
    const item = cart[Number(input.dataset.itemMessage)];
    if (!item) return;
    item.message = input.value.slice(0, 500);
    window.AveluneCart.save(cart);
});

document.querySelector("#cart-toggle").addEventListener("click", openCart);
document.querySelector("#cart-close").addEventListener("click", closeCart);
document.querySelector("#cart-backdrop").addEventListener("click", closeCart);
document.querySelector("#checkout-open").addEventListener("click", () => {
    location.href = "cart.html";
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCart();
});

// Fetch the collection and draw both product cards and the current bag contents.
request("/api/products")
    .then((data) => {
        products = data;
        const categoryNames = new Set(["all", "children", "women", "men", "sale"]);
        if (!categoryNames.has(selectedCategory)) selectedCategory = "all";
        document.querySelectorAll(".category-tab").forEach((button) => {
            button.classList.toggle("active", button.dataset.category === selectedCategory);
            button.setAttribute("aria-pressed", String(button.dataset.category === selectedCategory));
        });
        renderProducts();
        renderCart();
    })
    .catch((error) => { grid.innerHTML = `<p class="empty-message">${safeText(error.message)} Please reload the page.</p>`; });
