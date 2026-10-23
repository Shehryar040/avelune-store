// Shared cart pricing rules and storage keys keep bag totals consistent across store pages.
(function () {
    const storageKey = "avelune-cart";
    const legacyKey = "nonline-cart";
    const printPrices = { none: 0, front: 250, back: 250, "front-back": 400, embroidered: 500 };
    const sizePrices = { "2XL": 100, "3XL": 200 };

    // Read and validate saved cart entries, including data saved under the previous brand key.
    function load() {
        const raw = localStorage.getItem(storageKey) || localStorage.getItem(legacyKey) || "[]";
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new TypeError("Saved bag data is not a list.");
        return parsed.filter((item) =>
            Number.isSafeInteger(item?.id) && Number.isSafeInteger(item?.quantity) && item.quantity > 0
        ).map((item) => ({
            ...item,
            message: typeof item.message === "string" ? item.message.slice(0, 500) : "",
            size: typeof item.size === "string" ? item.size : "",
            color: typeof item.color === "string" ? item.color : "",
            print: typeof item.print === "string" && Object.hasOwn(printPrices, item.print) ? item.print : "none"
        }));
    }

    // Persist cart changes under the current key and remove the migrated legacy entry.
    function save(items) {
        localStorage.setItem(storageKey, JSON.stringify(items));
        localStorage.removeItem(legacyKey);
    }

    // Calculate the added price for size and print choices on a cart item.
    function optionsPrice(item) {
        return (sizePrices[item.size] || 0) + (printPrices[item.print] || 0);
    }

    // Format selected garment options for display in the bag and checkout summary.
    function variantText(item) {
        return [
            item.size && `Size ${item.size}`,
            item.color && item.color,
            item.print && item.print !== "none" && ({
                front: "Front heat-press print",
                back: "Back heat-press print",
                "front-back": "Front + back heat-press print",
                embroidered: "Embroidery"
            }[item.print])
        ].filter(Boolean).join(" · ");
    }

    window.AveluneCart = { load, save, optionsPrice, variantText };
    // Restore the shared bag count in any header badges present on the current page.
    try {
        const items = load();
        document.querySelectorAll("[data-cart-count]").forEach((badge) => {
            badge.textContent = items.reduce((sum, item) => sum + item.quantity, 0);
        });
    } catch (error) {
        console.error("The saved AVELUNE bag could not be restored.", error);
    }
})();
