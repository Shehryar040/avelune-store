// Load server dependencies for security, filesystem access, SQLite storage, and HTTP routing.
import "dotenv/config";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import nodemailer from "nodemailer";

// Resolve server paths, runtime limits, supported garment sizes, and password hashing.
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR || path.join(os.homedir(), ".nonline-store");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "store.sqlite");
const PORT = Number(process.env.PORT || 3000);
const SESSION_TTL = 8 * 60 * 60;
const PASSWORD_BYTES = 64;
const SMTP_PORT = Number(process.env.SMTP_PORT || 587);
const ADULT_SIZES = new Set(["", "XS", "S", "M", "L", "XL", "2XL", "3XL"]);
const CHILD_SIZES = new Set(["0-3M", "3-6M", "6-9M", "9-12M", "12-18M", "18-24M", "2Y", "3Y", "4Y", "5Y", "6Y", "7Y", "8Y", "9Y", "10Y", "11Y", "12Y", "13Y", "14Y"]);
const scrypt = promisify(crypto.scrypt);

// Validate required credentials and port settings before opening the database or server.
if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || !process.env.SESSION_SECRET) {
    throw new Error("Set ADMIN_USERNAME, ADMIN_PASSWORD and SESSION_SECRET in your environment before starting the store.");
}
if (process.env.ADMIN_PASSWORD.length < 8) {
    throw new Error("ADMIN_PASSWORD must be at least 8 characters long.");
}
if (process.env.SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long.");
}
if (process.env.ADMIN_PASSWORD.startsWith("replace-with-") || process.env.SESSION_SECRET.startsWith("replace-with-")) {
    throw new Error("Replace the example admin password and session secret before starting the server.");
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be a valid TCP port.");
}
const smtpSettingsProvided = ["SMTP_HOST", "SMTP_USER", "SMTP_PASSWORD", "SMTP_FROM"]
    .some((name) => process.env[name]);
if (smtpSettingsProvided) {
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM) {
        throw new Error("Configure both SMTP_HOST and SMTP_FROM to enable customer receipt emails.");
    }
    if (!Number.isInteger(SMTP_PORT) || SMTP_PORT < 1 || SMTP_PORT > 65535) {
        throw new Error("SMTP_PORT must be a valid TCP port.");
    }
    if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD)) {
        throw new Error("Configure both SMTP_USER and SMTP_PASSWORD, or leave both blank.");
    }
    if (process.env.SMTP_SECURE && !["true", "false"].includes(process.env.SMTP_SECURE)) {
        throw new Error("SMTP_SECURE must be true or false.");
    }
}
const mailTransport = smtpSettingsProvided
    ? nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: SMTP_PORT,
        secure: process.env.SMTP_SECURE === "true",
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        ...(process.env.SMTP_USER ? {
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        } : {})
    })
    : null;

// Create the upload location, database tables, indexes, and migrations for existing stores.
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        salt TEXT NOT NULL,
        password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL CHECK(category IN ('men', 'women', 'children')),
        image TEXT NOT NULL,
        price REAL NOT NULL CHECK(price >= 0),
        original_price REAL NOT NULL CHECK(original_price >= 0),
        stock INTEGER NOT NULL DEFAULT 0 CHECK(stock >= 0),
        featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0, 1)),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
        sale_percent INTEGER NOT NULL DEFAULT 0 CHECK(sale_percent BETWEEN 0 AND 99),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS branches (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        address TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        hours TEXT NOT NULL DEFAULT '',
        map_url TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1))
    );
    CREATE TABLE IF NOT EXISTS store_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        welcome TEXT NOT NULL DEFAULT '',
        opening_hours TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL DEFAULT '',
        whatsapp TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        facebook TEXT NOT NULL DEFAULT '',
        instagram TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY,
        customer_name TEXT NOT NULL,
        customer_email TEXT NOT NULL DEFAULT '',
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        total REAL NOT NULL CHECK(total >= 0),
        status TEXT NOT NULL DEFAULT 'pending'
            CHECK(status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS order_items (
        id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        product_name TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK(quantity > 0),
        unit_price REAL NOT NULL CHECK(unit_price >= 0),
        item_message TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS orders_created_at_idx ON orders(created_at DESC);
    CREATE INDEX IF NOT EXISTS order_items_order_id_idx ON order_items(order_id);
`);
if (!db.prepare("PRAGMA table_info(products)").all().some((column) => column.name === "sale_percent")) {
    db.exec("ALTER TABLE products ADD COLUMN sale_percent INTEGER NOT NULL DEFAULT 0 CHECK(sale_percent BETWEEN 0 AND 99)");
    db.exec(`
        UPDATE products
        SET sale_percent = MIN(99, MAX(1, ROUND((1 - price / original_price) * 100)))
        WHERE original_price > price AND original_price > 0
    `);
}
if (!db.prepare("PRAGMA table_info(order_items)").all().some((column) => column.name === "item_message")) {
    db.exec("ALTER TABLE order_items ADD COLUMN item_message TEXT NOT NULL DEFAULT ''");
}
if (!db.prepare("PRAGMA table_info(orders)").all().some((column) => column.name === "customer_email")) {
    db.exec("ALTER TABLE orders ADD COLUMN customer_email TEXT NOT NULL DEFAULT ''");
}

// Read session cookies, hash session tokens, and set or clear secure admin cookies.
function getCookie(req, cookieName) {
    const entry = (req.headers.cookie || "").split(";").map((part) => part.trim())
        .find((part) => part.startsWith(`${cookieName}=`));
    return entry ? decodeURIComponent(entry.slice(cookieName.length + 1)) : "";
}

function tokenHash(token) {
    return crypto.createHmac("sha256", process.env.SESSION_SECRET).update(token).digest("hex");
}

function setSessionCookie(res, token) {
    const flags = ["Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${SESSION_TTL}`];
    if (process.env.NODE_ENV === "production") flags.push("Secure");
    res.setHeader("Set-Cookie", `nonline_admin=${encodeURIComponent(token)}; ${flags.join("; ")}`);
}

function clearSessionCookie(res) {
    const flags = ["Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
    if (process.env.NODE_ENV === "production") flags.push("Secure");
    res.setHeader("Set-Cookie", `nonline_admin=; ${flags.join("; ")}`);
}

// Validate and normalize user-provided text, numbers, booleans, and product image paths.
function text(value, field, maxLength = 500) {
    if (typeof value !== "string" || value.trim().length > maxLength) {
        throw new Error(`${field} must be a text value no longer than ${maxLength} characters.`);
    }
    return value.trim();
}

function number(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
        throw new Error(`${field} must be a valid ${integer ? "whole number" : "number"} from ${min} to ${max}.`);
    }
    return parsed;
}

function bool(value, field) {
    if (typeof value !== "boolean") throw new Error(`${field} must be true or false.`);
    return value ? 1 : 0;
}

// Escape customer and order details before including them in the HTML receipt.
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[character]));
}

// Format receipt prices consistently with the storefront's PKR display.
function formatMoney(value) {
    return `PKR ${Number(value).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Email an order receipt after the order has been safely committed to the database.
async function sendOrderReceipt({ email, customerName, phone, address, orderId, total, items }) {
    if (!mailTransport) return false;
    const rows = items.map(({ product, quantity, unitPrice, itemMessage }) => ({
        name: product.name,
        quantity,
        unitPrice,
        details: itemMessage
    }));
    const textItems = rows.map((item) =>
        `${item.name} × ${item.quantity} — ${formatMoney(item.unitPrice * item.quantity)}${item.details ? `\n${item.details}` : ""}`
    ).join("\n\n");
    const htmlItems = rows.map((item) => `
        <tr>
            <td style="padding:12px;border-bottom:1px solid #e1e6dc">
                <strong>${escapeHtml(item.name)} × ${item.quantity}</strong>
                ${item.details ? `<br><span style="color:#687064">${escapeHtml(item.details).replace(/\n/g, "<br>")}</span>` : ""}
            </td>
            <td style="padding:12px;border-bottom:1px solid #e1e6dc;text-align:right">${formatMoney(item.unitPrice * item.quantity)}</td>
        </tr>`).join("");
    await mailTransport.sendMail({
        from: process.env.SMTP_FROM,
        to: email,
        subject: `AVELUNE order receipt #${orderId}`,
        text: [
            `Thank you for your AVELUNE order, ${customerName}.`,
            `Order #${orderId}`,
            "",
            textItems,
            "",
            `Total due on delivery: ${formatMoney(total)}`,
            `Phone: ${phone}`,
            `Delivery address: ${address}`,
            "Payment method: Cash on delivery"
        ].join("\n"),
        html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f7f5ef;font-family:Arial,sans-serif;color:#20251f">
            <main style="max-width:620px;margin:auto;padding:32px;background:#fffefa">
                <p style="color:#53664a;letter-spacing:3px;font-size:12px;font-weight:bold">AVELUNE · ORDER RECEIPT</p>
                <h1 style="font-size:26px;font-weight:normal">Thank you, ${escapeHtml(customerName)}.</h1>
                <p>Your order <strong>#${orderId}</strong> is confirmed. Payment is due in cash when it is delivered.</p>
                <table style="width:100%;border-collapse:collapse">${htmlItems}</table>
                <p style="text-align:right;font-size:18px"><strong>Total due on delivery: ${formatMoney(total)}</strong></p>
                <hr style="border:0;border-top:1px solid #e1e6dc">
                <p><strong>Delivery details</strong><br>${escapeHtml(customerName)}<br>${escapeHtml(phone)}<br>${escapeHtml(address).replace(/\n/g, "<br>")}</p>
                <p style="color:#687064;font-size:13px">Questions about your order? Reply to this email or contact AVELUNE.</p>
            </main>
        </body></html>`
    });
    return true;
}

// Notify the store contact email with customer details and the committed order summary.
async function sendNewOrderNotification({ storeEmail, customerEmail, customerName, phone, address, note, orderId, total, items }) {
    if (!mailTransport) return false;
    const textItems = items.map((item) =>
        `${item.product.name} × ${item.quantity} — ${formatMoney(item.unitPrice * item.quantity)}${item.itemMessage ? `\n${item.itemMessage}` : ""}`
    ).join("\n\n");
    const htmlItems = items.map((item) => `
        <tr>
            <td style="padding:12px;border-bottom:1px solid #e1e6dc">
                <strong>${escapeHtml(item.product.name)} × ${item.quantity}</strong>
                ${item.itemMessage ? `<br><span style="color:#687064">${escapeHtml(item.itemMessage).replace(/\n/g, "<br>")}</span>` : ""}
            </td>
            <td style="padding:12px;border-bottom:1px solid #e1e6dc;text-align:right">${formatMoney(item.unitPrice * item.quantity)}</td>
        </tr>`).join("");
    await mailTransport.sendMail({
        from: process.env.SMTP_FROM,
        to: storeEmail,
        replyTo: customerEmail,
        subject: `New AVELUNE order #${orderId} — ${formatMoney(total)}`,
        text: [
            `A new AVELUNE order #${orderId} has been placed.`,
            `Customer: ${customerName}`,
            `Customer email: ${customerEmail}`,
            `Phone: ${phone}`,
            `Delivery address: ${address}`,
            `Order note: ${note || "None"}`,
            "",
            textItems,
            "",
            `Total due on delivery: ${formatMoney(total)}`,
            "Payment method: Cash on delivery"
        ].join("\n"),
        html: `<!doctype html><html><body style="margin:0;padding:32px;background:#f7f5ef;font-family:Arial,sans-serif;color:#20251f">
            <main style="max-width:680px;margin:auto;padding:32px;background:#fffefa">
                <p style="color:#53664a;letter-spacing:3px;font-size:12px;font-weight:bold">AVELUNE · NEW ORDER</p>
                <h1 style="font-size:26px;font-weight:normal">Order #${orderId}</h1>
                <p>A new cash-on-delivery order has been placed.</p>
                <h2 style="font-size:17px">Customer and delivery details</h2>
                <p><strong>${escapeHtml(customerName)}</strong><br>
                    <a href="mailto:${escapeHtml(customerEmail)}">${escapeHtml(customerEmail)}</a><br>
                    ${escapeHtml(phone)}<br>${escapeHtml(address).replace(/\n/g, "<br>")}</p>
                ${note ? `<p><strong>Order note:</strong> ${escapeHtml(note).replace(/\n/g, "<br>")}</p>` : ""}
                <h2 style="font-size:17px">Items</h2>
                <table style="width:100%;border-collapse:collapse">${htmlItems}</table>
                <p style="text-align:right;font-size:18px"><strong>Total due on delivery: ${formatMoney(total)}</strong></p>
                <p style="color:#687064;font-size:13px">Reply to this email to contact the customer about the order.</p>
            </main>
        </body></html>`
    });
    return true;
}

function imagePath(value) {
    const image = text(value, "Image", 300);
    if (!/^\/(?:images|uploads)\/[a-zA-Z0-9_-][a-zA-Z0-9._-]*\.(?:jpe?g|png|webp)$/i.test(image)) {
        throw new Error("Choose an image from the store library or upload a JPG, PNG, or WebP image.");
    }
    const absolutePath = image.startsWith("/images/")
        ? path.join(ROOT, image.slice(1))
        : path.join(UPLOAD_DIR, image.slice("/uploads/".length));
    if (!fs.existsSync(absolutePath)) throw new Error("The selected product image does not exist.");
    return image;
}

// Validate and normalize product and branch forms before database writes.
function productPayload(body) {
    const category = text(body.category, "Category", 20);
    if (!["men", "women", "children"].includes(category)) throw new Error("Select a valid category.");
    const name = text(body.name, "Name", 100);
    if (!name) throw new Error("Name is required.");
    const price = number(body.price, "Price", { max: 10000000 });
    const originalPrice = number(body.originalPrice ?? body.price, "Original price", { max: 10000000 });
    if (originalPrice < price) throw new Error("Original price cannot be lower than the current price.");
    const salePercent = originalPrice > price
        ? Math.min(99, Math.max(1, Math.round((1 - price / originalPrice) * 100)))
        : 0;
    return {
        name,
        description: text(body.description ?? "", "Description", 500),
        category,
        image: imagePath(body.image),
        price,
        originalPrice,
        salePercent,
        stock: number(body.stock, "Stock", { max: 1000000, integer: true }),
        featured: bool(body.featured, "Featured"),
        active: bool(body.active, "Active")
    };
}

function branchPayload(body) {
    const name = text(body.name, "Branch name", 100);
    const address = text(body.address, "Address", 300);
    if (!name || !address) throw new Error("Branch name and address are required.");
    const mapUrl = text(body.mapUrl ?? "", "Map URL", 1000);
    if (mapUrl && !/^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed/.test(mapUrl)) {
        throw new Error("Map URL must be a Google Maps embed URL.");
    }
    return {
        name,
        address,
        phone: text(body.phone ?? "", "Phone", 40),
        hours: text(body.hours ?? "", "Hours", 120),
        map_url: mapUrl,
        active: bool(body.active, "Active")
    };
}

// Provide initial catalog data for an empty store using the existing local product images.
function readLegacyProducts() {
    return [
        ["Man jacker", "man jacket over the age of 25", "222.jpg", "men", 500, 900],
        ["polo shirt", "polo shirt over the age of 25", "ZZ.jpg", "men", 1500, 2000],
        ["white suit", "suit over the age of 25", "uu.jpg", "men", 1000, 1400],
        ["christmas pullover", "christmas pullover over the age of 20", "12.jpg", "men", 1900, 2000],
        ["Men chemise", "Men chemise over the age of 20", "06.jpg", "men", 400, 700],
        ["brown shirt", "Men shirt over the age of 25", "7.jpg", "men", 1000, 2400],
        ["Men suit", "Suit for men over the age of 25", "2.jpg", "men", 1850, 2000],
        ["Suit pants", "Suit pants over the age of 25", "39.jpg", "men", 1000, 1290],
        ["Black pullover", "Black pullover over the age of 25", "s.jpg", "men", 760, 1000],
        ["Men's white shirt", "Men white shirt over the age of 25", "33.jpg", "men", 930, 1100],
        ["Baby blue shirt", "baby blueshirt over the age of 25", "666.jpg", "men", 430, 780],
        ["Floral shirtt", "Floral shirt over the age of 25", "11.jpg", "men", 923, 1240],
        ["blue dress", "blue dressover the age of 20", "10.jpg", "women", 1000, 1100],
        ["Over size T-shirt", "Over size T-shirt the age of 24", "788.jpg", "women", 700, 1000],
        ["bink T-shirt", "bink T-shirt the age of 17", "54.jpg", "women", 600, 900],
        ["green suit", "green suit the age of 24", "09.jpg", "women", 1700, 2000],
        ["white t-shirt", "white t-shirt over the age of 25", "444.jpg", "women", 200, 450],
        ["black pants", "black pants over the age of 25", "55.jpg", "women", 600, 645],
        ["Beig T-shirt", "Beig T-shirt over the age of 25", "44.jpg", "women", 290, 340],
        ["black dress", "black dress over the age of 25", "888.jpg", "women", 780, 800],
        ["dress", "dress over the age of 25", "00.jpg", "women", 790, 1230],
        ["Pink dress", "Pink dress over the age of 20", "1.jpg", "women", 680, 970],
        ["Girls long shirt", "Girls long shirt over the age of 20", "01.jpg", "women", 300, 500],
        ["girls t-shirt", "girls T-shirt from the age of 20:40 years", "777.jpg", "women", 640, 800],
        ["Black skirt", "Black skirt age from 8:15 years", "300.jpg", "children", 400, 700],
        ["Boy jacket", "Boy jacket from 6:14 years old", "hh.jpg", "children", 900, 1300],
        ["Jumpsuit girls", "Jumpsuit girls from the age of two: 5 years", "jj.jpg", "children", 980, 1000],
        ["girls suit", "girls suit from the age of 9:12 years", "mm.jpg", "children", 990, 1230],
        ["Boys t-shirt", "Boys t-shirt from the age of 20:40 years", "bb.jpg", "children", 600, 780],
        ["Boyspants", "Boyspants from the age of 20:40 years", "ll.jpg", "children", 450, 560],
        ["Baby dress", "Baby dress from the age of 20:40 years", "kk.jpg", "children", 800, 800],
        ["full set", "full set over the age of 10", "15.jpg", "children", 1900, 2000],
        ["girls suit", "girls suit over the age of 8", "13.jpg", "children", 700, 1000],
        ["skirt", "skirt over the age of 7", "20.jpg", "children", 400, 500],
        ["blue dress", "blue dress over the age of 11", "14.jpg", "children", 750, 900],
        ["baby suit", "baby suit over the age of 8", "98.jpg", "children", 800, 1100]
    ].map(([name, description, image, category, price, originalPrice]) => ({
        name, description, image: `/images/${image}`, category, price, originalPrice,
        salePercent: originalPrice > price ? Math.min(99, Math.max(1, Math.round((1 - price / originalPrice) * 100))) : 0,
        stock: 10,
        featured: (category === "men" && name === "Men suit") ||
            (category === "women" && name === "blue dress") ||
            (category === "children" && name === "full set"),
        active: true
    }));
}

// Create or securely reset the bootstrap admin account using a salted password hash.
async function ensureBootstrapAdmin() {
    const existing = db.prepare("SELECT id FROM admins WHERE username = ?").get(process.env.ADMIN_USERNAME);
    const admins = db.prepare("SELECT id FROM admins ORDER BY id").all();
    if (admins.length > 0 && process.env.RESET_ADMIN_PASSWORD !== "true") return;
    if (process.env.RESET_ADMIN_PASSWORD === "true" && !existing && admins.length > 1) {
        throw new Error("Cannot reset bootstrap credentials when multiple admin accounts exist.");
    }
    const accountToReset = existing || (admins.length === 1 ? admins[0] : null);
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(process.env.ADMIN_PASSWORD, salt, PASSWORD_BYTES);
    if (accountToReset) {
        db.prepare("UPDATE admins SET username = ?, salt = ?, password_hash = ? WHERE id = ?")
            .run(process.env.ADMIN_USERNAME, salt.toString("hex"), hash.toString("hex"), accountToReset.id);
        db.prepare("DELETE FROM sessions WHERE admin_id = ?").run(accountToReset.id);
    } else {
        db.prepare("INSERT INTO admins (username, salt, password_hash) VALUES (?, ?, ?)")
            .run(process.env.ADMIN_USERNAME, salt.toString("hex"), hash.toString("hex"));
    }
}

// Seed an empty catalog and branch list, and initialize default customer-facing settings.
function seedStore() {
    if (db.prepare("SELECT COUNT(*) AS count FROM products").get().count === 0) {
        const products = readLegacyProducts();
        const insertProduct = db.prepare(`
            INSERT INTO products (name, description, category, image, price, original_price, stock, featured, active, sale_percent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const item of products) {
            insertProduct.run(item.name, item.description, item.category, item.image, item.price,
                item.originalPrice, item.stock, item.featured ? 1 : 0, 1, item.salePercent);
        }
    }
    if (db.prepare("SELECT COUNT(*) AS count FROM branches").get().count === 0) {
        const maps = [
            "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3452.74097458715!2d31.34807616080178!3d30.072958417324955!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x145815f8139c47a3%3A0xc1744516bae86a18!2z2LPZitiq2Yog2LPYqtin2LHYsg!5e0!3m2!1sar!2seg!4v1683838527952!5m2!1sar!2seg",
            "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3411.1058393719964!2d29.97014796075231!3d31.245493260779448!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x14f5c52fadf4220f%3A0x7d08dceaad4557bd!2z2LPYp9mGINiz2KrZitmB2KfZhtmIINis2LHYp9mG2K8g2KjZhNin2LLYpw!5e0!3m2!1sar!2seg!4v1683838633704!5m2!1sar!2seg"
        ];
        const insertBranch = db.prepare(
            "INSERT INTO branches (name, address, phone, hours, map_url, active) VALUES (?, ?, ?, ?, ?, 1)"
        );
        insertBranch.run("Alexandria", "Sanstafno Mall, floor 1", "0101234567", "Sunday to Thursday, 10 AM - 10 PM", maps[0]);
        insertBranch.run("Cairo", "City Stars, floor 2", "0101234567", "Sunday to Thursday, 10 AM - 10 PM", maps[1]);
    }
    db.prepare(`
        INSERT OR IGNORE INTO store_settings (id, welcome, opening_hours, phone, whatsapp, email, facebook, instagram)
        VALUES (1, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        "AVELUNE's team is here to help with your custom T-shirt ideas, questions, and orders.",
        "Sunday to Thursday, 10 AM - 10 PM",
        "0101234567",
        "01012578912",
        "Nonline@yahoo.com",
        "",
        ""
    );
    db.prepare("UPDATE store_settings SET welcome = ? WHERE id = 1 AND welcome = ?").run(
        "AVELUNE's team is here to help with your custom T-shirt ideas, questions, and orders.",
        "NoNLINE's team is always there to support you and respond to your inquiries and suggestions."
    );
}

// Prepare admin credentials and initial store data before accepting requests.
await ensureBootstrapAdmin();
seedStore();
db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now());

// Configure Express security headers, JSON request validation, uploads, and admin page routing.
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
    if (req.path.startsWith("/api/admin")) res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-src https://www.google.com https://maps.google.com");
    next();
});
app.use(express.json({ limit: "5mb" }));
app.use((req, res, next) => {
    if (req.path.startsWith("/api/") && ["POST", "PUT", "PATCH"].includes(req.method) &&
        (!req.body || typeof req.body !== "object" || Array.isArray(req.body))) {
        return res.status(400).json({ error: "The request body must be a JSON object." });
    }
    next();
});
app.use("/uploads", express.static(UPLOAD_DIR, { dotfiles: "deny", index: false }));
app.get("/admin", (req, res) => {
    if (req.path === "/admin") return res.redirect(308, "/admin/");
    res.sendFile(path.join(ROOT, "admin", "index.html"));
});

// Track short-lived login and order request limits by client address.
const loginAttempts = new Map();
const orderAttempts = new Map();
function limitOrderRequests(req, res, next) {
    const address = req.ip || req.socket.remoteAddress || "unknown";
    const record = orderAttempts.get(address) || { count: 0, since: Date.now() };
    if (Date.now() - record.since > 15 * 60 * 1000) {
        record.count = 0;
        record.since = Date.now();
    }
    if (record.count >= 10) return res.status(429).json({ error: "Too many orders from this connection. Please try again later." });
    record.count += 1;
    orderAttempts.set(address, record);
    next();
}

// Authenticate admin credentials, throttle failed attempts, and issue a hashed session token.
app.post("/api/admin/login", async (req, res) => {
    const address = req.ip || req.socket.remoteAddress || "unknown";
    const record = loginAttempts.get(address) || { count: 0, since: Date.now() };
    if (Date.now() - record.since > 15 * 60 * 1000) {
        record.count = 0;
        record.since = Date.now();
    }
    if (record.count >= 8) return res.status(429).json({ error: "Too many login attempts. Try again in 15 minutes." });

    const username = typeof req.body.username === "string" ? req.body.username : "";
    const password = typeof req.body.password === "string" ? req.body.password : "";
    if (username.length > 100 || password.length > 256) {
        record.count += 1;
        loginAttempts.set(address, record);
        return res.status(401).json({ error: "The username or password is incorrect." });
    }
    const admin = db.prepare("SELECT * FROM admins WHERE username = ?").get(username);
    let valid = false;
    if (admin) {
        const actual = await scrypt(password, Buffer.from(admin.salt, "hex"), PASSWORD_BYTES);
        valid = crypto.timingSafeEqual(actual, Buffer.from(admin.password_hash, "hex"));
    } else {
        await scrypt(password, crypto.randomBytes(16), PASSWORD_BYTES);
    }
    if (!valid) {
        record.count += 1;
        loginAttempts.set(address, record);
        return res.status(401).json({ error: "The username or password is incorrect." });
    }
    loginAttempts.delete(address);
    const token = crypto.randomBytes(32).toString("base64url");
    db.prepare("INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
        .run(tokenHash(token), admin.id, Date.now() + SESSION_TTL * 1000);
    setSessionCookie(res, token);
    res.json({ username: admin.username });
});

// Verify the admin session cookie and reject expired or unauthenticated admin requests.
function adminOnly(req, res, next) {
    const token = getCookie(req, "nonline_admin");
    if (!token) return res.status(401).json({ error: "Admin sign-in is required." });
    const session = db.prepare(`
        SELECT admins.id AS admin_id, admins.username
        FROM sessions JOIN admins ON admins.id = sessions.admin_id
        WHERE sessions.token_hash = ? AND sessions.expires_at > ?
    `).get(tokenHash(token), Date.now());
    if (!session) {
        clearSessionCookie(res);
        return res.status(401).json({ error: "Your admin session expired. Sign in again." });
    }
    req.admin = session;
    next();
}

// Reject cross-origin state-changing requests to protect authenticated actions.
function sameOrigin(req, res, next) {
    const origin = req.get("origin");
    if (origin) {
        try {
            if (new URL(origin).host !== req.get("host")) return res.status(403).json({ error: "Cross-origin requests are not allowed." });
        } catch {
            return res.status(403).json({ error: "Invalid request origin." });
        }
    }
    next();
}

// Verify the current password, update admin credentials, and rotate active sessions.
app.put("/api/admin/account", sameOrigin, adminOnly, async (req, res) => {
    const { currentPassword, newUsername, newPassword, confirmPassword } = req.body;
    if (typeof currentPassword !== "string" || currentPassword.length === 0 || currentPassword.length > 256) {
        return res.status(400).json({ error: "Enter your current password to confirm this change." });
    }
    if (typeof newUsername !== "string" || typeof newPassword !== "string" || typeof confirmPassword !== "string") {
        return res.status(400).json({ error: "Account fields must be text values." });
    }
    const username = newUsername.trim();
    if (username.length > 100) return res.status(400).json({ error: "Username must be 100 characters or fewer." });
    if (newPassword.length > 256 || confirmPassword.length > 256) {
        return res.status(400).json({ error: "Password must be 256 characters or fewer." });
    }
    if (newPassword && newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters long." });
    }
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ error: "New password and confirmation do not match." });
    }
    if (!username && !newPassword) {
        return res.status(400).json({ error: "Enter a new username or password." });
    }

    const admin = db.prepare("SELECT id, username, salt, password_hash FROM admins WHERE id = ?")
        .get(req.admin.admin_id);
    if (!admin) return res.status(401).json({ error: "Admin account not found. Sign in again." });
    const currentHash = await scrypt(currentPassword, Buffer.from(admin.salt, "hex"), PASSWORD_BYTES);
    if (!crypto.timingSafeEqual(currentHash, Buffer.from(admin.password_hash, "hex"))) {
        return res.status(403).json({ error: "Current password is incorrect." });
    }
    const nextUsername = username || admin.username;
    if (nextUsername !== admin.username && db.prepare("SELECT id FROM admins WHERE username = ? AND id != ?")
        .get(nextUsername, admin.id)) {
        return res.status(409).json({ error: "That username is already in use." });
    }

    const salt = newPassword ? crypto.randomBytes(16) : Buffer.from(admin.salt, "hex");
    const passwordHash = newPassword
        ? await scrypt(newPassword, salt, PASSWORD_BYTES)
        : Buffer.from(admin.password_hash, "hex");
    const token = crypto.randomBytes(32).toString("base64url");
    db.exec("BEGIN IMMEDIATE");
    try {
        db.prepare("UPDATE admins SET username = ?, salt = ?, password_hash = ? WHERE id = ?")
            .run(nextUsername, salt.toString("hex"), passwordHash.toString("hex"), admin.id);
        db.prepare("DELETE FROM sessions WHERE admin_id = ?").run(admin.id);
        db.prepare("INSERT INTO sessions (token_hash, admin_id, expires_at) VALUES (?, ?, ?)")
            .run(tokenHash(token), admin.id, Date.now() + SESSION_TTL * 1000);
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    setSessionCookie(res, token);
    res.json({ username: nextUsername });
});

// End the current admin session and expose the signed-in account identity.
app.post("/api/admin/logout", sameOrigin, adminOnly, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(getCookie(req, "nonline_admin")));
    clearSessionCookie(res);
    res.json({ ok: true });
});
app.get("/api/admin/me", adminOnly, (req, res) => res.json({ username: req.admin.username }));

// Public catalog, branch, and store-setting endpoints used by the customer storefront.
app.get("/api/products", (req, res) => {
    const params = [];
    let query = "SELECT id, name, description, category, image, price, original_price AS originalPrice, sale_percent AS salePercent, stock, featured, created_at AS createdAt FROM products WHERE active = 1";
    if (["men", "women", "children"].includes(req.query.category)) {
        query += " AND category = ?";
        params.push(req.query.category);
    }
    if (req.query.featured === "true") query += " AND featured = 1";
    query += " ORDER BY id";
    res.json(db.prepare(query).all(...params));
});

app.get("/api/branches", (_req, res) => {
    res.json(db.prepare("SELECT id, name, address, phone, hours, map_url AS mapUrl FROM branches WHERE active = 1 ORDER BY id").all());
});

app.get("/api/settings", (_req, res) => {
    res.json(db.prepare(`
        SELECT welcome, opening_hours AS openingHours, phone, whatsapp, email, facebook, instagram
        FROM store_settings WHERE id = 1
    `).get());
});

// Admin-only product and image-library endpoints for inventory management.
app.get("/api/admin/products", adminOnly, (_req, res) => {
    res.json(db.prepare("SELECT id, name, description, category, image, price, original_price AS originalPrice, sale_percent AS salePercent, stock, featured, active FROM products ORDER BY id DESC").all());
});

app.get("/api/admin/images/library", adminOnly, (_req, res) => {
    const localImages = fs.readdirSync(path.join(ROOT, "images"), { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name))
        .map((entry) => `/images/${entry.name}`);
    const uploadedImages = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true })
        .filter((entry) => entry.isFile() && /\.(?:jpe?g|png|webp)$/i.test(entry.name))
        .map((entry) => `/uploads/${entry.name}`);
    res.json([...localImages, ...uploadedImages]);
});

// Create, edit, discount, and archive catalog products from the admin dashboard.
app.post("/api/admin/products", sameOrigin, adminOnly, (req, res) => {
    try {
        const product = productPayload(req.body);
        const result = db.prepare(`
            INSERT INTO products (name, description, category, image, price, original_price, stock, featured, active, sale_percent)
            VALUES (@name, @description, @category, @image, @price, @originalPrice, @stock, @featured, @active, @salePercent)
        `).run(product);
        res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put("/api/admin/products/:id", sameOrigin, adminOnly, (req, res) => {
    try {
        const product = productPayload(req.body);
        const result = db.prepare(`
            UPDATE products SET name = @name, description = @description, category = @category, image = @image,
                price = @price, original_price = @originalPrice, stock = @stock, featured = @featured, active = @active,
                sale_percent = @salePercent,
                updated_at = CURRENT_TIMESTAMP WHERE id = @id
        `).run({ ...product, id: number(req.params.id, "Product ID", { min: 1, integer: true }) });
        if (!result.changes) return res.status(404).json({ error: "Product not found." });
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put("/api/admin/products/:id/sale", sameOrigin, adminOnly, (req, res) => {
    let id;
    try {
        id = number(req.params.id, "Product ID", { min: 1, integer: true });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const product = db.prepare("SELECT id, active, original_price FROM products WHERE id = ?").get(id);
    if (!product) return res.status(404).json({ error: "Product not found." });
    let percent;
    try {
        percent = number(req.body.percent, "Sale percentage", { min: 0, max: 99, integer: true });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    if (percent > 0 && !product.active) return res.status(400).json({ error: "Activate this product before putting it on sale." });
    if (percent > 0 && product.original_price <= 0) {
        return res.status(400).json({ error: "Set a regular price greater than zero before putting this product on sale." });
    }
    const salePrice = percent > 0
        ? Math.round(product.original_price * (100 - percent)) / 100
        : product.original_price;
    if (percent > 0 && salePrice >= product.original_price) {
        return res.status(400).json({ error: "The discount is too small to change this product's price." });
    }
    db.prepare(`
        UPDATE products SET price = ?, sale_percent = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(salePrice, percent, id);
    res.json({ ok: true, price: salePrice, salePercent: percent });
});

app.delete("/api/admin/products/:id", sameOrigin, adminOnly, (req, res) => {
    let id;
    try {
        id = number(req.params.id, "Product ID", { min: 1, integer: true });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const result = db.prepare("UPDATE products SET active = 0, featured = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(id);
    if (!result.changes) return res.status(404).json({ error: "Product not found." });
    res.json({ ok: true });
});

// Create, edit, and archive branches, and update customer-facing store settings.
app.get("/api/admin/branches", adminOnly, (_req, res) => {
    res.json(db.prepare("SELECT id, name, address, phone, hours, map_url AS mapUrl, active FROM branches ORDER BY id").all());
});

app.post("/api/admin/branches", sameOrigin, adminOnly, (req, res) => {
    try {
        const branch = branchPayload(req.body);
        const result = db.prepare(`
            INSERT INTO branches (name, address, phone, hours, map_url, active)
            VALUES (@name, @address, @phone, @hours, @map_url, @active)
        `).run(branch);
        res.status(201).json({ id: Number(result.lastInsertRowid) });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

app.put("/api/admin/branches/:id", sameOrigin, adminOnly, (req, res) => {
    try {
        const branch = branchPayload(req.body);
        const result = db.prepare(`
            UPDATE branches SET name = @name, address = @address, phone = @phone, hours = @hours,
                map_url = @map_url, active = @active WHERE id = @id
        `).run({ ...branch, id: number(req.params.id, "Branch ID", { min: 1, integer: true }) });
        if (!result.changes) return res.status(404).json({ error: "Branch not found." });
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Toggle whether a branch is included in the public customer-facing branch list.
app.patch("/api/admin/branches/:id/visibility", sameOrigin, adminOnly, (req, res) => {
    let id;
    let active;
    try {
        id = number(req.params.id, "Branch ID", { min: 1, integer: true });
        active = bool(req.body.active, "Visible to customers");
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const result = db.prepare("UPDATE branches SET active = ? WHERE id = ?").run(active, id);
    if (!result.changes) return res.status(404).json({ error: "Branch not found." });
    res.json({ ok: true, active: Boolean(active) });
});

app.delete("/api/admin/branches/:id", sameOrigin, adminOnly, (req, res) => {
    let id;
    try {
        id = number(req.params.id, "Branch ID", { min: 1, integer: true });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const result = db.prepare("UPDATE branches SET active = 0 WHERE id = ?").run(id);
    if (!result.changes) return res.status(404).json({ error: "Branch not found." });
    res.json({ ok: true });
});

// Permanently delete a branch when the admin explicitly requests removal.
app.delete("/api/admin/branches/:id/permanent", sameOrigin, adminOnly, (req, res) => {
    let id;
    try {
        id = number(req.params.id, "Branch ID", { min: 1, integer: true });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    const result = db.prepare("DELETE FROM branches WHERE id = ?").run(id);
    if (!result.changes) return res.status(404).json({ error: "Branch not found." });
    res.json({ ok: true });
});

app.put("/api/admin/settings", sameOrigin, adminOnly, (req, res) => {
    try {
        const settings = {
            welcome: text(req.body.welcome, "Welcome message", 500),
            openingHours: text(req.body.openingHours, "Opening hours", 120),
            phone: text(req.body.phone, "Phone", 40),
            whatsapp: text(req.body.whatsapp, "WhatsApp", 40),
            email: text(req.body.email, "Email", 120),
            facebook: text(req.body.facebook ?? "", "Facebook URL", 300),
            instagram: text(req.body.instagram ?? "", "Instagram URL", 300)
        };
        for (const field of ["facebook", "instagram"]) {
            if (settings[field] && !/^https:\/\/.+/.test(settings[field])) throw new Error(`${field} must be an HTTPS URL.`);
        }
        db.prepare(`
            UPDATE store_settings SET welcome = @welcome, opening_hours = @openingHours, phone = @phone,
                whatsapp = @whatsapp, email = @email, facebook = @facebook, instagram = @instagram WHERE id = 1
        `).run(settings);
        res.json({ ok: true });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// List orders for administrators and update order status while restoring cancelled stock.
app.get("/api/admin/orders", adminOnly, (_req, res) => {
    const orders = db.prepare("SELECT * FROM orders ORDER BY id DESC").all();
    const itemsByOrder = db.prepare(`
        SELECT product_name AS productName, quantity, unit_price AS unitPrice, item_message AS itemMessage
        FROM order_items WHERE order_id = ? ORDER BY id
    `);
    res.json(orders.map((order) => ({ ...order, items: itemsByOrder.all(order.id) })));
});

app.put("/api/admin/orders/:id/status", sameOrigin, adminOnly, (req, res) => {
    const status = req.body.status;
    if (!["pending", "confirmed", "shipped", "delivered", "cancelled"].includes(status)) {
        return res.status(400).json({ error: "Choose a valid order status." });
    }
    let orderId;
    try {
        orderId = number(req.params.id, "Order ID", { min: 1, integer: true });
    } catch (error) {
        return res.status(400).json({ error: error.message });
    }
    db.exec("BEGIN IMMEDIATE");
    try {
        const updateStatus = db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status != 'cancelled'");
        const result = updateStatus.run(status, orderId);
        if (!result.changes) {
            db.exec("ROLLBACK");
            return res.status(404).json({ error: "Order not found, or it has already been cancelled." });
        }
        if (status === "cancelled") {
            const items = db.prepare("SELECT product_id, quantity FROM order_items WHERE order_id = ?").all(orderId);
            const increaseStock = db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
            for (const item of items) if (item.product_id) increaseStock.run(item.quantity, item.product_id);
        }
        db.exec("COMMIT");
    } catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    res.json({ ok: true });
});

// Validate customer orders and garment options, calculate totals, and reserve stock transactionally.
app.post("/api/orders", sameOrigin, limitOrderRequests, async (req, res) => {
    try {
        const customerName = text(req.body.customerName, "Name", 100);
        const email = text(req.body.email, "Email", 254).toLowerCase();
        const phone = text(req.body.phone, "Phone", 40);
        const address = text(req.body.address, "Delivery address", 300);
        const note = text(req.body.note ?? "", "Order note", 500);
        if (!customerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            !/^[+()\d\s.-]{7,40}$/.test(phone) || !address) {
            throw new Error("Enter your name, a valid email address, phone number, and delivery address.");
        }
        if (!Array.isArray(req.body.items) || req.body.items.length < 1 || req.body.items.length > 50) {
            throw new Error("Your cart is empty or contains too many different products.");
        }
        const itemsById = new Map();
        for (const item of req.body.items) {
            const id = number(item.id, "Product ID", { min: 1, integer: true });
            const quantity = number(item.quantity, "Quantity", { min: 1, max: 99, integer: true });
            const message = text(item.message ?? "", "Product message", 500);
            const size = text(item.size ?? "", "Clothing size", 10);
            const color = text(item.color ?? "", "Clothing color", 30);
            const print = text(item.print ?? "", "Print style", 30);
            const validColors = new Set(["", "White", "Black", "Natural", "Sage", "Navy", "Rose"]);
            const printPrices = { "": 0, none: 0, front: 250, back: 250, "front-back": 400, embroidered: 500 };
            if ((!ADULT_SIZES.has(size) && !CHILD_SIZES.has(size)) || !validColors.has(color) || !Object.hasOwn(printPrices, print)) {
                throw new Error("Choose a valid clothing size, color, and print style.");
            }
            const sizePrice = size === "2XL" ? 100 : size === "3XL" ? 200 : 0;
            const variantKey = [id, size, color, print, message].join(":");
            const existing = itemsById.get(variantKey);
            const totalQuantity = (existing?.quantity || 0) + quantity;
            if (totalQuantity > 99) throw new Error("You can order up to 99 of each product at a time.");
            if (existing && message && !existing.messages.includes(message)) {
                existing.messages.push(message);
            } else if (!existing) {
                itemsById.set(variantKey, {
                    id, quantity, size, color, print,
                    optionsPrice: sizePrice + printPrices[print],
                    messages: message ? [message] : []
                });
                continue;
            }
            existing.quantity = totalQuantity;
        }

        let receiptOrderId;
        let receiptTotal;
        let receiptItems;
        db.exec("BEGIN IMMEDIATE");
        try {
            const selectProduct = db.prepare("SELECT id, name, category, price, stock FROM products WHERE id = ? AND active = 1");
            const insertOrder = db.prepare("INSERT INTO orders (customer_name, customer_email, phone, address, note, total) VALUES (?, ?, ?, ?, ?, ?)");
            const insertItem = db.prepare(`
                INSERT INTO order_items (order_id, product_id, product_name, quantity, unit_price, item_message)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            const takeStock = db.prepare("UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?");
            const items = [];
            let total = 0;
            for (const item of itemsById.values()) {
                const variantDescription = [
                    item.size && `Size: ${item.size}`,
                    item.color && `Color: ${item.color}`,
                    item.print && item.print !== "none" && `Print: ${{ front: "Heat-press front", back: "Heat-press back", "front-back": "Heat-press front + back", embroidered: "Embroidery" }[item.print]}`
                ].filter(Boolean).join(" · ");
                const itemMessage = [variantDescription, ...item.messages].filter(Boolean).join("\n");
                const product = selectProduct.get(item.id);
                if (!product) throw new Error("One of the products in your cart is no longer available.");
                if (product.category === "children" ? !CHILD_SIZES.has(item.size) : !ADULT_SIZES.has(item.size)) {
                    throw new Error(`Choose a valid ${product.category === "children" ? "children's" : "adult"} size for ${product.name}.`);
                }
                if (product.stock < item.quantity) throw new Error(`${product.name} does not have enough stock for this order.`);
                const unitPrice = product.price + item.optionsPrice;
                items.push({ product, quantity: item.quantity, itemMessage, unitPrice });
                total += unitPrice * item.quantity;
            }
            const order = insertOrder.run(customerName, email, phone, address, note, Number(total.toFixed(2)));
            for (const item of items) {
                insertItem.run(order.lastInsertRowid, item.product.id, item.product.name, item.quantity, item.unitPrice, item.itemMessage);
                if (!takeStock.run(item.quantity, item.product.id, item.quantity).changes) {
                    throw new Error(`Stock for ${item.product.name} changed while creating your order. Please try again.`);
                }
            }
            receiptOrderId = Number(order.lastInsertRowid);
            receiptTotal = Number(total.toFixed(2));
            receiptItems = items;
            db.exec("COMMIT");
        } catch (error) {
            db.exec("ROLLBACK");
            throw error;
        }
        let receiptSent = false;
        let receiptMessage = "Your order is confirmed, but receipt email is not configured. Please contact the store with your order number.";
        if (mailTransport) {
            try {
                receiptSent = await sendOrderReceipt({
                    email, customerName, phone, address,
                    orderId: receiptOrderId, total: receiptTotal, items: receiptItems
                });
                receiptMessage = "";
            } catch (error) {
                console.error(`Receipt email delivery failed for order #${receiptOrderId}:`, error.message);
                receiptMessage = "Your order is confirmed, but we couldn't email the receipt. Please contact the store with your order number.";
            }

            const storeEmail = db.prepare("SELECT email FROM store_settings WHERE id = 1").get()?.email?.trim();
            if (storeEmail) {
                try {
                    await sendNewOrderNotification({
                        storeEmail, customerEmail: email, customerName, phone, address, note,
                        orderId: receiptOrderId, total: receiptTotal, items: receiptItems
                    });
                } catch (error) {
                    console.error(`New-order notification email failed for order #${receiptOrderId}:`, error.message);
                }
            } else {
                console.error(`New-order notification email skipped for order #${receiptOrderId}: set the store contact email in Admin → Store details.`);
            }
        }
        res.status(201).json({
            orderId: receiptOrderId,
            total: receiptTotal,
            email,
            receiptSent,
            receiptMessage
        });
    } catch (error) {
        res.status(400).json({ error: error.message });
    }
});

// Validate uploaded image data and file signatures before storing product images.
app.post("/api/admin/images", sameOrigin, adminOnly, (req, res) => {
    const image = typeof req.body.imageData === "string" ? req.body.imageData : "";
    const match = image.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
    if (!match) return res.status(400).json({ error: "Upload a JPG, PNG, or WebP image." });
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.length > 3 * 1024 * 1024) return res.status(413).json({ error: "Images must be smaller than 3 MB." });
    const validSignature = match[1] === "png"
        ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : match[1] === "jpeg"
            ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
            : bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    if (!validSignature) return res.status(400).json({ error: "The selected file is not a valid image." });
    const extension = match[1] === "jpeg" ? "jpg" : match[1];
    const fileName = `${crypto.randomUUID()}.${extension}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, fileName), bytes, { flag: "wx" });
    res.status(201).json({ image: `/uploads/${fileName}` });
});

// Block access to server and dependency files, serve storefront assets, and format API errors.
app.use((req, res, next) => {
    if (req.path === "/server.mjs" || req.path === "/package.json" || req.path === "/package-lock.json" ||
        req.path === "/README.md" || req.path.startsWith("/node_modules/")) {
        return res.sendStatus(404);
    }
    next();
});
app.use(express.static(ROOT, { dotfiles: "deny", index: "index.html", maxAge: 0 }));
app.use((error, _req, res, _next) => {
    console.error(error);
    if (error instanceof SyntaxError && "body" in error) {
        return res.status(400).json({ error: "The request body contains invalid JSON." });
    }
    if (error.type === "entity.too.large") {
        return res.status(413).json({ error: "The request body is too large." });
    }
    res.status(500).json({ error: "An unexpected server error occurred." });
});

// Start the store server and close the HTTP listener and database cleanly on shutdown.
const server = app.listen(PORT, () => {
    console.log(`AVELUNE store running at http://localhost:${PORT}`);
    console.log(`SQLite database: ${DB_PATH}`);
    if (!mailTransport) console.warn("Receipt emails are disabled: configure SMTP settings in .env.");
});

function shutdown() {
    server.close(() => {
        db.close();
        process.exit(0);
    });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
