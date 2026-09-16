# Viral Video Studio

An AI content studio, originally sketched out from the n8n workflow **"Generate AI viral videos with
NanoBanana & VEO3"**. Members sign up, then generate one of four content types from a topic and an
optional reference image, with live per-stage progress. There is no auto-posting to social
platforms — every project hands you back a finished asset and a ready-to-copy caption instead.

## Content types

1. **Normal Video** — general purpose: a reference image (or none) plus an idea becomes a structured
   video prompt, with style, camera and mood chosen to fit that idea, then rendered by VEO3.
2. **UGC Reklam** — the same pipeline, constrained to a casual, handheld, authentic look (the
   original workflow's UGC style).
3. **Instagram Carousel** — a topic becomes a 6-slide swipeable carousel plan (hook → 4 points → CTA),
   an image is generated per slide, and the browser composites the headline/body text onto each
   image with `<canvas>` so every slide downloads as a finished PNG.
4. **3D Karakter** — for character designers: upload a character image to lift it straight into 3D,
   or describe one from scratch. Either way you get a rotatable, downloadable `.glb` mesh (Tripo3D via
   fal.ai) plus a rendered preview, viewable in-browser via `<model-viewer>`.

## Pipeline (video content types)

1. **Fikir & görsel** — the member describes the idea and optionally uploads a reference image.
2. **Görsel üretimi** — OpenAI Vision describes the reference, a prompt agent writes an image prompt
   (UGC-casual or general, depending on the mode), and fal.ai's NanoBanana produces the image.
3. **Video senaryosu** — an agent fills the master prompt schema and returns `title` + `final_prompt`.
4. **Video render** — kie.ai (VEO3) renders the clip from the structured prompt and the image.
5. **Paylaşım metni** — GPT writes a ready-to-copy caption, under 200 characters.

### Hook/Varyant Testi

Normal Video and UGC Reklam can generate **3-5 variants of the same idea** in one run, each opening
with a different "hook" angle — the reference image and image-generation step are shared and only run
once, but steps 3-5 above (script, render, caption) run independently per variant:

- Pick a variant count (1 = off) from the "Hook varyantları" selector next to the model/aspect ratio
  fields. The five angles — `stat` (şaşırtıcı istatistik), `question` (soru sorma), `objection`
  (doğrudan itiraz), `story` (hikaye anlatımı), `bold_claim` (cesur iddia) — are defined in
  `server/prompts.js` (`HOOK_ANGLES`/`HOOK_ANGLE_ORDER`) and picked in that order.
- Each variant gets its own script agent call, its own VEO3 render, and its own caption, so an
  N-variant job renders N distinct video files, shown side by side with independent progress and a
  separate download link each.
- **This costs N free credits, reserved atomically** — a 3-variant request needs all 3 credits or
  none of the job runs (no silently-degraded 2-variant fallback). The UI shows the credit cost next
  to the selector when it applies. A variant that fails refunds only its own credit; siblings that
  finished keep theirs spent.

## Pipeline (Instagram Carousel)

1. **Konu toplama** — the member describes the topic and optionally uploads a reference image.
2. **Carousel içerik planı** — an agent turns the topic into 6 slides, each with a Turkish
   headline/body and an English image prompt, following a hook → value → CTA arc.
3. **6 slayt görseli** — fal.ai generates (or edits the reference into) one image per slide, in
   parallel; each is re-hosted under the app's own `/uploads/` so the browser can safely read its
   pixels back for the next step.
4. **Paylaşım metni** — a caption for the whole carousel post.
   Slide text is composited **in the browser**, not on the server — this keeps the server dependency-
   free and guarantees correct Turkish text rendering. Each slide downloads as a finished PNG.

## Pipeline (3D Karakter)

1. **Konu ve görsel toplama** — the member describes the character and optionally uploads a reference.
2. **3D karakter prompt'u** — if a reference was given, OpenAI Vision describes it first; either way,
   an agent writes one prompt suited for 3D generation (art style, pose, "single centered subject,
   plain background" for clean reconstruction).
3. **3D model üretimi** — with a reference image, Tripo3D's image-to-3D endpoint lifts it directly
   (no NanoBanana re-edit first — the original art goes in untouched); without one, Tripo3D's
   text-to-3D endpoint generates from the prompt alone. Returns a `.glb` mesh and a rendered preview
   image, both re-hosted under `/uploads/`.
4. **Paylaşım metni** — a caption for the reveal post.

In mock mode this content type can only show the placeholder preview image — a real `.glb` file
needs a live `FAL_API_KEY`, so the "İndir" button and the `<model-viewer>` stay hidden until then and
a note explains why.

## Free credit system

Prices and free-credit amounts aren't final, so this whole feature lives in one file,
**`server/credits.js`**, with a "how to remove it" comment at the top:

- **Mock mode is always unlimited**, regardless of balance — trying the product costs nothing
  as long as no real provider key is configured (or `MOCK_MODE=1` is set).
- **A new signup gets `FREE_CREDITS_ON_SIGNUP` (default 2)** credits for runs against real,
  paid providers. One credit (or N, for an N-variant Hook/Varyant Testi job — see above) is
  reserved atomically before a real job starts (so concurrent requests can't overspend the
  balance) and refunded automatically for anything that didn't finish - a free trial shouldn't
  be spent on our bugs or a transient provider error.
- **Free credits only ever run the cheapest engine tier.** `ENGINE_TIERS` in `credits.js` maps
  each engine to a cheap/premium split (today only VEO3's `veo3_fast`/`veo3` model picker is
  wired to an actual UI control; NanoBanana/Tripo3D quality tiers are pre-configured there for
  when a selector for them exists). Requesting a premium tier on a free credit **downgrades**
  it rather than failing the job, with a note in the run's log explaining what happened.
- **Every free-credit output carries a watermark.** Carousel slides get it baked into the
  `<canvas>` compositing itself (so it survives the PNG download); video and 3D character
  results get a screen-only overlay on the result card (not burned into the actual video/mesh
  file - doing that would need a video-processing dependency this project deliberately avoids).
- **Running out** returns `402` with `code: "OUT_OF_CREDITS"` from `POST /api/jobs`; the UI
  shows a dialog explaining that continuing needs an upgrade (the upgrade button is an honest,
  disabled placeholder - there's no payment flow yet).
- Set `CREDIT_SYSTEM_ENABLED=0` to turn all of this off with no code changes - every job then
  runs unmetered, exactly as before this feature existed.

## Running it

Türkçe adım adım kılavuz: **[BASLANGIC.md](BASLANGIC.md)**.

The app has **no dependencies** — Node.js 18+ is all it needs, and there is no install step:

```bash
npm start            # or: node server/index.js
```

Or double-click `baslat.bat` (Windows), `baslat.command` (macOS), `baslat.sh` (Linux); the browser
opens by itself. If the port is taken the app moves to the next free one and prints the address.

Register an account on first visit. Every provider without an API key runs against a built-in fake,
so the whole flow is demoable before spending a credit — the "Deneme modu" pill (and the Ayarlar
dialog behind it) shows which providers are live and which are mocked. Add keys later by copying
`.env.example` to `.env`; each provider goes live on its own as soon as its key is present.

### Going live

1. `OPENAI_API_KEY` — image analysis, prompt agents, carousel planning, captions.
2. `FAL_API_KEY` — NanoBanana image edit/text-to-image, and Tripo3D image/text-to-3D (same key,
   same fal.ai account).
3. `KIE_API_KEY` — VEO3 render (only needed for the two video modes).
4. `PUBLIC_URL` — only needed when the renderers must fetch images over the network; on localhost
   the image is sent inline instead.

`FAL_3D_IMAGE_URL` / `FAL_3D_TEXT_URL` let you swap the Tripo3D model variant (e.g. the lower-poly
`p1` family) without touching code — see `.env.example`.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register`, `/api/auth/login`, `/api/auth/logout` | Membership |
| `GET` | `/api/auth/me` | Current session |
| `GET` | `/api/status` | User, provider status, settings |
| `GET`/`PUT` | `/api/settings` | Default model/aspect ratio for the video modes |
| `POST` | `/api/jobs` | Start a run (`contentType`, `image` data URL or none, `idea`, `model`, `aspectRatio`, `variantCount` for Normal Video/UGC hook variants) |
| `GET` | `/api/jobs`, `/api/jobs/:id` | Job state (steps, logs, results) |
| `GET` | `/api/events` | SSE stream of this member's job updates |
| `GET` | `/api/projects` | The member's projects |
| `DELETE` | `/api/projects/:imageKey` | Remove a project |

Everything except the auth routes requires a session cookie, and every query is scoped to the
logged-in member. A project's `imageKey` is scoped by content type too, so the same photo can become
a video project and a carousel project without either overwriting the other.

## Layout

```
server/
  index.js        HTTP API, uploads, SSE
  http-server.js  tiny router over node:http (so the app needs no framework)
  env.js          .env reader
  auth.js         registration, login, scrypt hashing, session cookies
  credits.js      free credit system - self-contained, see the file for how to remove it
  pipeline.js     runVideoPipeline (Normal Video / UGC) + runCarouselPipeline + runCharacterPipeline
  jobs.js         job registry + event bus, step lists per content type
  store.js        projects and per-member settings
  prompts.js      prompts for all four content types
  services/       openai, fal (NanoBanana + Tripo3D), kie (VEO3), media (re-hosts provider files)
public/           single-page UI (no build step) - content-type switcher, canvas compositing,
                  <model-viewer> for the 3D preview
```

## Security notes

- Passwords are hashed with `scrypt` and a per-user salt; login compares in constant time.
- Sessions are opaque random tokens in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` when
  `PUBLIC_URL` is https).
- Provider API keys live only in the server environment and are never sent to the browser.
