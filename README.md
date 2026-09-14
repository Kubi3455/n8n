# Viral Video Studio

A web application built from the n8n workflow **"Generate AI viral videos with NanoBanana & VEO3,
shared on socials via Blotato"**.

Members sign up, upload a reference image with a video idea, and the app runs the same five-stage
pipeline in the browser — live, with per-stage progress.

## Pipeline

1. **Fikir & görsel** — the member uploads a reference image and describes the video.
2. **NanoBanana görseli** — OpenAI Vision describes the reference, a prompt agent writes a UGC-style
   image prompt, and fal.ai's NanoBanana produces the edited image.
3. **Video senaryosu** — an agent fills the master prompt schema and returns `title` + `final_prompt`.
4. **VEO3 videosu** — kie.ai renders the clip from the structured prompt and the edited image.
5. **Yayın** — GPT rewrites the caption (under 200 characters), the clip is uploaded to Blotato and
   published in parallel to every platform the member enabled.

## What changed versus the n8n workflow

| n8n workflow | This app |
| --- | --- |
| Telegram bot as the entry point | Membership system (sign up, log in, own workspace) |
| Google Drive + Google Sheets | The app's own storage: `data/projects.json`, `data/users.json`, `data/settings.json` |
| Sheet CONFIG tab | Per-member settings dialog |
| Telegram notifications | Live SSE progress, log stream and project table in the UI |
| Fixed 20-second `Wait` nodes | Real polling loops, so slow renders no longer break the run |
| Credentials shared by the whole workflow | Provider keys stay server-side; social accounts are per member |

Prompts, the master prompt schema, the fan-out over the nine platforms and the 200-character caption
rule are carried over from the workflow unchanged.

## Running it

```bash
npm install
cp .env.example .env    # fill in whichever keys you have
npm start               # http://localhost:3000
```

Register an account on first visit. Every provider without an API key runs against a built-in fake,
so the whole flow is demoable before spending a credit — the header chips show which providers are
live and which are mocked.

### Going live

1. `OPENAI_API_KEY` — image analysis, both prompt agents, caption rewrite.
2. `FAL_API_KEY` — NanoBanana image edit (`https://queue.fal.run/fal-ai/nano-banana/edit`).
3. `KIE_API_KEY` — VEO3 render (`https://api.kie.ai/api/v1/veo/...`).
4. `BLOTATO_API_KEY` — publishing; each member adds their own `accountId` per platform in
   **Ayarlar** (plus the Facebook page id and the Pinterest board id).
5. `PUBLIC_URL` — only needed when the renderers must fetch the reference image over the network; on
   localhost the image is sent inline instead.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Membership |
| `GET` | `/api/auth/me` | Current session |
| `GET` | `/api/status` | User, provider status, settings |
| `GET`/`PUT` | `/api/settings` | Defaults and the member's social accounts |
| `POST` | `/api/jobs` | Start a run (`image` data URL, `idea`, `model`, `aspectRatio`, `platforms`) |
| `GET` | `/api/jobs`, `/api/jobs/:id` | Job state (steps, logs, results) |
| `GET` | `/api/events` | SSE stream of this member's job updates |
| `GET` | `/api/projects` | The member's projects |
| `DELETE` | `/api/projects/:imageKey` | Remove a project |

Everything except the auth routes requires a session cookie, and every query is scoped to the
logged-in member.

## Layout

```
server/
  index.js        HTTP API, uploads, SSE
  auth.js         registration, login, scrypt hashing, session cookies
  pipeline.js     the five stages
  jobs.js         job registry + event bus
  store.js        projects and per-member settings
  prompts.js      prompts carried over from the workflow
  services/       openai, fal (NanoBanana), kie (VEO3), blotato
public/           single-page UI (no build step)
```

## Security notes

- Passwords are hashed with `scrypt` and a per-user salt; login compares in constant time.
- Sessions are opaque random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when
  `PUBLIC_URL` is https).
- Provider API keys live only in the server environment and are never sent to the browser.
