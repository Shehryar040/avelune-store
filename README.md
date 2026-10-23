# AVELUNE store

AVELUNE is a custom clothing storefront for children, women, and men, served by Node.js. Customers choose catalog garments, sizes, colors, and heat-press print placements, then describe their requested design. Express and SQLite store products, branch details, contact information, admin sessions, and cash-on-delivery orders.

All product prices, order totals, and admin price displays use Pakistani rupees (PKR). Product price values are interpreted as PKR; changing the display currency does not convert existing amounts.

## Requirements

- Node.js 22.5 or newer
- npm

## First-time setup

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env`.
3. Set a unique admin password (at least 8 characters) and a random session secret (at least 32 characters) in `.env`.
4. Start the application with `npm start`. Node's watch mode restarts the server automatically when `server.mjs` changes.
5. Open `http://localhost:3000/admin` and sign in with the environment-configured admin username and password. The public Login link also leads to the admin sign-in page.

To email customers their order receipts and notify the store when a new order arrives, configure these SMTP settings in `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM`. Use your email provider's SMTP server details and an authorized sender address. `SMTP_USER` and `SMTP_PASSWORD` may both be left blank only if the SMTP server does not require authentication. Set the recipient for new-order notifications in **Admin → Store details → Email**. Without SMTP settings, customers can still place orders, but receipts and store notifications cannot be emailed.

Keep the Node.js server running while using the admin panel. Do not open `admin/index.html` directly as a local file; the admin API is served by the Node.js application.

The customer journey is the landing page → clothing collection → custom product page → bag → checkout. The homepage includes a direct custom-order call to action; customers can choose an available garment, select its size and color, describe a heat-press design, and add the custom item to their bag. The collection is filtered by the existing Children, Women, and Men product categories. The customizer offers baby (0–24 months), children's (2–14 years), and adult XS–3XL sizes, color choices, front/back/both heat-press print placements, and a required design note whenever a heat-press print is selected. Checkout collects a customer email for the receipt and is connected to the cash-on-delivery order API; sizes and print upgrades are priced and validated by the server.

Generate a suitable session secret with `openssl rand -hex 32`. Do not commit `.env` or use the example credentials for a public deployment. Use HTTPS in production so the admin session cookie is secure.

On first start, the server imports the existing catalogue and adds the Alexandria and Cairo branches. Data is stored in `~/.nonline-store/store.sqlite`; uploaded product images are stored alongside it. Set `DATA_DIR` to use a different persistent directory.

The existing `~/.nonline-store` data directory name is intentionally retained so an upgrade keeps the current products, sales, customers' orders, and admin account.

To change the admin username or password while signed in, open **Account security** in the admin dashboard, enter your current password, then provide the new username and/or password. New passwords must be at least 8 characters. Other active admin sessions are signed out after an account change. To reset credentials from the environment instead, set the new values in `.env`, set `RESET_ADMIN_PASSWORD=true`, and start the server once. Remove the reset flag afterward; the reset invalidates current admin sessions. Products, branches, and orders are not removed by this operation.

## Admin features

- Add, edit, feature, archive, price, and stock products; choose an existing image or upload a JPG, PNG, or WebP image.
- Active products assigned to the Men, Women, or Children category appear in the AVELUNE clothing collection and customizer.
- Manage product sales in the admin Sales section with whole-number percentage discounts from 1% to 99%; sale prices are calculated from the regular price and can be ended at any time.
- Manage branch names, addresses, phone numbers, opening hours, and optional Google Maps embed URLs.
- Update public store contact details and social links.
- Change the admin username and password after verifying the current password.
- Accept cash-on-delivery orders, review customer and delivery details, email a receipt to the customer's checkout address and a new-order notification to the store contact email when SMTP is configured, and update fulfilment status. Cancelling an order restores its reserved product stock.
- Customers can describe their requested heat-press design, print colors, and placement in an optional product message; messages are saved with the order item and shown in the admin order list and details.
- Revalidate product availability, stock, and totals on the server when an order is placed.

The initial checkout supports cash on delivery only; it does not process online payments.
