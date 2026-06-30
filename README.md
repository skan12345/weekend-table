# Weekend Table

A weekend restaurant picker for two — built as a Supabase-backed PWA you host on Vercel.
Save spots you find on Instagram / Threads / Little Red Note / Google, share Maps links
straight into the app from your phone, and let it pick where to eat: nearby for Saturday
dinner, farther afield for Sunday brunch.

## What's in here

```
src/            React app (Vite)
  App.jsx       UI: Decide picker, Our Places, Settings, Add/Edit form
  db.js         Supabase data layer
  lib.js        Maps-link parsing + distance helpers
api/
  resolve-maps.js   Serverless function: expands short maps.app.goo.gl links
public/
  manifest.webmanifest   PWA manifest incl. Android share_target
  sw.js                  Service worker (makes the app installable)
  icon-*.png             App icons (swap for your own anytime)
supabase/
  schema.sql      Tables, realtime, and RLS — run once in Supabase
```

## Setup (about 10 minutes)

### 1. Create the Supabase database
1. Make a project at supabase.com.
2. Open **SQL Editor → New query**, paste all of `supabase/schema.sql`, and **Run**.
3. Go to **Project Settings → API** and copy your **Project URL** and **anon public key**.

### 2. Configure environment variables
```bash
cp .env.example .env
```
Fill in:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

### 3. Run it locally
```bash
npm install
npm run dev          # UI only
# or, to also run the /api resolver locally:
npm i -g vercel && vercel dev
```
Open the printed URL. (With `npm run dev`, short-link resolving falls back to a
"paste the full link" message because `/api` isn't served — that's expected; it
works once deployed, or under `vercel dev`.)

### 4. Deploy to Vercel
1. Push this folder to a GitHub repo.
2. In Vercel, **Add New → Project → import the repo**. Framework preset: **Vite**.
3. Add the same env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) under
   **Settings → Environment Variables**, then deploy.
4. (Optional) Add `GOOGLE_MAPS_API_KEY` to also auto-fill street addresses.

Vercel automatically serves `/api/resolve-maps` as a serverless function — no extra config.

## Using it on your phones

### Install the app
- **Android (Chrome):** open your Vercel URL → menu (⋮) → **Install app**.
- **iPhone (Safari):** open the URL → Share → **Add to Home Screen**.

### One-tap capture from Maps / social apps
- **Android:** once installed, tap **Share** in Google Maps (or Instagram, etc.) →
  pick **Weekend Table**. The Add form opens, pre-filled. The shared Maps link is
  usually a short `maps.app.goo.gl` one — the resolver expands it automatically.
- **iPhone:** iOS Safari can't register share targets, so use a **Shortcut**:
  1. Shortcuts app → new shortcut → turn on **Show in Share Sheet**, accept **URLs and Text**.
  2. Add one action — **Open URLs** — set to `https://your-app.vercel.app/?url=[Shortcut Input]`.
  3. Name it "Weekend Table." Now it appears in the share sheet.

  Because the data lives in Supabase, it doesn't matter whether the Shortcut opens the
  installed app or a Safari tab — both write to the same shared list.

## How the pieces fit

- **Sharing a link** lands at `/?url=…` (or `?text=…`). `App.jsx` reads it on load and
  opens the Add form.
- **Short links** (`maps.app.goo.gl`) can't be expanded in a browser (CORS), so the app
  POSTs them to `/api/resolve-maps`, which follows the redirect server-side and returns
  the name + coordinates (+ address if you set a Google key).
- **Distance** is computed locally from your saved home (Settings) to each place's
  coordinates; under your chosen radius → tagged *Close* (Saturday), else *Worth the trip*
  (Sunday).
- **Live sync** uses Supabase Realtime, so a place either of you adds shows up on both phones.

## A note on access
The included RLS policies are **open** — anyone who has both your app URL and the anon key
(which ships in the client bundle) could read or write. For a private tool whose URL you
keep to yourselves, that's a reasonable trade for zero-friction setup. To lock it down,
turn on **Supabase Auth** (e.g. magic-link for just the two of you) and replace the
policies in `schema.sql` with auth-gated ones like `using (auth.role() = 'authenticated')`.
