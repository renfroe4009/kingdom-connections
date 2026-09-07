# Kingdom Connections

A nonprofit CRM: contacts/organizations, donations, memberships, events,
a donor portal, invoicing/recurring billing, and a visual website builder
for the public-facing site.

- `server/` — Express + MySQL API
- `client/` — React + Vite app (admin CRM, donor portal, and the public site)

## Prerequisites

- Node.js 18+
- MySQL 8.x running locally (or reachable over the network)

## First-time setup

1. **Install dependencies**

   ```bash
   cd server && npm install
   cd ../client && npm install
   ```

2. **Create the database**

   ```bash
   mysql -u root -e "CREATE DATABASE kingdom_connections"
   ```

3. **Configure environment files**

   ```bash
   cp server/.env.example server/.env
   cp client/.env.example client/.env
   ```

   Edit `server/.env`:
   - `DB_HOST` / `DB_PORT` / `DB_USER` / `DB_PASSWORD` / `DB_NAME` — point at the database from step 2.
   - `JWT_SECRET` — any random string 16+ characters (e.g. `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`).
   - `PORT` — the port the API listens on (defaults expect `4000`; the README below uses `4000`/`5173`, adjust both `.env` files together if you pick different ports).
   - `CLIENT_ORIGIN` — the client's dev URL, e.g. `http://localhost:5173`.
   - Everything else (SMTP, ConnectWise, Valor, Anthropic) is optional for local dev — those features just no-op or fall back until configured.

   `client/.env` only needs adjusting if you're not using the default ports.

4. **Load the schema and seed data**

   ```bash
   cd server
   npm run db:schema   # creates all tables (structure only, no data)
   npm run db:seed     # roles/permissions, a placeholder business profile, one admin login
   ```

5. **Run both apps** (in separate terminals)

   ```bash
   cd server && npm run dev     # API on the PORT set in server/.env
   cd client && npm run dev     # Vite dev server on VITE_PORT (default 5173)
   ```

6. **Log in**

   Visit the client URL and sign in with the seeded admin account:
   - Email: `admin@localcrm.local`
   - Password: `ChangeMe123!`

   Change this password after logging in, and fill in your organization's
   real details under **Settings → Business** — that drives branding across
   the app, emails, and PDF receipts/statements.

## Notes

- `db/schema.sql` and `db/seed.sql` are regenerated snapshots, not a
  migration history — there's no incremental migrations directory. If the
  schema changes going forward, regenerate `db/schema.sql` via `mysqldump`
  (see the comment at the top of that file) rather than hand-editing it.
- `server/scripts/ensure-*.js` are one-off idempotent scripts used during
  development to add columns to an already-running database without
  re-importing the whole schema. A fresh install via `db:schema` already
  includes everything they add — you don't need to run them.
- The server self-seeds its email templates and knowledge-base articles on
  first boot (you'll see `[templateSeeder]` / KB log lines) — nothing to do
  there.
- `server/uploads/` (local media) isn't included — the app works without it;
  file uploads just start empty.
