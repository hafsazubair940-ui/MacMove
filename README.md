# MacMove

A marketplace where university students buy, sell and rent used furniture and textbooks.

- **Sign in with email:** full name, Mac ID and email, then a one-time sign-in link.
- **AI condition scanner:** take a photo of your furniture. Claude scores its condition out of 10, and 7 or more makes you a verified seller.
- **Ask an agent:** a real person can review an item and verify it by hand from the Agent desk.
- **Marketplace:** listings with Verified / Unverified badges. Sell, rent monthly, or both.
- **Textbooks:** buy, sell or rent course books, searchable by course code.
- **Move helper:** move-in and move-out checklists for international students, plus an AI helper chat.
- **Messages:** buyers and sellers chat in real time.

## How it's built

| Part | What it does |
|---|---|
| `public/` | The website: plain HTML, CSS and JavaScript, no build step. |
| `api/` | Vercel serverless functions. `scan.js` (AI condition check) and `helper.js` (move helper) call the Claude API. `config.js` gives the browser the public Supabase settings. |
| `supabase/schema.sql` | Database tables, security rules, photo storage and live updates. |

Hosting is on **Vercel**. Data, sign-in and photos are in **Supabase**. AI runs on the **Claude API** (model `claude-opus-5-5`).

## Setup (about 30 minutes)

### 1. Supabase: database and sign-in

1. Create a project at [supabase.com](https://supabase.com). Pick a region near your users (for example Canada Central).
2. Open **SQL Editor → New query**, paste all of [`supabase/schema.sql`](supabase/schema.sql), and click **Run**. You should see "Success".
3. Open **Project Settings → API Keys** and keep the page open. You'll need:
   - the **Project URL**,
   - the **publishable** key (or the legacy **anon** key),
   - the **secret** key (or the legacy **service_role** key). Keep this one private.
4. Open **Authentication → Sign In / Providers** and make sure **Email** is turned on.

### 2. Claude API key

1. Sign in at [console.anthropic.com](https://console.anthropic.com) and add some credit under **Billing**.
2. Create a key under **API Keys**. Don't share it or put it in the code.

### 3. Vercel: put the site online

1. Sign in at [vercel.com](https://vercel.com) with GitHub and click **Add New → Project**.
2. Import the **MacMove** repository. Leave **Framework Preset** as **Other** and the build settings empty.
3. Before you deploy, open **Environment Variables** and add these four (see [`.env.example`](.env.example)):

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | Supabase Project URL |
   | `SUPABASE_ANON_KEY` | Supabase publishable (or anon) key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase secret (or service_role) key |
   | `ANTHROPIC_API_KEY` | Your Claude API key |

4. Click **Deploy**. Vercel gives you a link like `https://macmove.vercel.app`.

### 4. Connect sign-in links to your site

In Supabase, open **Authentication → URL Configuration**:

- set **Site URL** to your Vercel link (for example `https://macmove.vercel.app`),
- add the same link under **Redirect URLs**.

Without this step, the sign-in email links point to the wrong place.

### 5. Make yourself an agent

Sign in on the live site once, then in Supabase open **Table Editor → profiles**, find your row and set `is_agent` to `true`. Refresh the site, and **Agent desk** appears in the menu.

## Good to know

- **Sign-in emails:** Supabase's built-in email service only sends a few emails per hour, which is fine for testing. For real launch traffic, connect your own email service under **Authentication → Emails → SMTP Settings**.
- **6-digit codes:** to let students type a code instead of clicking the link, add `{{ .Token }}` to the **Magic Link** and **Confirm signup** templates under **Authentication → Emails**.
- **AI limits:** each student can run 20 scans and ask the helper 40 questions per hour. Change these in `api/scan.js` and `api/helper.js`.
- **AI costs:** the scanner and helper use `claude-opus-5-5`, billed per use to your Claude API account. A scan usually costs a few cents or less.
- **Verified badges are decided on the server.** The browser can't mark its own listing verified. The badge comes from the scan record, or from an agent's decision.

## Local development

```bash
npm install
npx vercel dev
```

`vercel dev` runs the website and the `/api` functions together. Put your four settings in a `.env.local` file first (it's ignored by git).
