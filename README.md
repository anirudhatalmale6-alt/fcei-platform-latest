# FCEI Live-Ready Platform — Nordic Redesign & Integration Pack

This pack consolidates the FCEI commercial engine, LMS module workflow, SCORM lesson
flow, toolkit marketplace, cookie consent, CMS copy, course catalogue, pricing logic,
module-completion algorithm, evidence upload, Transferability Filter, certificates and
admin reporting into one runnable full-stack handoff — now with a complete redesign.

## What changed in this redesign

- **New Nordic design system.** A full hand-built stylesheet (`public/styles.css`)
  using a fjord / lake / spruce / mint palette on snow and birch neutrals, with
  Familjen Grotesk, Hanken Grotesk and Space Mono type, and a signature hairline
  "track" motif that encodes the module/step sequence. No CSS framework.
- **Rebuilt single-page front-end** (`public/app.js`, vanilla JS) covering home,
  catalogue (filter + strand pills + keyword search), course detail, the 8-step
  gated LMS workflow, TVET, consultancy, resource hub + escalation engine, booking,
  learner dashboard, legal centre and admin — plus a ⌘/Ctrl-K command palette,
  auth modal, cookie banner, toasts and reveal-on-scroll.
- **Copy refreshed verbatim from the live site** (`https://www.fcei.eu/`), stored in
  the seed `content` block and served via `/api/site`. NOTE: the live site describes
  "12 courses"; this platform actually ships **14 courses / 84 modules**, so the
  rendered counts reflect the real catalogue (14) while the descriptive copy is kept
  verbatim. Adjust the course count in the copy if you prefer it to read 14.
- **Uploaded photography embedded.** 23 optimised images in `public/assets/`
  (`c01`–`c11`, `s01`–`s12`) drive the course cards, course-detail heroes, home
  pathways and the TVET/consultancy service grids.
- **Pricing bug fixed.** Products now carry a `price` field in pence (`priceGBP × 100`)
  so the checkout/payment endpoints compute order amounts correctly.
- **Server patched** (`server.mjs`): the static file server now serves image and font
  MIME types (so `/assets/*` render), and `GET /api/site` now returns `content` and
  `services` in addition to brand, copy, courses and products.

## Two ways to view it

- **`public/index.html`** is the live front-end. It boots in `live` mode, fetches the
  API and loads images from `/assets/`. This is what `node server.mjs` serves.
- A standalone **`FCEI_Platform_Preview.html`** (delivered alongside this pack, not
  inside it) runs entirely in the browser in `demo` mode with a trimmed embedded seed
  and inlined images — no server required. Course C01 is fully interactive end to end;
  other courses show the structure with a lite notice.

## Run locally

```bash
node server.mjs
```

Open:

```text
http://localhost:8787
```

Run acceptance test:

```bash
node tests/acceptance-flow.mjs
```

## Live deployment replacements still required

This is a working full-stack local engine. Before public launch, replace the mock
services with production services:

- Stripe Checkout and signed webhook verification.
- PostgreSQL/MySQL database (the dev store is a JSON file at `data/db.json`).
- Real authentication/session provider (current sessions are in-process tokens).
- Secure file storage (S3, Cloudflare R2, Supabase Storage or DigitalOcean Spaces).
- Real video hosting URLs in place of the HeyGen video placeholders.
- Real certificate PDF generation and QR verification.
- Production SCORM runtime wrapper if importing SCORM ZIP packages.
- Email provider and legally reviewed compliance pages.

## Copyright / copy note

The CMS seed includes copy and page labels taken from the live FCEI site. This is
FCEI's own content used on FCEI's own platform. If extending the copy, use only text
FCEI owns or is licensed to use.
