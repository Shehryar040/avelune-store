// Homepage product shelves, category previews, and quick-add cart actions.
const shop = document.querySelector(".home-shop");
const categoryLabels = {
    children: "CHILDREN'S CLOTHING",
    women: "WOMEN'S CLOTHING",
    men: "MEN'S CLOTHING"
};
const safeFeatured = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const priceFeatured = (value) => `PKR ${Number(value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function newestFirst(products) {
    return [...products].sort((first, second) => {
        const firstTime = Date.parse(first.createdAt || "") || 0;
        const secondTime = Date.parse(second.createdAt || "") || 0;
        return secondTime - firstTime || second.id - first.id;
    });
}

function productCard(product, isNew = false) {
    const soldOut = product.stock < 1;
    const badge = soldOut ? "Sold out" : product.salePercent ? `${product.salePercent}% off` : isNew ? "Just added" : "Make it yours";
    const size = product.category === "children" ? "6Y" : "M";
    return `
        <article class="product-card">
            <a class="product-card-image" href="product.html?id=${product.id}" aria-label="Customize ${safeFeatured(product.name)}">
                <img src="${safeFeatured(product.image)}" alt="${safeFeatured(product.name)}" loading="lazy">
                <span class="${product.salePercent && !soldOut ? "product-badge-sale" : ""}">${badge}</span>
            </a>
            <div class="product-card-info">
                <p>${categoryLabels[product.category] || "CUSTOM CLOTHING"} · HEAT-PRESS READY</p>
                <h3>${safeFeatured(product.name)}</h3>
                <div class="product-card-bottom">
                    <strong>${priceFeatured(product.price)}${product.salePercent && product.originalPrice > product.price ? ` <del>${priceFeatured(product.originalPrice)}</del>` : ""}</strong>
                    <a class="text-link" href="product.html?id=${product.id}">Customize →</a>
                </div>
                <button class="button button-dark homepage-add-button" type="button" data-add-product="${product.id}" ${soldOut ? "disabled" : ""}>
                    ${soldOut ? "Currently sold out" : `Add ${size} · White to bag`}
                </button>
            </div>
        </article>`;
}

function renderCards(container, products, emptyMessage, newIds = new Set()) {
    container.innerHTML = products.length
        ? products.map((product) => productCard(product, newIds.has(product.id))).join("")
        : `<p class="page-error">${emptyMessage}</p>`;
}

fetch("/api/products")
    .then((response) => {
        if (!response.ok) throw new Error("The clothing collection could not be loaded.");
        return response.json();
    })
    .then((products) => {
        const availableProducts = products.filter((product) =>
            ["men", "women", "children"].includes(product.category)
        );
        const latest = newestFirst(availableProducts);
        const newArrivals = latest.slice(0, 3);
        const newIds = new Set(newArrivals.map((product) => product.id));
        const saleProducts = availableProducts
            .filter((product) => product.salePercent > 0)
            .sort((first, second) => {
                const discountDifference = second.salePercent - first.salePercent;
                if (discountDifference) return discountDifference;
                const firstTime = Date.parse(first.createdAt || "") || 0;
                const secondTime = Date.parse(second.createdAt || "") || 0;
                return secondTime - firstTime || second.id - first.id;
            })
            .slice(0, 3);

        renderCards(
            document.querySelector("#sale-products"),
            saleProducts,
            `No sale items right now. <a href="OurOffers.html">Browse all clothing</a>.`,
            newIds
        );
        renderCards(
            document.querySelector("#new-products"),
            newArrivals,
            `New clothing is on the way. <a href="OurOffers.html">Browse the collection</a>.`,
            newIds
        );
        document.querySelectorAll("[data-category-products]").forEach((container) => {
            const category = container.dataset.categoryProducts;
            const categoryProducts = latest.filter((product) => product.category === category).slice(0, 4);
            renderCards(
                container,
                categoryProducts,
                `There are no ${category} items available right now. <a href="OurOffers.html">Browse the collection</a>.`,
                newIds
            );
        });
    })
    .catch((error) => {
        console.error(error);
        const message = `${safeFeatured(error.message)} <a href="OurOffers.html">Explore the clothing collection</a>.`;
        document.querySelectorAll("#sale-products, #new-products, [data-category-products]").forEach((container) => {
            container.innerHTML = `<p class="page-error">${message}</p>`;
        });
    });

// Quick-add the same default size and color used by the product customizer.
shop.addEventListener("click", (event) => {
    const button = event.target.closest("[data-add-product]");
    if (!button || button.disabled) return;

    const productId = Number(button.dataset.addProduct);
    const message = document.querySelector("#homepage-add-status");
    button.disabled = true;
    fetch("/api/products")
        .then((response) => {
            if (!response.ok) throw new Error("Product availability could not be checked. Please try again.");
            return response.json();
        })
        .then((products) => {
            const product = products.find((item) => item.id === productId);
            if (!product || product.stock < 1) {
                button.textContent = "Currently sold out";
                message.textContent = "This item is no longer available.";
                return;
            }

            const size = product.category === "children" ? "6Y" : "M";
            const items = window.AveluneCart.load();
            const existing = items.find((item) =>
                item.id === product.id && item.size === size && item.color === "White" &&
                item.print === "none" && item.message === ""
            );
            if (existing && existing.quantity >= product.stock) {
                message.textContent = "The available stock for this item is already in your bag.";
                return;
            }
            if (existing) existing.quantity += 1;
            else items.push({ id: product.id, quantity: 1, size, color: "White", print: "none", message: "" });
            window.AveluneCart.save(items);
            document.querySelectorAll("[data-cart-count]").forEach((badge) => {
                badge.textContent = items.reduce((sum, item) => sum + item.quantity, 0);
            });
            message.textContent = `${product.name} added to your bag.`;
        })
        .catch((error) => {
            console.error(error);
            message.textContent = error.message || "The item could not be added. Please try again.";
        })
        .finally(() => {
            if (button.isConnected && button.textContent !== "Currently sold out") button.disabled = false;
        });
});
