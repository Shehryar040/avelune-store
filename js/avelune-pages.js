// Shared cart-page state, formatting helpers, and safe text encoding.
const cart = window.AveluneCart;
const money = (value) => `PKR ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const pageType = document.body.dataset.page;
let products = [];
let items = [];

try {
    items = cart.load();
} catch (error) {
    console.error("The saved AVELUNE bag could not be restored.", error);
    localStorage.removeItem("avelune-cart");
    localStorage.removeItem("nonline-cart");
}

// Find the current product record used to calculate each saved cart item's price.
function productFor(item) {
    return products.find((product) => product.id === item.id);
}

// Keep the header bag badge and subtotal synchronized with the current cart.
function updateCount() {
    document.querySelectorAll("[data-cart-count]").forEach((badge) => {
        badge.textContent = items.reduce((sum, item) => sum + item.quantity, 0);
    });
}

function bagTotal() {
    return items.reduce((sum, item) => {
        const product = productFor(item);
        return sum + (product ? (product.price + cart.optionsPrice(item)) * item.quantity : 0);
    }, 0);
}

// Render the editable shopping bag, including quantities, item notes, and removal controls.
function renderCartPage() {
    const content = document.querySelector("#cart-page-items");
    const validItems = items.filter((item) => productFor(item));
    items = validItems;
    content.innerHTML = items.length ? items.map((item, index) => {
        const product = productFor(item);
        const unitPrice = product.price + cart.optionsPrice(item);
        return `<article class="bag-line">
            <img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">
            <div class="bag-product"><p class="eyebrow">MADE YOUR WAY</p><h2>${escapeHtml(product.name)}</h2>
                <p>${escapeHtml(cart.variantText(item) || "Standard size")}</p>
                ${item.message ? `<p class="bag-note">Note: ${escapeHtml(item.message)}</p>` : ""}
                <div class="bag-quantity"><button type="button" data-quantity="${index}" data-delta="-1" aria-label="Remove one">−</button><span>${item.quantity}</span><button type="button" data-quantity="${index}" data-delta="1" aria-label="Add one" ${item.quantity >= product.stock ? "disabled" : ""}>+</button></div>
            </div>
            <strong class="bag-line-price">${money(unitPrice * item.quantity)}</strong>
            <button class="remove-link" type="button" data-remove="${index}">Remove</button>
        </article>`;
    }).join("") : `<div class="empty-bag"><span aria-hidden="true">✳</span><h2>Your next favourite starts here.</h2><p>Your bag is currently empty. Choose a tee and make it yours.</p><a class="button button-dark" href="product.html">Design your T-shirt</a></div>`;
    document.querySelector("#bag-subtotal").textContent = money(bagTotal());
    document.querySelector("#bag-checkout").toggleAttribute("disabled", !items.length);
    updateCount();
    cart.save(items);
}

// Render the checkout order summary and disable submission when the bag is empty.
function renderCheckoutPage() {
    const content = document.querySelector("#checkout-summary");
    const validItems = items.filter((item) => productFor(item));
    items = validItems;
    content.innerHTML = items.length ? items.map((item) => {
        const product = productFor(item);
        return `<div class="summary-line"><span>${escapeHtml(product.name)} × ${item.quantity}<small>${escapeHtml(cart.variantText(item) || "Standard size")}</small></span><strong>${money((product.price + cart.optionsPrice(item)) * item.quantity)}</strong></div>`;
    }).join("") : `<p class="empty-checkout">Your bag is empty. <a href="product.html">Choose a T-shirt</a> to continue.</p>`;
    document.querySelector("#checkout-subtotal").textContent = money(bagTotal());
    document.querySelector("#checkout-grand-total").textContent = money(bagTotal());
    document.querySelector("#place-order").disabled = !items.length;
    updateCount();
}

// Render only the cart or checkout view selected by this document's page marker.
function renderCurrentPage() {
    if (pageType === "cart") renderCartPage();
    if (pageType === "checkout") renderCheckoutPage();
}

// Handle cart-item removal and quantity changes on the cart page.
document.addEventListener("click", (event) => {
    const remove = event.target.closest("[data-remove]");
    const quantity = event.target.closest("[data-quantity]");
    if (remove) items.splice(Number(remove.dataset.remove), 1);
    if (quantity) {
        const index = Number(quantity.dataset.quantity);
        const item = items[index];
        if (item) item.quantity = Math.max(0, Math.min(99, item.quantity + Number(quantity.dataset.delta)));
        items = items.filter((entry) => entry.quantity > 0);
    }
    if (remove || quantity) {
        cart.save(items);
        renderCurrentPage();
    }
});

// Navigate to checkout and submit customer details and cart items as an order.
const checkoutForm = document.querySelector("#checkout-form");
const bagCheckout = document.querySelector("#bag-checkout");
if (bagCheckout) bagCheckout.addEventListener("click", () => {
    location.href = "checkout.html";
});
if (checkoutForm) checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#checkout-message");
    const button = document.querySelector("#place-order");
    button.disabled = true;
    message.textContent = "Placing your order…";
    try {
        const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...Object.fromEntries(new FormData(checkoutForm)),
                items: items.map((item) => ({
                    id: item.id,
                    quantity: item.quantity,
                    size: item.size || "",
                    color: item.color || "",
                    print: item.print || "none",
                    message: item.message || ""
                }))
            })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Your order could not be placed.");
        items = [];
        cart.save(items);
        updateCount();
        message.textContent = "";
        checkoutForm.hidden = true;
        document.querySelector(".checkout-layout").hidden = true;
        document.querySelector("#checkout-success").hidden = false;
        document.querySelector("#checkout-success-message").textContent = result.receiptSent
            ? `Order #${result.orderId} is confirmed. Your total is ${money(result.total)}, payable on delivery. A receipt was sent to ${result.email}.`
            : `Order #${result.orderId} is confirmed. Your total is ${money(result.total)}, payable on delivery. ${result.receiptMessage}`;
    } catch (error) {
        message.textContent = error.message || "The store could not be reached. Check your connection and try again.";
        button.disabled = false;
    }
});

// Load product data before rendering cart prices and checkout summaries.
fetch("/api/products")
    .then((response) => {
        if (!response.ok) throw new Error("The store collection could not be loaded.");
        return response.json();
    })
    .then((result) => {
        products = result;
        renderCurrentPage();
    })
    .catch((error) => {
        const target = document.querySelector("#cart-page-items, #checkout-summary");
        if (target) target.innerHTML = `<p class="page-error">${escapeHtml(error.message)} Please reload the page.</p>`;
    });
