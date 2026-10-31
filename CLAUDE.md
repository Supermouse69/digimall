# CLAUDE.md — DigiMall (Beta)

Read this whole file at the start of every session. It holds the developer's rules and every product decision made so far. If the code disagrees with this file, this file shows the **intended** behavior — but ask before changing critical infrastructure to match it (see §3).

---

## 0. Top rules (never skip)

1. **Ask before touching critical infrastructure** (list in §3). Explain in plain words what, why, the risk, and how to undo it — then wait for a clear "yes".
2. **Git safety:** work on a branch, commit before and after each change, never force-push, never push straight to `main`.
3. **Never run destructive commands without a clear "yes"** — especially `db:fresh` and `db:seed` (they reset/overwrite the database), dropping collections, bulk-deleting files, or touching the production database.
4. **Security and privacy are not optional** (§9, §10). Every permission check happens on the server. Deny by default.
5. **Follow Philippine law** (§9). If a feature might break a law, stop, write a suggestion file (§4), and ask.
6. **Beta = manual GCash only.** No payment gateway, no platform fees. DigiMall never holds buyers' money.
7. **Talk to the developer in simple, casual English.** Short explanations, no jargon walls. Teach briefly when it helps.

---

## 1. What DigiMall is

DigiMall is a local "digital mall": a multi-vendor marketplace connecting neighborhood stores (sari-sari stores, small shops) with buyers, with local **tricycle riders** doing delivery. Pitch: *mini Shopee + mini Grab for the barangay.*

- **Main site / buyer site:** https://digimall.online
- **Service area (beta):** Calumpit, Bulacan, Philippines — barangays **San Marcos, Balite, Sergio Bayan, Buguion**. Keep this list admin-editable (settings), not hardcoded.
- **History:** started as a Facebook Messenger community + Google Forms + Google Sheets + an Apps Script site. This codebase replaces all of that.
- **Beta money rules:** the buyer pays each store directly through that store's GCash QR; the delivery fee is paid in cash to the rider on delivery; DigiMall charges no fees.
- **Later (not now):** native rider mobile app (first mobile priority), online payments for verified stores (Xendit preferred, PayMongo alternative), platform fee after DigiMall is a registered business.

## 2. The developer & how to work

- Solo developer, Computer Engineering grad, still learning Next.js/Payload. The existing code was written while following a tutorial — it's partial and messy. Cleaning it up is expected.
- **Per task:** understand → short plan (bullets) → wait for "yes" if anything in §3 "Ask first" is involved → build in small steps → run checks → summarize what changed + how to test it.
- **"Done" means:** typecheck, lint, and build pass; the flow was actually tested; no ignored errors.
- **Unsure about a business or legal rule?** Ask. Don't guess, don't invent policy.
- **Keep this file current.** When a decision changes, propose the edit to this file and apply it after approval.

## 3. Change rules

**Free to do (just mention it in your summary):**
- UI, styling, layout, components, design improvements
- Folder restructuring for a cleaner setup (update the "Project structure" part of §5 afterwards)
- Refactors that don't change behavior; removing dead code that nothing imports
- Docs, comments, tests

**Ask first — explain what/why/risk/rollback, then wait for "yes":**
- API surface: tRPC routers/procedures (names, inputs, outputs), Next.js route handlers (`app/api/**`), Payload REST/GraphQL settings
- Auth, sessions, roles, access control, login/redirect logic
- Payload collections/fields: adding is usually fine to propose; renaming, deleting, or changing types needs a migration plan
- Database connection/config; any script that writes to or resets the database
- Environment variables (add / rename / remove)
- `middleware.ts`, routing, `next.config.*`, `payload.config.*`
- Deployment, Vercel settings, domain, DNS
- Dependencies: adding, removing, or upgrading (security patch upgrades included — explain why)
- Order / payment / refund state machine, timers, fares
- Anything that changes where personal data is stored or who can see it
- Removing a tutorial feature (e.g., Stripe, the digital "library") — already decided, but show the removal plan first

**Pre-approved dependencies** (still mention when you add them): `leaflet`, `react-leaflet`, `web-push`, `zod`, `sharp`.

**Never:**
- Commit secrets or `.env` files
- Weaken or bypass access control "to make it work"
- Add tracking, analytics, ads, or paid services without approval
- Write legal text (Terms, Privacy Notice) — the developer writes those

## 4. Suggestions folder (developer's rule)

For **critical** suggestions only — things that affect the site's flow/process, security, law/compliance, data, or cost. Not for cosmetic things (colors, spacing).

- Location: `suggestions/` at the project root
- Filename: plain lowercase title, e.g. `suggestions/adding another login security.txt`
- Content template:

```
Title:
Date:
Priority: High / Medium
Area: security / legal / flow / data / infra / cost

What's the problem?
Why it matters (what could go wrong):
What I suggest:
Effort and cost (free? needs a paid service?):
Trade-offs / risks:
What I need from you:
```

Mention any new suggestion files in your session summary.

## 5. Tech stack & project base

**Reference (learning base):** https://github.com/code-with-antonio/next15-multitenant-ecommerce — our code is a partial, messy version of it. Use it to understand the intended patterns. Confirm real versions in our `package.json`; don't assume.

**Expected stack:** Next.js 15 (App Router) · React 19 · Payload CMS 3 (runs inside Next.js) · MongoDB Atlas · Payload multi-tenant setup (likely `@payloadcms/plugin-multi-tenant`) · tRPC + TanStack Query · Tailwind CSS v4 · shadcn/ui · Vercel Blob. Use whichever package manager the repo already uses (one lockfile only). Stay on the current major versions unless you propose otherwise.

**Decided changes from the tutorial:**

| Tutorial | DigiMall |
|---|---|
| Stripe Connect + platform fees | **Remove Stripe completely.** Manual GCash QR in beta. Keep payment code in one isolated module so a gateway (Xendit) can be added later. |
| Vendor subdomains (`store.domain.com`) | **Off:** `NEXT_PUBLIC_ENABLE_SUBDOMAIN_ROUTING=false`. Public store URL is **`/store/[slug]`** (tutorial default is `/tenants/[slug]`; changing it is a routing change → show the plan first and keep a redirect from the old path). Reason: the domain's DNS is on Cloudflare, so no wildcard subdomains on Vercel. |
| Digital products / purchase "library" | DigiMall sells **physical goods** with delivery. Replace the library with "My Orders". Remove digital-delivery fields (ask first). |
| Admin + merchant dashboards in Payload | Sellers and the super-admin use Payload admin. **Riders get their own mobile-first portal at `/rider`** (not Payload admin). |
| — | **New:** riders, in-site chat, multi-store cart, rider booking, refunds, store verification tiers. |

The database stays **MongoDB Atlas** (Singapore region recommended). No Supabase.

**Project structure:** _(fill in / update this after any restructure)_

```
src/
  app/(app)/          buyer site routes (Next.js App Router)
  app/(payload)/      Payload admin + REST API routes (generated by Payload)
  collections/        Payload collections (access rules live here)
  globals/            Payload globals (Settings: barangays, service area, minimum age, ...)
  migrations/         database migrations — `bun run db:migrate` (ask first: writes to the DB)
  components/ui/      shadcn/ui building blocks
  components/map/     Leaflet map pieces (location picker)
  lib/access.ts       deny-by-default access helpers (isSuperAdmin, own-store filters)
  lib/image-upload.ts upload rules for every image (types, re-encode, EXIF strip, random names)
  lib/private-files.ts "you can only attach your own private file" check
  lib/utils.ts        cn(), formatCurrency(), URL helpers
  modules/<feature>/  feature code: server/ (tRPC procedures), ui/ (views, components), hooks, schemas
  modules/bot-protection/ Turnstile check + rate limits (MongoDB counters) for public forms and Payload login
  trpc/               tRPC setup (init, client, server caller, root router)
  payload.config.ts   Payload config (@payload-config alias)
  payload-types.ts    generated — run `bun run generate:types`, don't edit by hand
  seed.ts             dev seed script (writes to the DB — ask first)
scripts/              checks: `bun run test:access | test:redirects | test:signup | test:emails | test:2fa | test:bot-protection`
                      DB checks (real dev DB, inside cancelled transactions): `test:invites | test:rider-docs | test:admin-login`
                      `admin:reset-2fa <email> [--new-password]` emergency 2FA reset (writes to the DB)
                      `seed:mock` adds/removes [MOCK] products (writes to the DB)
                      `notes:map` refreshes the Obsidian Code Map notes (§17; writes only to the notes folder)
public/               static files
suggestions/          critical suggestions for the developer (§4)
suggestions/tobedone/ things the developer still has to test or do (checklists)
media/                local public uploads, gitignored (moves to Vercel Blob later)
private-media/        local PRIVATE uploads (IDs, licenses, landmark photos), gitignored (Vercel Private Blob later)
backups/              local DB backups made before migrations, gitignored (contain personal data)
```
Path aliases: `@/*` → `src/*`, `@payload-config` → `src/payload.config.ts`. Package manager: **bun** (`bun.lock`).

## 6. Hosting, domain & third-party services

- **Domain:** `digimall.online`, registered at **Cloudflare Registrar** (DNS stays on Cloudflare). Connect it to Vercel with the DNS records Vercel shows, Cloudflare proxy **OFF (gray cloud / DNS only)**. Avoid DNS changes during registry maintenance windows announced in the Cloudflare dashboard.
- **Vercel plan:** Hobby (free) is for personal, **non-commercial** use only. A live marketplace likely counts as commercial → plan for **Pro** before going live with real stores (developer decides). Hobby cron jobs run **only once per day** → design timers accordingly (§11.6).
- **Separate databases** for development and production (different `DATABASE_URI`), so testing never touches real data.

| Service | Purpose | Status | Env vars (proposed) |
|---|---|---|---|
| MongoDB Atlas | Database | Have | `DATABASE_URI` |
| Payload | CMS + auth | In code | `PAYLOAD_SECRET` |
| Vercel | Hosting, Blob storage, cron | Have / set up | `BLOB_READ_WRITE_TOKEN` (public store) + private store access (token or OIDC — check Vercel docs) |
| Email (e.g., Resend + `@payloadcms/email-resend`) | Invites, verification, password reset | Need | `RESEND_API_KEY`, `EMAIL_FROM` |
| Google Cloud OAuth | "Sign in with Google" for buyers | Need | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| Cloudflare Turnstile | Bot protection on auth forms | In code (dev uses Cloudflare test keys); **real keys needed before deploy** (free) | `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` |
| Rate-limit counters | Rate limiting on serverless | **Decided 2026-10-31: MongoDB** (`rate_limits` collection, auto-expiring, hashed keys) in `modules/bot-protection`. Upstash Redis stays the upgrade path. | — (Upstash later: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`) |
| Web Push (VAPID) | Push notifications | Generate keys locally | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` |
| OpenStreetMap tiles | Maps | No account needed | — |
| Cron protection | Secures scheduled endpoints | — | `CRON_SECRET` |
| Admin entry | Hidden super-admin login path | — | `ADMIN_ENTRY_PATH` |

Keep `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_ROOT_DOMAIN`, and `NEXT_PUBLIC_ENABLE_SUBDOMAIN_ROUTING=false`. Remove `STRIPE_*`. Adding/removing env vars = ask first. When a phase needs a new account or key, tell the developer exactly what to create and where.

## 7. Roles & portals

| Portal | Who | Where |
|---|---|---|
| Buyer site | Buyers + public | `digimall.online` (Next.js frontend) |
| Seller panel | Store owners | Payload admin, scoped to their own store (tenant) |
| Rider portal | Tricycle riders | `/rider` — mobile-first, installable PWA; becomes the rider app later |
| Admin | Developer (super-admin) | Payload admin through a hardened entry (§10) — full access to everything, every action logged |

- Seller, rider, and admin entry points are **not linked** anywhere on the buyer site. Sellers and riders get their link in their invite.
- **Login:** a shared `/login` for buyers, sellers, and riders → the server redirects by role (buyer → home/previous page, seller → seller panel, rider → `/rider`). Super-admin accounts are **rejected** on the normal login and must use the hardened entry. Redirects are only UX — real enforcement is server-side access control.
- Payload admin access is allowed only for `seller` and `super-admin`.
- **Beta: one role per account.** A store owner who wants to shop uses a separate buyer account.
- Seller order board + seller chat: build them as custom Payload admin views if practical, otherwise as a seller area in the Next.js app using the same login. Propose the approach before building.

## 8. Accounts & onboarding

**Stores and riders are created only by the super-admin** (no public signup for them):
1. Admin creates the store (name, slug, barangay) + the seller account → the system emails an **invite link so the owner sets their own password** (never send passwords over chat). Riders: same flow, with a rider profile.
2. The seller fills in the store content ("edits their room"). The rider uploads their driver's license + tricycle franchise/permit (MTOP) (+ TODA membership if applicable).
3. A store stays `pending` (invisible) until the admin sets it to `unverified` or `verified` (§11.1). A rider stays `pending` until the admin approves.
- Sellers can't change their slug, status, or verification. Riders can't approve themselves.

**Buyers sign up publicly:** email + password (email verification required) or Google login. Collect only what's needed: full name, email, mobile number, barangay (service-area dropdown), address details (street/purok), map pin, landmark photo (optional). No GCash number at signup (refunds use a QR sent in chat).

**Consent & legal pages (all roles):**
- Unticked checkboxes: agree to the role's Terms + the Privacy Notice. Save the document **version + timestamp** per user; ask again when a version changes.
- Legal pages are **blank placeholders**, editable only by the super-admin in Payload: `terms-buyer`, `terms-seller`, `terms-rider`, `privacy`. Seed each with its title and `[Developer: write this]`. Do not write legal text.
- Signup shows an age-confirmation checkbox; the minimum age is set by the developer in the Terms.
- The Terms (written by the developer) must highlight: no cancellation once an order is "On the way", delivery fee rules, refund rules, and the paid-but-unbooked policy. Show these key points at signup and at checkout.
- **Key points text (written by the developer, 2026-10-31).** Stored in Settings (`signupKeyPoints`, `checkoutKeyPoints`, editable by the super-admin); copied here so it isn't lost. Don't reword it — the developer owns this text.

  Sign-up box: "Before you join"
  - You pay each store directly via GCash, then upload your receipt.
  - The delivery fee is separate and paid in cash to your rider.
  - You can cancel until your order is "On the way". After that, no cancellations.
  - Refunds come from the store, not from Digimall, and go back through GCash.
  - Paid but no rider booked yet? Your order is safe. Book a rider or ask the store for a refund.
  - We only deliver in San Marcos, Balite, Sergio Bayan and Buguion (Calumpit).

  Checkout box: "Quick reminders" (shown at checkout, Phase 5)
  - Pay each store first. Your rider can only be booked once every store confirms.
  - Delivery fee: Will be paid in cash to the rider (delivery fee rate will be posted at Dev Hub at developer announcements page.
  - Once it's "On the way", you can't cancel anymore.
  - Wrong or missing item? Report it in chat within __ hours for a refund or replacement.
  - Paid but not booked within 3 hours? We'll remind you. After 2 days, the store refunds you.
  - No convenience fee during the beta.

  ⚠️ **Open questions — some points differ from the spec; the developer decides before Phase 5/7:**
  1. Paid-but-unbooked: the text says remind after **3 hours** and the store refunds after **2 days**. §11.10 says remind after **30 min**, **8:00 PM same-day cutoff → `self_pickup`**, and stores owe a refund only if a cancel button is pressed. Which one is the rule?
  2. "Rider can only be booked once every store **confirms**" — §11.5 makes booking possible once every store order is **paid** (`ready_to_book`). Same meaning?
  3. Delivery fee "posted at Dev Hub / developer announcements page" — there's no such page in the app; §11.11 shows the estimated fare at checkout from the admin fare table. Keep both, or only the in-app fare?
  4. "Wrong or missing item → report within __ hours for a refund or replacement": the number is blank, and refunds after delivery aren't in the spec yet (§11.9 covers refunds only when a paid store order is cancelled). New flow needed?

**Old Google Sheets data:** don't bulk-import buyers' personal data — buyers re-register under the new Privacy Notice. The admin re-creates stores and riders.

## 9. Law & compliance guardrails (Philippines) — not legal advice

The developer wants DigiMall to be a clean, law-abiding business. When in doubt, ask and write a suggestion file.

**Data Privacy Act (RA 10173) & NPC rules**
- Privacy Notice + explicit consent; collect the minimum; use data only for its stated purpose.
- **Sensitive personal information** includes government-issued IDs/licenses and tax information → rider license/franchise documents and store BIR/TIN papers go in **private storage**, super-admin only, every access logged, deleted when no longer needed.
- Need-to-know visibility only (table in §10).
- Users can view/download and correct their data, and request account deletion (handled by the super-admin; keep only the order records needed for legal/dispute reasons, anonymize the rest).
- Keep audit/security logs so a breach can be investigated and, when required, reported to the NPC and affected users within 72 hours of discovery.
- The developer acts as Data Protection Officer (DPO) for now (contact goes in the Privacy Notice).
- No third-party trackers, analytics, or ads without approval and consent.
- Location: rider location only while Active; buyers see it only during their own trip.
- Strip EXIF/GPS metadata from every uploaded photo.

**Internet Transactions Act (RA 11967)**
- Keep a verified merchant registry (stores + compliance documents).
- Show merchant identity on store pages (exact fields decided by the developer).
- Provide reporting/complaints and takedown (admin can hide products and suspend stores).
- Keep order (transaction) records; the retention period is a setting the developer sets — orders are **not** deleted along with chats.
- Stores are responsible for their own products; DigiMall does due diligence (verification, moderation).

**BIR / tax**
- Never generate anything that looks like an official receipt or sales invoice. Order summaries must say **"Order Summary — not an official receipt/invoice."**
- No feature that helps stores hide sales or fake their registration.
- Verified tier = BIR Certificate of Registration (Form 2303) + DTI/SEC registration + Mayor's/Business permit (+ barangay clearance), reviewed by the admin.
- A platform fee setting may exist but stays **0 and hidden**. Don't build fee collection until the developer confirms DigiMall's own registration.
- Future online payments: verified stores only (payment gateways require business KYC).

**Consumer protection:** clear prices in ₱, honest product info, no fake reviews, fake urgency, or dark patterns.

**Prohibited items (beta):** medicines (prescription and over-the-counter), alcohol, tobacco/vapes, firearms/ammo/explosives/fireworks, live animals, gambling items, adult content, counterfeit goods, anything illegal. Enforce with an admin-managed category whitelist, admin takedown, and a report button.

**Riders:** must have a valid LTO driver's license and an LGU tricycle franchise/permit (MTOP); the admin verifies before approval. Fares come from the rider organization's agreed rates, entered by the developer.

**Licenses & terms of service**
- OpenStreetMap: always show "© OpenStreetMap contributors"; follow the OSM tile and Nominatim usage policies (light use only; switch to a tile provider if traffic grows).
- The reference repo has **no LICENSE file**: learn patterns from it, don't copy large chunks verbatim, and write a suggestion file reminding the developer to confirm the author's terms before commercial launch.
- Only use images, fonts, and icons we have the rights to.
- Vercel Hobby is non-commercial only (see §6).

## 10. Security requirements

No system is unhackable, but the developer wants DigiMall to be very hard to break. Defense in depth, deny by default.

1. **Patch first.** Update Next.js, React, and Payload (+ its plugins) to the latest patched releases of the current major versions. Check the official security advisories (including the 2025 Next.js middleware-bypass and React Server Components remote-code-execution advisories). Run the package manager's audit. Suggest enabling GitHub Dependabot. Version bumps = ask first.
2. **Authorization on the server, always.** Payload collection- and field-level access control on every collection (deny by default). Every tRPC procedure checks session, role, and ownership — never trust IDs sent from the browser (prevents one user reading another user's orders). **Middleware is not a security boundary.**
3. **Lock down the Payload API.** Payload auto-creates REST endpoints (`/api/*`) for every collection — access control must cover them. Disable GraphQL if unused (ask first). Only the super-admin can set `roles`, `tenants`, store status, verification, and approvals — enforce with field-level access.
4. **Auth hardening:** Payload `maxLoginAttempts` + `lockTime`; generic login errors ("Wrong email or password"); passwords at least 10 characters; email verification for buyers; secure cookies (HttpOnly, Secure, SameSite=Lax); Payload `csrf` and `cors` limited to our domains.
5. **Super-admin hardening** (design it, write a suggestion file, get approval before building): TOTP 2FA (authenticator app), hidden entry route from `ADMIN_ENTRY_PATH`, normal login rejects super-admin accounts, shorter sessions if feasible, optional IP allowlist, consider moving the Payload admin route off `/admin`.
6. **Abuse protection:** Cloudflare Turnstile on signup, login, and password reset. Rate limits on login, signup, password reset, chat send, checkout, and rider requests, using a serverless-safe store (propose Upstash or similar — in-memory limits don't work on Vercel).
7. **Input/output:** zod validation on every input; sanitize rich text; never render user content with `dangerouslySetInnerHTML`.
8. **Uploads:** images only (JPEG/PNG/WebP), max 5 MB, check the real file type, re-encode with sharp, strip EXIF, random filenames.
   - **Public storage:** product images, store logo/banner.
   - **Private storage** (Vercel Private Blob, short-lived signed URLs issued only after a permission check): GCash QR codes, payment receipts, refund QRs and proofs, landmark photos, chat images, store compliance documents, rider documents. Check whether Payload's storage adapter supports private access; if not, propose an approach.
9. **Security headers:** CSP (as strict as practical), HSTS, `frame-ancestors 'none'` (relax only if Payload live preview needs it), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` allowing geolocation and camera for our own origin only.
10. **Secrets:** only in env vars; `.env*` gitignored; `.env.example` has placeholders only; strong `PAYLOAD_SECRET`. Never log secrets, tokens, or personal data. No stack traces shown to users in production.
11. **Scheduled endpoints** require `CRON_SECRET`.
12. **Audit log** for: approvals/verification changes, role changes, viewing private documents or chats, refund escalations, suspensions, deletions.
13. **Backups:** check the Atlas backup options for our tier and propose a backup plan.

**Who can see what:**

| Data | Buyer | Seller (own store) | Rider (assigned) | Super-admin |
|---|---|---|---|---|
| Buyer name | Self | On their orders | First name, during trip | Yes |
| Buyer phone | Self | No | Call button during active trip only | Yes |
| Buyer address, pin, landmark photo | Self | No (barangay only) | After accepting, until delivered | Yes |
| Store phone | No (use chat) | Own | During trip | Yes |
| Store GCash QR | Inside their confirmed order only | Own | No | Yes |
| Payment receipts, refund QR/proof | Own orders | Own store's orders | No | Disputes only, logged |
| Chats | Own threads | Own store's threads | Own trip threads | Reports/disputes only, logged |
| Rider live location | Own trip, after accept | No | Self | Yes |
| Rider documents | No | No | Self | Yes, logged |
| Store compliance documents | No (badge only) | Own | No | Yes, logged |

## 11. Product spec

All durations, limits, and amounts below are **defaults stored in an admin-editable settings global** — never hardcode them.

### 11.1 Stores, products, verification tiers
- Store statuses: `pending` (invisible) → `unverified` or `verified`; `suspended` (hidden, admin-only).
- **Unverified:** "Unverified store" badge visible to buyers; max **10** products; max **10** orders/day; never featured.
- **Verified:** admin approved the compliance documents (§9, BIR); "Verified" badge; normal limits.
- Limits are enforced on the server (e.g., Payload hooks), not just in the UI.
- Store GCash QR: uploaded by the seller, **approved by the admin before use**; any change needs re-approval (prevents QR-swap scams).
- Products: name, description, price (₱), images, category (from the whitelist), **Available / Not available** toggle (no stock counts). Not-available products show a label and a disabled cart button. The admin can hide any product.

### 11.2 Browsing (buyer site)
- Home: stores by barangay, categories, search (the tutorial already has search/filtering).
- Store page `/store/[slug]`: banner, logo, name, barangay, badge, merchant info, product grid (tiles).
- Product page: images, price, availability, **[Add to cart]** and **[Chat with store]**.

### 11.3 Chat
- **Store chat:** buyer ↔ store, one thread per buyer–store pair. "Chat with store" on a product page opens it with a product reference card. Buyers use it to ask about availability. Order cards (from checkout) appear inside it.
- **Trip chat:** buyer ↔ assigned rider. Opens when the rider accepts; read-only after the trip ends.
- Message kinds: `text`, `image`, `product_ref`, `order_card`, `payment_receipt`, `refund_request`, `refund_qr`, `refund_proof`, `system`.
- Beta "realtime" = polling with TanStack Query (about every 3–5 s while a chat is open, slower otherwise). A realtime service can come later (suggestion file if needed).
- Unread badges. Report button on threads/messages → admin queue.
- Retention: delete messages **90 days** after the linked order closes (inquiry-only threads: 90 days after the last message), unless the thread is under a report/dispute (keep until resolved). Runs as a daily job.
- Use custom in-page dialogs, never browser `alert`/`confirm`.

### 11.4 Cart & checkout
- The cart groups items by store. **Max 3 stores** per cart; adding from a 4th store shows a friendly block message.
- Checkout requires login and a complete profile inside the service area.
- The buyer chooses: delivery mode — **Fast** (urgent, higher fare) or **Casual** (normal, cheaper); delivery pin (default from profile); notes for each store; notes for the rider.
- Show the estimated delivery fare (§11.11) and a reminder that the delivery fee is paid in cash to the rider.
- Submitting creates **one Order** (code like `DM-7K3Q`) + **one Store Order per store** (`DM-7K3Q-A`, `-B`, `-C`) with snapshots of item name, price, and quantity. An order card is posted in each store chat, and the stores are notified.

### 11.5 Store Order lifecycle

| Status | Meaning / who acts | Timer |
|---|---|---|
| `awaiting_store` | Store confirms, edits (remove items / change qty or price → buyer must accept), or cancels with a reason | 10 min → `expired` (buyer notified) |
| `awaiting_payment` | The order card shows the store's approved GCash QR + total. Buyer pays in GCash, then uploads the receipt (+ optional GCash reference number) | 10 min → auto-`cancelled` (unpaid) |
| `payment_submitted` | **Timer stops** (buyer has paid). Seller checks GCash → "Payment received" (→ `paid`) or "Not received" (→ admin flag) | Reminder + admin flag after 30 min. **Never auto-cancel after a receipt is submitted.** |
| `paid` 🟢 | Green light — store prepares the items | — |
| `picked_up` | Rider marks pickup (or store confirms handover) | — |
| `delivered` | Rider marks delivered | — |
| `cancelled` / `expired` | Closed. Store who cancelled, why, and when | — |

Items and prices are locked once the buyer accepts the store's confirmation.

**Order (parent) statuses:** `in_progress` → `ready_to_book` (every non-cancelled store order is `paid`, at least one) → `rider_requested` → `rider_assigned` → `on_the_way` (first pickup) → `delivered`. Also `cancelled` (all store orders cancelled) and `self_pickup` (§11.10). The buyer can remove a stuck store (cancel that store order) to reach `ready_to_book`.

### 11.6 Timers & scheduled jobs
- Save an `expiresAt` on records and enforce expiry **on every read and every action** (lazy expiry), so timers work without frequent cron.
- Vercel Hobby cron runs only once a day. Use it for chat retention cleanup, location cleanup, and end-of-day unbooked handling (§11.10).
- Minute-level reminders/push (e.g., 30-min reminders) need either an external scheduler calling a `CRON_SECRET`-protected endpoint, or Vercel Pro → **write a suggestion file**. Until decided, show reminders as in-app banners on the next visit.
- All times in **Asia/Manila**.

### 11.7 Rider booking & trip (like Grab, but the buyer picks)
- When the Order is `ready_to_book`, the buyer sees **[Book rider]**.
- Rider list = approved riders with **Active ON** and a location updated within the last **5 min**, sorted by approximate distance from the **first pickup store**. Show first name, photo, and approximate distance (rounded, e.g. "~0.8 km"). No live map before booking.
- **[Auto-pick nearest]** tries the nearest rider, then the next one on decline/timeout.
- The rider has **2 min** to Accept/Decline. One pending request per Order; one active trip per rider (beta).
- On accept: the rider sees the stops (store names, locations, store phone), buyer first name, barangay, pin, address details, landmark photo, notes, mode, and fare. Trip chat opens. The buyer sees the rider's live location (this trip only) and a call button (active trip only).
- The rider taps **Picked up** at each store → the first pickup sets the Order to `on_the_way`. Then **Delivered** + "fee collected (cash)".
- After delivery: the buyer's address, landmark photo, and phone disappear from the rider's view; trip chat becomes read-only; trip location sharing stops.
- Rider portal: Active toggle, incoming request card with countdown, active trip view (map + stops), trip history with fees (simple earnings log).
- Fast orders show 🔴 **URGENT · FAST**, casual ones 🟢 **CASUAL**.

### 11.8 Cancellation
- **Buyer:** can cancel a store order or the whole Order until the first pickup. After that the button is disabled with the note *"Your items are on the way — this order can't be cancelled."*
- **Store:** can cancel its own store order any time before pickup (reason required).
- If the buyer cancels after a rider accepted but before pickup: the rider is released and notified. Rider compensation follows the Terms (developer); the app records the stage and timestamps.
- Cancelling an unpaid store order → no refund. Cancelling a **paid** one → refund flow.

### 11.9 Refunds (only when a paid store order is cancelled)
1. `awaiting_buyer_qr` — the app opens the buyer's store chat, posts a system message to the seller ("Refund needed for DM-XXXX-A"), and auto-prompts the buyer to upload **their own GCash QR**.
2. `awaiting_store_refund` — the seller sees 🟠 **REFUND NEEDED** pinned at the top of their dashboard, sends the money in GCash, then taps **Refund sent** + uploads proof.
3. `refund_sent` → the buyer taps **Refund received** → `refunded` (closed).
- Seller doesn't mark "Refund sent" within **24 h** of the buyer's QR → `escalated` to the super-admin.
- Buyer doesn't confirm within **72 h** of "Refund sent" → `refunded_unconfirmed` (closed; the buyer can still report).
- Buyer doesn't upload a QR → reminders; flag to the admin after 3 days.
- Refund amount = the full amount paid to that store for that store order. The delivery fee isn't involved (cash to the rider, paid only on delivery).

### 11.10 Paid but rider never booked
- Reminder to the buyer 30 min after `ready_to_book` (push if a scheduler exists, otherwise an in-app banner).
- At the daily cutoff (**8:00 PM** Asia/Manila), the Order becomes `self_pickup` and the buyer is told to pick up at the store(s). What happens next follows the Terms (developer).
- This is the buyer's responsibility: stores owe a refund only if a cancel button is pressed (§11.8–11.9).

### 11.11 Delivery fare
- Fares are entered **only by the super-admin** from the rider organization's agreed rate sheet. Never hardcode amounts.
- Default structure (confirm with the developer before building): base fare by (pickup barangay → buyer barangay) × mode (Casual/Fast), using the first pickup store's barangay, + an extra fee per additional store stop.
- Show the fare before booking and save a fare snapshot on the Order. Paid in cash to the rider on delivery.

### 11.12 Notifications
- In-app badges + polling everywhere.
- Email (transactional only): invites, verification, password reset, order confirmation with the order code.
- Web Push (PWA + VAPID): new orders/messages → sellers; ride requests → riders; status updates → buyers. The rider portal must be installable (manifest + service worker). Android supports background push; iPhone requires adding the site to the home screen.
- Keep notification sending in one module so the future native rider app (its own push) can be added as another target.

### 11.13 Maps & location
- Leaflet + OpenStreetMap tiles (free) with attribution. Browser Geolocation for "use my location".
- Buyers pick their barangay from the dropdown and drop a pin — no free-text address search.
- Service-area check: optional GeoJSON boundary in settings (admin-drawn); if set, the pin must be inside it. If not set, rely on the barangay dropdown + a max radius from the Calumpit center (setting).
- Distances = straight-line approximations in beta, labeled "approx."
- Rider location: while Active and the portal is open, send the position every ~20–30 s (throttled); store only the latest point; delete trip paths after the trip.

## 12. Data model (target)

Check against the existing code first; schema changes follow §3.

- **users:** email, name, phone, `role` (`buyer` / `seller` / `rider` / `super-admin`; the tutorial has a `roles` field — adapt it), tenants (sellers), buyer profile (barangay, address details, pin, landmark photo → private), consents (doc, version, acceptedAt), status (active/suspended).
- **tenants (stores):** name, slug\*, status\*, owner, barangay, address, pin, hours, phone, logo, banner, description, GCash QR (private) + approved\*, compliance documents (private), verifiedAt\*/verifiedBy\*. (\* = super-admin only)
- **products:** tenant, name, description, price, images, category, isAvailable, status (published/hidden).
- **categories:** admin-managed whitelist (no prohibited items).
- **rider-profiles:** user, display name, photo, license document (private), franchise/MTOP document (private), TODA (optional), status (pending/approved/suspended), isActive, lastLocation {lat, lng, at}.
- **orders:** code, buyer, mode, delivery snapshot {barangay, address details, pin, landmark photo}, rider notes, status, rider, rider request {rider, requestedAt, expiresAt, attempts}, fare snapshot, timestamps, cancel {by, reason, at}.
- **store-orders:** order, tenant, suffix, items [{product, name, price, qty}], subtotal, status, expiresAt, store notes, payment {method `gcash_manual`, receipt (private), reference no., submittedAt, confirmedAt}, refund {status, buyer QR (private), proof (private), timestamps}, cancel {by, reason, at}, archived flags.
- **conversations:** type (store/trip), buyer, tenant, rider, order, lastMessageAt, closedAt, deleteAfter, underReport.
- **messages:** conversation, sender, kind, text, image (private), data (card payload), createdAt, readBy.
- **fares** (super-admin only) and a **settings** global (limits, timers, cutoff, unverified limits, retention days, service-area barangays + boundary, platform fee = 0 and hidden).
- **legal-pages:** slug, title, content, version, publishedAt.
- **reports**, **audit-logs**, **push-subscriptions**, **media** (public), **private-media** (private).

Store money as **integer centavos** (no floating-point math; propose the change if the current code uses decimals) and display like ₱1,234.00.

## 13. Carried over from the Google Sheets beta

- Order code format `DM-XXXX`: random, unique, no confusing characters (0/O, 1/I).
- Order boards as a tile grid (Google Images style); tap a tile for details. 🔴 URGENT · FAST, 🟢 CASUAL, 🟠 REFUND NEEDED pinned on top.
- Live refresh (the Sheets site used 15 s) → polling.
- Archive finished orders (hidden from view, data kept) + "Archive all" + an Archived view, for sellers and riders.
- Rider: "📌 Assigned to you", call buttons (active trip only), address hidden after delivery.
- Changed from the Sheets version: "one store per order" → multi-store cart (max 3) with one rider; "seller calls the rider" → the buyer books the rider; PINs → real accounts with invite links.

## 14. Build order

Each phase: plan → approval → build → test → summary. Don't start the next phase without the developer's OK.

0. **Audit** (read-only) — §15
1. **Cleanup + security baseline:** patch versions, remove Stripe, subdomain routing off, env cleanup, folder restructure, typecheck/lint/build green
2. **Roles & auth:** roles, admin-created stores/riders + invite emails, buyer signup + consents + legal placeholders, role-based login routing, super-admin hardening (approved design)
3. **Stores & products:** `/store/[slug]`, badges, merchant info, availability toggle, unverified limits, category whitelist, moderation
4. **Chat:** store chat, product refs, polling, reports, retention
5. **Cart & checkout:** orders + store orders, order cards, manual GCash, timers
6. **Rider portal (PWA):** Active toggle + location, booking, requests, trip flow, web push
7. **Cancellations & refunds:** refund flow, paid-but-unbooked handling, escalations
8. **Admin tools:** approvals, fares, settings, audit log, reports queue
9. **Deploy:** Vercel + `digimall.online` (DNS only), production env vars, smoke test

**Later:** Xendit for verified stores · native rider app (same backend and login, chat/call buyer and store, GPS including background tracking, native push; delivery fee stays cash for now) · platform fee (after registration) · buyer/seller apps.

## 15. First session: audit only

- **Read-only.** No code edits, installs, upgrades, or database commands. The only allowed writes are files in `suggestions/`.
- You may run the local dev server and click around to understand the current site (the developer asked for this). Don't change data; ask first if you need test accounts.
- Compare our code with the reference repo. Report what's done, half-done, broken, or messy.
- Security check: versions vs advisories, access-control gaps, committed secrets, risky configs.
- List everything that conflicts with this file (Stripe, subdomains, missing riders/chat, etc.).
- Output: a short, simple summary in chat + a proposed Phase 1 plan + suggestion files only for critical issues. Then wait.

## 16. Conventions

- Timezone **Asia/Manila**; currency **PHP (₱)**; PH mobile numbers validated (`09XXXXXXXXX` or `+639XXXXXXXXX`).
- **Mobile-first:** most users are on budget Android phones and mobile data — light pages, optimized images, big tap targets.
- UI text in simple English; keep strings easy to translate later (Filipino/Taglish).
- TypeScript strict. Business rules live on the server (tRPC procedures / Payload hooks), never only in the UI.
- Write tests for the critical parts: order/refund state transitions, timers, access control.

## 17. Obsidian logging rules (developer's rule, added 2026-10-31)

Notes folder: `C:\Users\Moises\Desktop\MOISES\Digimall Notes` (inside the developer's Obsidian vault `C:\Users\Moises\Desktop\MOISES`). Create the `Claude Logs` and `Code Map` folders if they don't exist.

- `Claude Logs/`: one note per task/run
- `Code Map/`: one note per source file
- `Code Map/_Index.md`: overview of the whole project

**Note layout:** `Code Map/` mirrors the code's folders exactly: `src/collections/Users.ts` → `Code Map/src/collections/Users.ts.md`. Two small changes: `[ ]` → `{ }` (`[slug]` → `{slug}`, since Obsidian links break on brackets), and a leading `.` gets a `_` (`.env.example` → `_.env.example.md`, since Obsidian hides dotfiles). Links use the full vault path with the filename as the label, so files with the same name don't mix up: `[[Digimall Notes/Code Map/src/lib/access.ts.md|access.ts]]`. `bun run notes:map` creates/updates the notes and keeps the Uses/Used-by links in sync.

**1. First run (backfill):** if `Code Map/_Index.md` doesn't exist yet, first:
1. Scan the whole project (skip `node_modules`, `.git`, `.next`, build folders).
2. Create one note per source file in `Code Map/`, with:
   - **Purpose**: what the file does, in 1–3 sentences.
   - **Main functions/classes**: name plus a one-line description of each.
   - **Uses**: [[wikilinks]] to the files it imports or calls.
   - **Used by**: [[wikilinks]] to the files that import or call it.
   - **Notes**: anything confusing, unfinished, or buggy.
3. Create `Code Map/_Index.md` with:
   - What the project is and how to run it.
   - A folder structure overview.
   - A mermaid diagram of how the main files connect.
   - A link to every file note.
4. Write `Claude Logs/0000 - Project History.md`: a timeline from `git log`, with small commits grouped together.
5. Write a log note for the backfill run (format in step 2).

If the Code Map exists but some files have no note, add the missing notes.

**2. Every run: log the result.** After every task, create `Claude Logs/YYYY-MM-DD HHmm - <short task name>.md` with:
- **Summary**: what the developer asked and what you did (3–5 bullets).
- **Result**: did it work? Include run/test output or errors.
- **Files changed**: each one as a [[wikilink]] to its Code Map note.
- **Map**: a mermaid diagram of how the changed files/functions connect.
- **Next steps**: anything unfinished or worth doing next.

**3. Every run: keep the Code Map up to date.**
- New file → create its note.
- Changed file → update its note (purpose, functions, links).
- Deleted file → put `**DELETED (YYYY-MM-DD)**` at the top of its note. Don't delete the note.
- Update the mermaid diagram in `_Index.md` if the structure changed.

**Style:** short, simple notes in plain language. Use [[wikilinks]] everywhere so Obsidian's Graph View shows the connections, and ```mermaid code blocks for diagrams.
