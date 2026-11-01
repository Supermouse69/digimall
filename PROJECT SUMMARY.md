# DigiMall: full project summary (for continuing in a new chat)

Written 2026-11-01 at the end of a long Claude Code session. It covers everything we did, every
decision you made, where things are, and what's left.
**This file has NO passwords or secrets.** They live only in your local `.env` files and password manager.

> **For the next Claude:** read `CLAUDE.md` in the repo first (it's the rulebook and holds every
> decision). This file is the story of how we got here and what's left.

---

## 1. What DigiMall is

A local "digital mall" for **Calumpit, Bulacan** (barangays San Marcos, Balite, Sergio Bayan, Buguion):
neighborhood stores sell to buyers, and local **tricycle riders** deliver. *"Mini Shopee + mini Grab for the barangay."*

- **Beta money rules:** the buyer pays each store directly by **GCash QR** (manual) and uploads the receipt. The delivery fee is **cash to the rider**. DigiMall charges **no fees** and never holds money.
- **Roles (one per account):** `buyer`, `seller`, `rider`, `super-admin`.
- **Domain:** digimall.online (Cloudflare Registrar, DNS on Cloudflare).
- **Repo:** https://github.com/Supermouse69/digimall (local: `C:\Users\Moises\digimall`)

### Tech stack (real versions)
- **Next.js 16.4.3** (App Router; `proxy.ts` replaces middleware), **React 19.3.1**
- **Payload CMS 3.92.1** (runs inside Next.js) + multi-tenant plugin
- **MongoDB Atlas** (Singapore). The dev database is `digimall-dev`.
- **tRPC 11** + TanStack Query, zod 4, Tailwind v4 + shadcn/ui
- **Leaflet + OpenStreetMap** (maps), **web-push** (phone notifications)
- Package manager: **bun**. Windows PC (Git Bash + PowerShell).

---

## 2. How we worked (keep doing this)

- **CLAUDE.md is the rulebook:**
  - Ask before touching critical things (auth, database, env vars, config, dependencies).
  - Never commit secrets.
  - Never push to `main`.
  - Never write legal text.
  - Follow PH law (Data Privacy Act, Internet Transactions Act, BIR rules).
  - Talk in simple English.
- **One git branch per phase, stacked on each other** (each starts from the previous one). Commit before/after every change.
- **Suggestions folder** (`suggestions/`): critical issues/proposals as `.txt` files, plus a **check list per phase** (`suggestions/check_phaseN/`, `suggestions/tobedone/`) for you to test by hand.
- **Obsidian notes** (CLAUDE.md §17): `C:\Users\Moises\Desktop\MOISES\Digimall Notes`
  - `Code Map/` mirrors the code folders (one note per file; 265 notes now).
  - `Code Map/_Index.md` has the overview + diagrams.
  - `Claude Logs/` has one note per task (history in `0000 - Project History.md`).
  - Refresh the link structure with `bun run notes:map`.
- **Your dev server runs on port 3000. Claude tests on port 3123** and never kills your server.
- **Tests:** "done" = typecheck + lint + build pass + tests pass. 19 automatic test suites exist (section 6).

---

## 3. What we built, phase by phase

### Phase 0: Audit (read-only)
Compared the tutorial code (`code-with-antonio/next15-multitenant-ecommerce`) with CLAUDE.md. Found:
security holes (old Next/Payload versions with known advisories, **anyone could make themselves
super-admin**), Stripe leftovers, subdomain routing, missing features. We wrote suggestion files:
- security patches, the super-admin takeover
- confirm the tutorial code license (it has **no LICENSE file**: confirm before going commercial)
- real photos in the public repo, replace the demo admin account

### Phase 1: Cleanup + security baseline (`phase-1-cleanup`)
- Upgraded Next.js / React / Payload to patched versions.
- **Fixed "anyone can become super-admin":** deny-by-default access rules for every collection (`src/lib/access.ts`).
- Removed Stripe, fake ratings, the tutorial refund text, junk files and mock photos. GraphQL off. Env cleanup.
- Moved the code into `src/`. Lint clean. Peso format.
- Dev helpers: `bun run seed:mock` (mock products), a temporary **Log out** button.

### Phase 2: Roles & auth (`phase-2-roles-auth`)
- **2a:** one `role` per account (migration from the old `roles` array) + login sends each role to its home. Safe redirects (can't be sent to other sites).
- **2b:**
  - **Settings** (admin-editable: barangays, service area center + radius, minimum age, key points).
  - **Legal pages** as blank placeholders that **you** write: `terms-buyer`, `terms-seller`, `terms-rider`, `privacy`.
  - **Buyer sign-up:** name, email, phone, password, barangay, address, map pin, consent + age checkboxes, plus a re-consent page when a document version changes.
- **2c:** email verification + forgot/reset password. In dev, emails print in the `bun run dev` terminal (with the links).
- **2d:**
  - **Private files** (only the owner + super-admin; every admin view logged).
  - **Audit log** (append-only, nobody can edit it).
  - **Invites:** the super-admin creates sellers/riders; they get a 7-day "set your password" link.
  - **Rider profiles** + documents (LTO license, MTOP franchise) + the rider portal `/rider`.
- **2e: Super-admin hardening.**
  - Super-admins can't log in at `/login` or `/admin/login`. They use a **hidden page `/admin-entry/<ADMIN_ENTRY_PATH>`** with email + password + **authenticator app code** (TOTP 2FA, 10 backup codes).
  - The secret path is in `.env` (`ADMIN_ENTRY_PATH`).
  - Emergency reset: `bun run admin:reset-2fa <email> [--new-password]`.
- **2f: Bot protection.** **Cloudflare Turnstile** ("I'm not a robot") on sign-up, login, forgot password, resend email and admin login, plus **rate limits** stored in MongoDB (login 10/15 min per IP, etc.). Payload's own `/api/users/login` is limited too.
- Fix along the way: accounts made before email verification couldn't stay logged in (migration).
- **Key points text** (your own words) saved in CLAUDE.md §8 and in Settings (sign-up box "Before you join", checkout box "Quick reminders").

### Phase 3: Stores & products (`phase-3-stores-products`)
- **Store status:**
  - **Pending** (hidden) → **Unverified store** / **"Business permit checked"** (green badge) → **Suspended** (hidden).
  - Beta decision: only a Mayor's/business permit **or barangay business clearance** is needed for the badge. BIR/DTI uploads are optional slots.
  - **No product/order limits** for unverified stores during beta.
- **Store details:**
  - Shown to buyers: owner/business name, barangay, address, map pin, hours, logo, banner, "On DigiMall since".
  - Private: phone, GCash QR + approval, permit, BIR, DTI.
  - **Never shown:** permit numbers, TIN, IDs, owner phone/email.
- **GCash QR must be approved** by the super-admin; changing the QR removes the approval (anti QR-swap scam).
- **Products:**
  - **whole-peso prices** (no centavos; you decided ₱25, not ₱24.50)
  - Available / Not available switch, "Hidden by admin" + reason, category required (admin whitelist)
  - **Tags removed.**
- **Store pages moved** `/tenants/<slug>` → **`/store/<slug>`** (old links redirect). Hidden stores/products = "not found".
- Home: stores grouped by barangay, a **working search**, honest sort (Newest / Price ↑ / Price ↓; the fake "Trending" is gone).
- **Fixed 2 leaks:**
  - The API showed hidden stores.
  - tRPC skipped access rules, so private store fields leaked inside products. Public store data is now a strict allowlist.
- **Minimal reports:** a "Report this product/store" link; logged-in users only; 5/hour; only the super-admin sees them.

### Phase 4: Chat (on `phase-3-stores-products`)
- **Chat head:** a floating chat bubble like Lazada/Shopee on every page for buyers and sellers, and a **seller bubble inside the Payload admin**. Full page at `/chat`.
- One chat per buyer + store. Product cards, **private photos** (only that chat can see them), unread badges.
- "Realtime" = checking every ~4 s while open (nothing while the tab is hidden).
- Stores see the buyer's **optional username** (new sign-up field) or **first name only**.
- **Only reported chats** can be read by the super-admin (each view logged).
- **Deleted after 90 days** (Settings). Reported chats are kept. Endpoint `/api/cron/chat-cleanup` (protected by `CRON_SECRET`) + `bun run chat:cleanup`.

### Phase 5: Cart & checkout (on `phase-3-stores-products`)
- Cart per store with quantities, **max 3 stores** (Settings).
- **Checkout:**
  - Casual 🟢 / Fast 🔴, barangay, address, map pin, notes per store + rider note.
  - **Estimated delivery fee from the Fares table** (you enter the rider org's rates).
  - Your "Quick reminders", and "Order Summary — not an official receipt/invoice".
- **One order `DM-XXXX`** (no 0/O/1/I) + **one store order per store** (`DM-XXXX-A`, `-B`). An **order card** is posted in each store chat. Confirmation email.
- **Flow:**
  1. The store confirms (only with an approved GCash QR).
  2. The buyer sees the QR, pays, and uploads a receipt (+ reference no.); the timer stops.
  3. The store taps **Payment received** (or "Not received", which flags it).
- **Timers** (Settings): 10 min for the store to confirm, 10 min for the buyer to pay. They're checked whenever anyone looks ("lazy timers").
- **Book a rider only when every store order is PAID** (your decision).
- Seller **📦 Orders board** (tile grid, like your old Sheets site) + a 📦 bubble in the admin.
- Store edits to orders: **postponed** (confirm or cancel only).

### Phase 6: Riders, trips, push (`phase-6-riders`)
- **Rider portal `/rider`:**
  - phone, **Go Active** (location sent ~every 25 s while Active + the page is open; only the latest point is kept; deleted when off)
  - request card with a 2-min countdown
  - **trip view** (map, stops, call store/buyer, landmark photo, trip chat)
  - **Delivered + confirm the cash fee** (your decision), **trip history** (earnings)
  - Installable app (manifest + icons).
- **Buyer booking:**
  - A list of Active, approved riders with a fresh location: first name, photo, "~0.8 km".
  - **Request** or **Auto-pick nearest** (moves to the next rider on decline/timeout).
  - After accept: rider card, **call buttons (trip only, your decision)**, a live map, trip chat.
  - After delivery, phones/map/address disappear and the trip chat becomes read-only.
- **Phone notifications (web push, VAPID keys in `.env`):** new orders/chats → sellers, ride requests → riders, status updates → buyers. "Turn on notifications" buttons. iPhone needs "Add to Home Screen".

### Phase 7: Cancellations & refunds (`phase-7-refunds`)
- Paid store orders can be cancelled **until the first pickup** (buyer, store, or whole order). After that: "Your items are on the way — this order can't be cancelled."
- **Refund flow:**
  1. The buyer sends **their own GCash QR** in the chat.
  2. The store sends the money and uploads proof (**Refund sent**).
  3. The buyer taps **Refund received**.
- 🟠 **REFUND NEEDED** pinned on the seller board.
- **Refund timers:** late after 24 h → **escalated** to you (audit log); unconfirmed after 72 h → closed; no buyer QR after 3 days → flagged.
- **Your paid-but-not-booked rule** (replaces the spec's 30 min / 8 PM):
  - **3 h** → reminder to book.
  - **2 h before the store's closing time** → **Self-pickup** (the store taps "Buyer picked up").
  - **1 day** → **cancelled + refunded automatically**.
  - The seller is **reminded every 3 h during store hours** until they refund.
  - **Store opening/closing times are set by the super-admin only.**
- Buyer cancels after a rider accepted → the rider is released + notified; the stage is recorded (**rider compensation = your Terms, not the app**).
- Wrong/missing item after delivery: **chat only** for now (your decision).
- Job endpoint `/api/cron/order-timers` + `bun run orders:timers`.

### Phase 8: Admin tools (`phase-8-admin-tools`)
- **Admin desk** on the Payload dashboard (super-admin only): counted to-do cards with links to filtered lists.
  - Urgent: late refunds, payment disputes, open reports, unchecked payments, flagged refunds.
  - Approvals: stores, GCash QRs, riders.
  - Setup gaps: fares, store hours/pins, key points, legal pages.
  - Plus quick links + the latest audit entries.
- **Approval notices:** push + short email to sellers/riders when approved, suspended, or their QR is approved.
- **Bug fixed:** a MongoDB quirk could make **checkout fail now and then** (first command of a transaction racing). All transactions now use `src/lib/transaction.ts`.

### Phase 9: Deploy setup (`phase-9-deploy`): CODE DONE, DEPLOY NOT DONE YET
- **Storage:** public images → **Vercel Blob**. Private files → a **private Cloudflare R2 bucket** (Payload's Vercel Blob adapter only supports public files as of 3.92.1). Both turn on only when their keys are set; on Vercel the app refuses to start without them.
- **Email:** **Resend** (when `RESEND_API_KEY` is set). Dev still prints emails.
- **CSRF/CORS** limited to your domain. **Security headers:** CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, SAMEORIGIN.
- `vercel.json`: Singapore region + daily crons. **Uploads max 4 MB** (Vercel's ~4.5 MB limit).
- **Privacy tool (Data Privacy Act):** on a user's admin page, **Download data (JSON)** / **Erase account**.
  - Erase keeps orders but anonymizes them.
  - It's refused for active orders, open refunds, sellers and super-admins.
  - Every use is logged.
- Production helpers:
  - `bun run prod:migrate`
  - `bun run prod:create-admin -- you@mail.com "Name"`
  - `bun run prod:backup` / `db:backup` (Atlas free tier has no auto backups: run weekly)
- All branches pushed to GitHub. **The PR into `main` is NOT opened yet** (no `gh` tool on the PC).

---

## 4. Every decision you made (quick list)

| Topic | Decision |
|---|---|
| Under-18 users | Allowed to use the site (option chosen in Phase 2); 18+ only for some items later |
| Store badge (beta) | "Business permit checked" = Mayor's/business permit **or** barangay business clearance; BIR/DTI optional |
| Unverified stores | **No** product/order limits in beta |
| Merchant info | Store name, owner/business name, barangay + address, pin, badge, "since", chat button |
| Prices | **Whole pesos** (no centavos) |
| Store URL | `/store/<slug>` (old `/tenants` redirects) |
| Tags | Removed |
| Reports | Minimal now, logged-in only; full queue = Admin desk |
| Seller chat | Chat head bubble (site + admin) |
| Chat cleanup | 90 days, CRON_SECRET endpoint |
| Chat photos | Yes, private |
| What stores see about buyers | Optional username, else first name |
| Book rider | Only after every store order is **PAID** |
| Delivery fee | In-app **fare table** (you enter rates) |
| Seller orders | Order cards in chat + Orders board |
| Store edits to orders | Later (confirm/cancel only) |
| Push | Yes (VAPID) |
| Calls | Buyer ↔ rider and rider → store, **only during the active trip** |
| Fee record | The rider confirms the cash collected |
| Paid but not booked | 3 h reminder → self-pickup 2 h before closing → auto refund after 1 day → repeated seller reminders |
| Store hours | Set by the super-admin only |
| Wrong/missing item | Chat only for now |
| Rider compensation | Recorded only; your Terms decide |
| Vercel | Hobby now → **Pro before real stores** |
| Files | Vercel Blob (public) + Cloudflare R2 (private) |
| Email | Resend |
| Timers scheduler | cron-job.org every 15 min (Hobby cron = once a day) |
| Production DB | `digimall-prod` on the same Atlas cluster |
| Privacy tool | Built in Phase 9 |

---

## 5. Where things are

### Git branches (all on GitHub)
`main` (old tutorial state) ← `phase-1-cleanup` ← `phase-2-roles-auth` ← `phase-3-stores-products`
(Phases 3–5) ← `phase-6-riders` ← `phase-7-refunds` ← `phase-8-admin-tools` ← **`phase-9-deploy`
(has EVERYTHING)**.
**Open the PR:** https://github.com/Supermouse69/digimall/compare/main...phase-9-deploy?expand=1
(the title + description to paste are in `suggestions/check_phase9/pull request text.txt`).

### Important folders
- `src/collections/`: database collections **and their access rules**
- `src/modules/<feature>/server/`: the business logic ("services"): `chat`, `orders`, `trips`, `privacy`, `admin-desk`, `bot-protection`, `notifications`
- `src/modules/orders/state.ts`: the order/refund **rules** (pure, tested)
- `src/components/admin/`: admin panel extras (seller bubbles, Admin desk, privacy tools)
- `src/app/(app)/api/cron/`: the 2 scheduled jobs (need `CRON_SECRET`)
- `scripts/`: tests and tools
- `suggestions/`: proposals + **your check lists**
- `backups/`: local DB backups (gitignored, contain personal data)

### Secrets / logins (NOT written here)
- Everything secret is in **`.env`** (dev) on your PC: DB password, `PAYLOAD_SECRET`, `ADMIN_ENTRY_PATH`, `CRON_SECRET`, VAPID keys, Turnstile test keys.
- Production values go in **`.env.production`** (create it) and in **Vercel's env vars**. Use **new** secrets for production.
- The dev super-admin is `admin@demo.com`. Its password was shared in our chat, so **change it** and replace the demo admin.

---

## 6. Commands cheat sheet

```bash
bun run dev                 # your dev server (localhost:3000)
bun run build               # production build check
bun run lint
./node_modules/.bin/tsc --noEmit    # typecheck

# Tests (no database)
bun run test:access   test:redirects   test:signup   test:emails   test:2fa   test:bot-protection   test:order-rules
# Tests (dev database, inside cancelled transactions = nothing saved)
bun run test:invites  test:rider-docs  test:admin-login  test:stores  test:chat  test:orders  test:trips  test:refunds  test:admin-desk  test:privacy

# Tools
bun run seed:mock                 # add [MOCK] products (writes to DB)
bun run admin:reset-2fa <email>   # emergency 2FA reset (writes to DB)
bun run chat:cleanup              # delete expired chats now
bun run orders:timers             # run order/refund timers + reminders now
bun run db:backup                 # backup the dev DB to backups/
bun run notes:map                 # refresh the Obsidian Code Map

# Production (uses .env.production)
bun run prod:migrate
bun run prod:create-admin -- you@mail.com "Your Name"
bun run prod:backup
```
⚠️ Never run `db:fresh` / `db:seed` / `db:reset` without being sure: they wipe/overwrite the database.

---

## 7. Your to-do list (in order)

1. **Test locally** with the check lists (Claude tested the rules on the database, but not the screens in a real browser):
   - `suggestions/tobedone/test phase 2f bot protection.txt`
   - `suggestions/check_phase3/` … `check_phase8/`
   - `suggestions/check_phase9/check phase 9 locally.txt` (incl. the browser console for red "Content Security Policy" errors)
   - The older Phase 2 items: 2.4 (needs your Terms), 2.6, and re-testing the invite **resend** with a new invite
2. **Fill in your content:**
   - Your key-points text in Settings (sign-up + checkout)
   - **Fares**, **categories**, and every store's **opening/closing time + map pin + barangay**
   - **Terms** (buyer, seller, rider) + **Privacy Notice**. Only you write these. Mention the service providers (Cloudflare, Vercel, Resend) and **how long order records are kept** (an open decision).
3. **Open + merge the PR** into `main`.
4. **Deploy** with `suggestions/check_phase9/deploy step by step.txt`:
   - Atlas prod user, `.env.production`, `prod:migrate`, `prod:create-admin`
   - Cloudflare R2 + Turnstile, Vercel + Blob + env vars
   - DNS (**proxy OFF**), Resend, cron-job.org, smoke test
5. **Before real stores:**
   - Vercel **Pro**
   - Confirm the tutorial code license
   - Turn on GitHub Dependabot
   - Remove the demo accounts

---

## 8. Known gaps & ideas for next

- **"My account" page for buyers** (most useful next step): change username/phone/address and **upload the landmark photo**. The field exists, but there's no screen for it yet.
- 12 old test products have no category (they must pick one when edited).
- The invite "resend" seemed not to work. It was probably because that invite was already accepted. Re-test with a new invite (`suggestions/resend invite email not working.txt`).
- Postponed on purpose: store edits to orders, an in-app wrong-item refund, Google sign-in, Xendit online payments (verified stores only), the native rider app (background GPS), platform fee (after DigiMall is registered).

---

## 9. Lessons / gotchas learned (useful for the next Claude)

- **Windows:** test output sometimes looks empty (the output gets cut off before exit). Trust the **exit code** (0 = passed) or pipe the output.
- **MongoDB transactions:**
  - A paged list as the **first** command can fail (race), so use `startTransaction()` from `src/lib/transaction.ts`.
  - Atlas transactions also have a **60-second limit**.
  - A plain "count all" isn't allowed inside a transaction.
- **Empty map pins** may be stored as `{}`: `fromPoint()` handles it.
- **Payload's Local API defaults to `overrideAccess: true`.** Public reads must pass `overrideAccess: false` (this was the Phase 3 leak).
- Payload keeps the last `user` on a shared request in tests: set `req.user = null` for "logged out" checks.
- Store-status lookups for products (`tenant.status`) don't see data inside a test transaction.
- **Don't kill the user's dev server on port 3000.** Test on 127.0.0.1:3123.
- Location + notifications only work on **https or localhost** (not when opening the PC by IP from a phone).

---

## 10. How to continue in a new chat

- **Claude on the web (claude.ai) can't see your PC's files.** Upload `CLAUDE.md` and this `PROJECT SUMMARY.md` (and any file you want help with), or connect your GitHub repo.
- For **code changes**, Claude Code (in this repo) is still the best tool: it can run the tests and the build.
- Good first message for the new chat: *"Read CLAUDE.md and PROJECT SUMMARY.md. I'm at step N of the to-do list (section 7). Help me with ___."*
