// Customization options, price additions, and formatting helpers for the garment form.
const optionPrices = { none: 0, front: 250, back: 250, "front-back": 400 };
const adultSizes = ["XS", "S", "M", "L", "XL", "2XL", "3XL"];
const childSizes = ["0-3M", "3-6M", "6-9M", "9-12M", "12-18M", "18-24M", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "11Y", "12Y", "13Y", "14Y"];
const audiences = { children: "Children", women: "Women", men: "Men" };
const colors = [
    { name: "White", hex: "#f9f8f3" }, { name: "Black", hex: "#242522" },
    { name: "Natural", hex: "#d6cbb7" }, { name: "Sage", hex: "#8a987e" },
    { name: "Navy", hex: "#35465c" }, { name: "Rose", hex: "#bd8586" }
];
const formatPrice = (value) => `PKR ${Number(value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const encodeText = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
let clothingProducts = [];
let selectedSize = "M";
let selectedColor = "White";
let product = null;

// Replace the product details with a clear message when the requested garment cannot load.
function showUnavailable(message) {
    document.querySelector(".detail-layout").innerHTML = `<div class="detail-unavailable"><p class="eyebrow">AVELUNE CUSTOM STUDIO</p><h1>We're preparing your next custom piece.</h1><p>${encodeText(message)}</p><a class="button button-dark" href="OurOffers.html">Browse clothing</a></div>`;
}

// Read selected garment options and update the displayed custom price.
function selectedPrint() {
    return document.querySelector("#print-style").value;
}

function sizePrice() {
    return selectedSize === "2XL" ? 100 : selectedSize === "3XL" ? 200 : 0;
}

function renderPrice() {
    if (!product) return;
    const total = product.price + sizePrice() + optionPrices[selectedPrint()];
    document.querySelector("#product-price").textContent = `${formatPrice(product.price)} · garment`;
    document.querySelector("#custom-total").textContent = `Your custom garment · ${formatPrice(total)}`;
    document.querySelector("#design-note").required = selectedPrint() !== "none";
    document.querySelector("#add-to-bag").disabled = product.stock < 1;
    document.querySelector("#add-to-bag").textContent = product.stock < 1 ? "Currently sold out" : "Add custom clothing to bag";
}

// Update product details, available sizes, and price when a garment is selected.
function renderSelectedProduct() {
    product = clothingProducts.find((garment) => garment.id === Number(document.querySelector("#garment-style").value));
    if (!product) return;
    const isChildren = product.category === "children";
    selectedSize = isChildren ? "6Y" : "M";
    const sizes = isChildren ? childSizes : adultSizes;
    document.querySelector("#size-guide").textContent = isChildren
        ? "Baby sizes · 0–24 months · ages 2–14"
        : `${audiences[product.category] || "Adult"} sizes · XS–3XL`;
    document.querySelector("#size-options").innerHTML = sizes.map((size) =>
        `<button class="size-option" type="button" data-size="${size}" aria-pressed="${size === selectedSize}">${size}${size === "2XL" ? " +PKR 100" : size === "3XL" ? " +PKR 200" : ""}</button>`
    ).join("");
    document.querySelector("#garment-audience").textContent = audiences[product.category] || "Clothing";
    document.querySelector("#product-name").textContent = product.name;
    document.querySelector("#product-description").textContent = `${product.description ? `${product.description.trim()} ` : "A garment ready for a custom design. "}Choose your size, color, heat-press placement, and print idea.`;
    document.querySelector("#product-image").src = product.image;
    document.querySelector("#product-image").alt = `${product.name}, ready for a custom AVELUNE heat-press print`;
    renderPrice();
}

// Build color swatches and handle size, color, and print selection changes.
document.querySelector("#color-options").innerHTML = colors.map((color) =>
    `<button class="swatch" type="button" data-color="${color.name}" aria-pressed="${color.name === selectedColor}"><i style="background:${color.hex}"></i>${color.name}</button>`
).join("");

document.querySelector("#size-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-size]");
    if (!button) return;
    selectedSize = button.dataset.size;
    document.querySelectorAll("[data-size]").forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
    renderPrice();
});
document.querySelector("#color-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-color]");
    if (!button) return;
    selectedColor = button.dataset.color;
    document.querySelector("#selected-color").textContent = selectedColor;
    document.querySelectorAll("[data-color]").forEach((option) => option.setAttribute("aria-pressed", String(option === button)));
});
document.querySelector("#garment-style").addEventListener("change", renderSelectedProduct);
document.querySelector("#print-style").addEventListener("change", renderPrice);
// Add the selected size, color, print, and customer note to the shared shopping bag.
document.querySelector("#customize-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!product || product.stock < 1) return;
    const message = document.querySelector("#design-note").value.trim();
    const cartItems = window.AveluneCart.load();
    const existing = cartItems.find((item) =>
        item.id === product.id && item.size === selectedSize && item.color === selectedColor &&
        item.print === selectedPrint() && item.message === message
    );
    if (existing && existing.quantity >= product.stock) {
        document.querySelector("#product-message").textContent = "There is not enough stock left for another one of this exact selection.";
        return;
    }
    if (existing) existing.quantity += 1;
    else cartItems.push({
        id: product.id, quantity: 1, size: selectedSize, color: selectedColor,
        print: selectedPrint(), message
    });
    window.AveluneCart.save(cartItems);
    document.querySelectorAll("[data-cart-count]").forEach((badge) => {
        badge.textContent = cartItems.reduce((sum, item) => sum + item.quantity, 0);
    });
    document.querySelector("#product-message").textContent = "Added to your bag. Your size, color, finish, and note are saved.";
});

// Load active garments, select the requested item, and initialize the customization form.
fetch("/api/products")
    .then((response) => {
        if (!response.ok) throw new Error("The AVELUNE product collection could not be loaded.");
        return response.json();
    })
    .then((products) => {
        clothingProducts = products.filter((item) =>
            ["men", "women", "children"].includes(item.category)
        );
        if (!clothingProducts.length) {
            showUnavailable("There are no active clothing products in the collection yet. Add products under Men, Women, or Children in Admin → Products and return here.");
            return;
        }
        const requestedId = Number(new URLSearchParams(location.search).get("id"));
        const initialProduct = clothingProducts.find((item) => item.id === requestedId) || clothingProducts[0];
        document.querySelector("#garment-style").innerHTML = clothingProducts.map((item) =>
            `<option value="${item.id}" ${item.id === initialProduct.id ? "selected" : ""} ${item.stock < 1 ? "disabled" : ""}>${audiences[item.category]} · ${encodeText(item.name)} — ${formatPrice(item.price)}${item.stock < 1 ? " · Sold out" : ""}</option>`
        ).join("");
        renderSelectedProduct();
        const bagItems = window.AveluneCart.load();
        document.querySelectorAll("[data-cart-count]").forEach((badge) => {
            badge.textContent = bagItems.reduce((sum, item) => sum + item.quantity, 0);
        });
    })
    .catch((error) => showUnavailable(`${error.message} Please reload the page.`));
