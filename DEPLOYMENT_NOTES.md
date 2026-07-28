# FCEI Platform — Latest Deployment Package
_Assembled 2026-07-28_

This is the current FCEI platform (Finland Creative Education Institute,
https://fcei.eu/platform) — a plain Node.js app (no build step) using
Prisma + PostgreSQL, served on port 8787 behind nginx.

## What's in here (and how it maps to what's LIVE)
- **server.mjs** — the confirmed live server. I verified this against the running
  production server on :8787 by fingerprinting its API routes (e.g.
  `/api/user/entitlements`, `/api/admin/email-templates`, `/api/admin/email-senders`),
  which are all present live. This is the newest revision (with the Stripe
  checkout, entitlements, SCORM, CMS and email-admin routes).
- **public/** — the live front-end: `index.html`, `styles.css`, `app.js` and the
  logo were pulled straight from the running site today so they match exactly
  what visitors see; the `assets/` course/service images are included too.
- **data/** — JSON seed/reference data (`seed.json`, `db.initial.json`) plus a
  dev snapshot (`db.json`, test accounts only, @fcei.test). NOTE: production data
  now lives in PostgreSQL (`fcei_db`), not these files.
- **scorm/** — SCORM lesson templates + generated lesson JSON (C01–C14 modules).
- **docs/** — API contract, database schema SQL, SCORM mapping, production notes.
- **tests/** — acceptance-flow test (`npm run test:flow`).
- **.env.example** — every environment variable the server reads. Real values are
  intentionally NOT included (see Security below).

## Run it
```
npm install          # installs deps (stripe, prisma client, etc.)
cp .env.example .env # then fill in the real values
node server.mjs      # starts on PORT (8787)
```
On the server it runs as a systemd service (`fcei-platform.service`, Restart=always)
from `/var/www/fcei.eu/platform/fcei_platform/`.

## Security note
No secrets are shipped in this zip. The live `.env` (Stripe live keys, etc.) stays
on the server only. `.env.example` shows the shape; copy your real values from the
server's `.env` when deploying. The git history/token were also excluded.

## One caveat
I don't have OS-level read access to the live deploy directory (it's owned by a
different system user), so this package is assembled from my working copies + the
live-served front-end + the route-verified server.mjs — not a raw byte-for-byte
copy of the server folder. It's functionally the current platform. If you'd like an
exact tarball of the live folder, run this on the server as root and send it back:
`tar czf /root/fcei_live.tgz -C /var/www/fcei.eu/platform fcei_platform --exclude=node_modules --exclude=.env`
