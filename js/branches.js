// Escape branch and contact values before inserting them into generated page markup.
const escapeBranch = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));

// Load store contact settings and branch locations, then render customer-facing details.
async function loadBranchDetails() {
    const [branchesResponse, settingsResponse] = await Promise.all([
        fetch("/api/branches"),
        fetch("/api/settings")
    ]);
    if (!branchesResponse.ok || !settingsResponse.ok) throw new Error("Store contact information could not be loaded.");
    const [branches, settings] = await Promise.all([branchesResponse.json(), settingsResponse.json()]);
    document.querySelector("#store-welcome").textContent = settings.welcome;
    document.querySelector("#opening-hours").textContent = settings.openingHours;
    const phone = document.querySelector("#contact-phone");
    phone.href = `tel:${settings.phone.replace(/[^\d+]/g, "")}`;
    phone.querySelector("strong").textContent = settings.phone;
    const whatsapp = document.querySelector("#contact-whatsapp");
    whatsapp.href = `https://wa.me/${settings.whatsapp.replace(/\D/g, "")}`;
    whatsapp.querySelector("strong").textContent = settings.whatsapp;
    const email = document.querySelector("#contact-email");
    email.href = `mailto:${settings.email}`;
    email.querySelector("strong").textContent = settings.email;
    for (const [key, label] of [["facebook", "contact-facebook"], ["instagram", "contact-instagram"]]) {
        const link = document.querySelector(`#${label}`);
        if (!settings[key]) continue;
        link.href = settings[key];
        link.querySelector("strong").textContent = settings[key].replace(/^https?:\/\/(www\.)?/, "");
        link.hidden = false;
    }
    const list = document.querySelector("#public-branches");
    list.innerHTML = branches.length ? branches.map((branch) => `
        <article class="public-branch"><div class="public-branch-info"><h3>${escapeBranch(branch.name)}</h3>
            <p>${escapeBranch(branch.address)}</p><p>${escapeBranch(branch.hours || settings.openingHours)}</p>
            ${branch.phone ? `<a href="tel:${escapeBranch(branch.phone.replace(/[^\d+]/g, ""))}">Call ${escapeBranch(branch.phone)} →</a>` : ""}
        </div>${branch.mapUrl ? `<iframe src="${escapeBranch(branch.mapUrl)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Map for ${escapeBranch(branch.name)} branch"></iframe>` : ""}</article>`).join("") : `<p class="loading">Branch details will be available soon.</p>`;
}

loadBranchDetails().catch((error) => {
    console.error(error);
    document.querySelector("#public-branches").innerHTML = `<p class="loading">We're unable to load store details right now. Please try again later.</p>`;
});
