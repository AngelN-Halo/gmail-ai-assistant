# Gmail AI Assistant

A small self-hosted web app that connects to your own Gmail account and uses a **locally hosted**
AI model to:

- fetch and store your recent inbox messages
- classify each one (category + priority, e.g. "Action Needed", "Waiting on Reply", "FYI / Newsletter")
- mirror that classification back onto Gmail as labels (`AI/<category>`)
- generate a suggested reply draft, which you can edit
- save the (edited) draft into your real Gmail Drafts folder
- optionally send it — **only** when you explicitly click "Send Now" and confirm; nothing is ever sent automatically

Stack: Next.js (App Router, TypeScript), SQLite (via `better-sqlite3`), the official Gmail API
(`googleapis`), and any OpenAI-compatible model server (llama.cpp, Ollama, vLLM, LM Studio).
No third-party AI API is used — email content never leaves your machine.

---

## 1. Deployment topology (read this first)

The app talks to your model server over the local network, so **the app and the model must be
reachable from each other**. In practice that means running the app on the same box (or same LAN)
as the model, and exposing *only the app* to the internet:

```
internet ──HTTPS──> reverse proxy / tunnel ──> Next.js app (port 3000)
                                                    │
                                                    └──> model server (127.0.0.1:8000)
```

This rules out deploying to Vercel, Fly, or Render while keeping a LAN-local model — those
platforms can't reach `192.168.x.x`. Run it on your own box behind Caddy, nginx, or a Cloudflare
Tunnel.

> ⚠️ **Do not expose your model server's port.** llama.cpp, Ollama, and friends have **no
> authentication** by default. If your box is internet-facing, firewall the model port so only
> localhost can reach it:
>
> ```bash
> sudo ufw deny 8000/tcp
> ```
>
> and bind the model server to loopback (`--host 127.0.0.1`) if nothing else on the LAN needs it.
> Otherwise anyone who finds the port gets free use of your GPU.

---

## 2. One-time Google Cloud setup

You need your own OAuth client so the app can ask Gmail for permission on your behalf.

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and create a project.
2. **APIs & Services → Library** → search "Gmail API" → Enable.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (fine for personal use).
   - Publishing status: leave in **Testing**.
   - Under "Test users", add your own Gmail address — required while the app is unverified.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URIs: the exact callback URL you'll use, e.g.
     `https://mail.example.com/api/auth/google/callback`
   - Copy the **Client ID** and **Client Secret**.

**Caveat on the `gmail.send` scope:** Google classifies it as restricted/sensitive. In Testing mode
it works for you and your listed test users, but refresh tokens for unverified apps can expire
after 7 days, so you'll occasionally need to reconnect. Publishing to a wider audience would
require Google's verification review.

---

## 3. Configure environment variables

```bash
cp .env.example .env.local
```

| Variable | Required | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | ✅ | From step 2 |
| `GOOGLE_REDIRECT_URI` | ✅ | Must exactly match a URI registered on the OAuth client |
| `APP_BASE_URL` | ✅ | Your real public origin. Also drives same-origin checks and the Secure cookie flag |
| `ALLOWED_EMAILS` | ✅ | Comma-separated allow list. **Fail-closed** — empty means nobody can sign in |
| `SESSION_SECRET` | ✅ | `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | ✅ | `openssl rand -hex 32` — encrypts your Gmail refresh token at rest |
| `AI_BASE_URL` | ✅ | e.g. `http://127.0.0.1:8000/v1` |
| `AI_MODEL` | ✅ | Model id as your server reports it at `GET /v1/models` |
| `AI_API_KEY` | — | Only if your model server requires one |
| `AI_TIMEOUT_MS` | — | Defaults to 90000 |

---

## 4. Run locally

```bash
npm install
```

> **npm 10+ blocks install scripts.** `better-sqlite3` is a native module and will not build
> without them, and the app crashes on first database access. If you see a warning about blocked
> install scripts, run:
>
> ```bash
> npm install-scripts approve better-sqlite3 && npm rebuild better-sqlite3
> ```

Then:

```bash
npm run dev
```

Visit your `APP_BASE_URL`, click **Connect Gmail**, and sign in with an address listed in
`ALLOWED_EMAILS`.

---

## 5. Choosing and running a model

Anything exposing `POST /v1/chat/completions` works. Developed against llama.cpp:

```bash
llama-server --host 127.0.0.1 --port 8000 -m Qwen3.5-4B-Q4_K_M.gguf --ctx-size 16384
```

Confirm the app can see it:

```bash
curl -s http://127.0.0.1:8000/v1/models
```

Notes on model choice:

- **Reasoning models need thinking disabled.** Models like Qwen3.5 will otherwise spend the whole
  token budget on hidden reasoning and return an empty response. `src/lib/ai.ts` sends both
  `reasoning_effort: "none"` and `chat_template_kwargs.enable_thinking: false`; servers ignore
  whichever they don't recognise.
- **Classification uses a constrained JSON schema** (`response_format: json_schema`), which
  llama.cpp and vLLM enforce with a grammar. This is what makes a 4B model reliable here. If your
  server doesn't support it, the code falls back to extracting the first JSON object from the
  response.
- The schema deliberately puts `reasoning` first so the model justifies before it commits — this
  measurably improves small-model classification.

A 4B model at Q4 classifies or drafts in roughly a second on modest hardware.

---

## 6. Security model

Because this is intended to be internet-facing, the app assumes a hostile network:

| Control | Where |
|---|---|
| **OAuth CSRF protection** — random nonce in an httpOnly cookie, matched against the `state` parameter, single-use, constant-time compare | `src/lib/oauthState.ts` |
| **Access allow list** — only addresses in `ALLOWED_EMAILS` may connect; fail-closed | `src/lib/security.ts` |
| **Same-origin enforcement** on every state-changing route, on top of the `SameSite=Lax` session cookie | `src/lib/security.ts`, `src/lib/guard.ts` |
| **Per-user rate limits** on sync / classify / draft / save / send, plus a per-IP limit on sign-in | `src/lib/rateLimit.ts` |
| **Refresh tokens encrypted at rest** with AES-256-GCM | `src/lib/crypto.ts` |
| **Opaque error responses** — real errors are logged server-side, never returned to the browser | `src/lib/guard.ts` |
| **Email header-injection defence** — CR/LF stripped and non-ASCII RFC 2047 encoded before any header is built | `src/lib/gmail.ts` |
| **Prompt-injection containment** — the drafting prompt instructs the model to treat email bodies as content, never instructions; and every draft requires human review plus an explicit confirm before sending | `src/lib/ai.ts` |
| **Security headers** — CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy, Permissions-Policy; framework banner disabled | `next.config.ts` |
| **Secure session cookie** — httpOnly, `SameSite=Lax`, `Secure` whenever `APP_BASE_URL` is HTTPS | `src/lib/session.ts` |

Known limits, stated plainly:

- **Rate limits are in-process.** They reset on restart and are per-instance. Fine for the
  single-process deployment this targets; move to Redis or SQLite if you run several instances.
- **CSP allows `'unsafe-inline'` for scripts**, because Next.js injects inline hydration scripts.
  Tightening this needs nonce-based CSP via middleware.
- **A draft is only as trustworthy as the model.** Always read a draft before sending — the send
  route requires a saved, reviewed Gmail draft plus an explicit `confirm: true`, and nothing in the
  app ever sends automatically.

---

## 7. Deploy behind HTTPS

Example Caddyfile:

```
mail.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Then:

```bash
npm run build
npm run start
```

Checklist:

1. Set every required env var, with `APP_BASE_URL` and `GOOGLE_REDIRECT_URI` on your real HTTPS domain.
2. Add that redirect URI to the Google OAuth client.
3. Keep `data/` on persistent storage — it holds the SQLite database with your encrypted refresh
   token and cached mail.
4. Firewall the model port (see §1).
5. Run the app as a non-root user under a process supervisor (systemd, pm2, Docker restart policy).

---

## How your data is handled

- Gmail refresh tokens are encrypted (AES-256-GCM) before being stored in the local SQLite database.
- Synced email content is stored locally so it doesn't need re-fetching and re-classifying.
- **Email content never leaves your infrastructure** — classification and drafting run against your
  own model server.
- No email is ever sent, and no Gmail draft is created or modified, without you clicking a button
  for that specific email.

---

## Project structure

```
src/
  app/
    page.tsx                       server component: session + first page of mail
    api/auth/google/login          starts OAuth, issues CSRF state
    api/auth/google/callback       verifies state, checks allow list, stores encrypted token
    api/auth/logout
    api/me                         lightweight auth probe (useful for debugging/monitoring)
    api/emails                     list stored emails, newest first
    api/emails/sync                pull recent inbox messages into local DB
    api/emails/[id]/classify       classify one email + apply a Gmail label
    api/emails/[id]/draft          generate a reply draft
    api/emails/[id]/save-draft     push the edited draft into real Gmail Drafts
    api/emails/[id]/send           explicit, confirmed send of a saved draft
  components/Dashboard.tsx         the UI (connect, sync, list, classify, draft, send)
  lib/
    ai.ts                          OpenAI-compatible model client (classify + draft)
    google.ts                      OAuth2 client + scopes
    gmail.ts                       Gmail helpers (list/parse, labels, drafts, send)
    db.ts                          SQLite schema, migrations, connection
    crypto.ts                      token encryption at rest
    session.ts                     cookie session (iron-session)
    oauthState.ts                  OAuth CSRF state
    security.ts                    allow list + origin checks
    rateLimit.ts                   per-user / per-IP limits
    guard.ts                       shared route guard + error handling
    requireUser.ts                 auth guard used by API routes
```

## Roadmap ideas (not built yet)

- Incremental sync via Gmail's history API instead of re-fetching the last N messages.
- Batch "classify all unclassified" action.
- Fully autonomous auto-reply for specific trusted senders, gated by explicit user-defined rules.
