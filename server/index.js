import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { attachUser, clearSessionCookie, createSession, destroySession, login, register, requireAuth, setSessionCookie } from './auth.js';
import { config, isFullyMocked, paths, providerStatus, setPublicUrl } from './config.js';
import * as credits from './credits.js'; // self-contained; see server/credits.js to remove
import { createServer, listenOnFreePort } from './http-server.js';
import { bus, createJob, getJob, listJobs, log, restoreJobs, setStatus } from './jobs.js';
import { runPipeline } from './pipeline.js';
import { HOOK_ANGLES, HOOK_ANGLE_ORDER } from './prompts.js';
import {
  CONTENT_TYPES,
  OPTIONAL_IMAGE_TYPES,
  brandKitHasContent,
  deleteBrandKit,
  deleteProject,
  getBrandKit,
  getSettings,
  listProjects,
  saveBrandKit,
  saveSettings,
} from './store.js';

const app = createServer({
  staticDirs: [
    { prefix: '/uploads', dir: paths.uploads },
    { prefix: '/', dir: paths.public },
  ],
});

app.use(attachUser);

const EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * Decodes the browser's data URL upload into a file on disk. Only the carousel allows a
 * missing image (a topic alone is enough); the two video modes still require one.
 */
const saveUpload = async (dataUrl, userId) => {
  if (!dataUrl) return { imageKey: null, filePath: null, publicUrl: null };

  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl);
  if (!match) throw new Error('Bir görsel yükleyin');

  const [, mime, base64] = match;
  const extension = EXTENSION_BY_MIME[mime.toLowerCase()];
  if (!extension) throw new Error(`Desteklenmeyen görsel türü: ${mime}`);

  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > 20 * 1024 * 1024) throw new Error('Görsel 20 MB sınırını aşıyor');

  // Content hash as the project key: re-submitting the same picture updates that project.
  const imageKey = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
  const fileName = `${userId}-${imageKey}${extension}`;
  await fs.mkdir(paths.uploads, { recursive: true });
  await fs.writeFile(path.join(paths.uploads, fileName), buffer);

  return { imageKey, filePath: path.join(paths.uploads, fileName), publicUrl: `${config.publicUrl}/uploads/${fileName}` };
};

/** A carousel with no uploaded image still needs a stable project key. */
const keyFromIdea = (idea) => crypto.createHash('sha1').update(`${Date.now()}:${idea}`).digest('hex').slice(0, 16);

const fail = (res, error) => res.json(error.status || 400, { error: error.message });

// ---------- membership ------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await register(req.body);
    setSessionCookie(res, await createSession(user.id));
    res.json(201, { user });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const user = await login(req.body);
    setSessionCookie(res, await createSession(user.id));
    res.json(200, { user });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  if (req.sessionToken) await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json(200, { ok: true });
});

app.get('/api/auth/me', (req, res) => res.json(200, { user: req.user }));

// ---------- app -------------------------------------------------------------
app.get('/api/status', async (req, res) => {
  const settings = req.user ? await getSettings(req.user.id) : null;
  const creditStatus = req.user ? await credits.publicStatus(req.user.id, { isFullyMocked: isFullyMocked() }) : null;
  res.json(200, { user: req.user, providers: providerStatus(), settings, credits: creditStatus, publicUrl: config.publicUrl });
});

app.get('/api/settings', async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(200, await getSettings(req.user.id));
});

app.put('/api/settings', async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    res.json(200, await saveSettings(req.user.id, req.body));
  } catch (error) {
    fail(res, error);
  }
});

// ---------- Marka Kiti (Brand Kit) ------------------------------------------
app.get('/api/brand-kit', async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(200, await getBrandKit(req.user.id));
});

app.put('/api/brand-kit', async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const { referenceImages = [], colorPalette = [], toneInstruction = '', characterDescription = '' } = req.body;
    if (!Array.isArray(referenceImages) || !Array.isArray(colorPalette)) {
      return res.json(400, { error: 'Geçersiz marka kiti verisi' });
    }

    // Each item is either a brand-new data URL upload, or an existing hosted URL the member
    // kept from before - resolved back to its stored {url, filePath} so localhost inlining
    // still works without re-uploading anything that wasn't actually changed.
    const current = await getBrandKit(req.user.id);
    const resolvedImages = [];
    for (const item of referenceImages.slice(0, 5)) {
      if (typeof item !== 'string' || !item) continue;
      if (item.startsWith('data:')) {
        const upload = await saveUpload(item, req.user.id);
        resolvedImages.push({ url: upload.publicUrl, filePath: upload.filePath });
      } else {
        resolvedImages.push(current.referenceImages.find((ref) => ref.url === item) || { url: item, filePath: null });
      }
    }

    const kit = await saveBrandKit(req.user.id, {
      referenceImages: resolvedImages,
      colorPalette: colorPalette.filter((color) => typeof color === 'string' && color.trim()).map((color) => color.trim().slice(0, 40)).slice(0, 12),
      toneInstruction: String(toneInstruction).slice(0, 1000),
      characterDescription: String(characterDescription).slice(0, 1000),
    });
    res.json(200, kit);
  } catch (error) {
    fail(res, error);
  }
});

app.delete('/api/brand-kit', async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(200, await deleteBrandKit(req.user.id));
});

app.get('/api/projects', async (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(200, await listProjects(req.user.id));
});

app.delete('/api/projects/:imageKey', async (req, res) => {
  if (!requireAuth(req, res)) return;
  const removed = await deleteProject(req.user.id, req.params.imageKey);
  res.json(removed ? 200 : 404, { removed });
});

app.get('/api/jobs', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json(200, listJobs(req.user.id));
});

app.get('/api/jobs/:id', (req, res) => {
  if (!requireAuth(req, res)) return;
  const job = getJob(req.params.id, req.user.id);
  if (!job) return res.json(404, { error: 'Akış bulunamadı' });
  res.json(200, job);
});

// Only Normal Video and UGC Reklam support hook/angle variants and multi-format export today.
const VARIANT_CONTENT_TYPES = new Set(['video', 'ugc']);
const MAX_VARIANTS = HOOK_ANGLE_ORDER.length; // 5 - one per defined angle
const SUPPORTED_FORMATS = ['16:9', '9:16', '1:1'];
const MAX_FORMATS = SUPPORTED_FORMATS.length;

app.post('/api/jobs', async (req, res) => {
  if (!requireAuth(req, res)) return;
  let reservation = { allowed: true, usedFreeCredit: false, count: 0 };
  try {
    const { image, idea = '', model, aspectRatio, contentType, variantCount, useBrandKit, formats } = req.body;
    const type = CONTENT_TYPES[contentType] || CONTENT_TYPES.ugc;

    if (!OPTIONAL_IMAGE_TYPES.has(type) && !image) return res.json(400, { error: 'Bir görsel yükleyin' });
    if (!String(idea).trim() && !image) return res.json(400, { error: 'Bir konu ya da fikir yazın' });

    // Hook/Varyant Testi: 1-5 variants, each its own script+video+caption. N variants = N
    // times the real-provider cost, so the credit reservation below scales with it directly.
    const isVariantType = VARIANT_CONTENT_TYPES.has(type);
    const requestedVariants = isVariantType ? Math.max(1, Math.min(MAX_VARIANTS, Number(variantCount) || 1)) : 1;
    const variantSpecs = isVariantType
      ? HOOK_ANGLE_ORDER.slice(0, requestedVariants).map((angle, index) => ({
          id: `v${index + 1}`,
          angle,
          angleLabel: HOOK_ANGLES[angle].label,
        }))
      : undefined;

    const settings = await getSettings(req.user.id);

    // Çoklu Format Export: each requested format is its own VEO3 render per variant, so - just
    // like extra hook variants - it multiplies real-provider cost directly. A bad/missing list
    // falls back to the single legacy aspectRatio field, so older API/webhook callers (Feature 5)
    // that only ever knew about `aspectRatio` keep working unchanged.
    const requestedFormatList = isVariantType && Array.isArray(formats)
      ? [...new Set(formats.filter((value) => SUPPORTED_FORMATS.includes(value)))].slice(0, MAX_FORMATS)
      : [];
    const resolvedFormats = requestedFormatList.length > 0 ? requestedFormatList : [aspectRatio || settings.aspectRatio];
    const requestedFormats = resolvedFormats.length;

    // Credit gate: reserve before any upload/pipeline work starts, so a request that will
    // be refused never touches disk or spends anything. Mock-mode runs never reach here
    // as anything but free (isFullyMocked short-circuits reserve() to always allow).
    reservation = await credits.reserve({ userId: req.user.id, isFullyMocked: isFullyMocked(), count: requestedVariants * requestedFormats });
    if (!reservation.allowed) {
      const detail = reservation.needed > 1
        ? ` Bu istek ${reservation.needed} kredi gerektiriyor, ${reservation.remaining} krediniz kaldı.`
        : '';
      return res.json(402, {
        error: `${credits.OUT_OF_CREDITS_MESSAGE}${detail}`,
        code: 'OUT_OF_CREDITS',
        creditsRemaining: reservation.remaining,
        creditsNeeded: reservation.needed,
      });
    }

    // Free credits only ever run the cheapest engine tier - downgraded, not rejected, so a
    // pre-selected "quality" option never turns into a hard failure for a free run.
    const requestedModel = model || settings.model;
    const { value: effectiveModel, downgraded } = credits.enforceFreeTier('veo3', requestedModel, {
      usedFreeCredit: reservation.usedFreeCredit,
    });

    const upload = await saveUpload(image, req.user.id);
    // Scoped by content type too: the same photo can become a video AND a carousel
    // without one overwriting the other's project.
    const imageKey = `${type}:${upload.imageKey || keyFromIdea(idea)}`;

    // Marka Kiti: resolved once, here, and snapshotted onto the job's own input rather than
    // re-read from disk mid-pipeline - so what actually ran stays reproducible in job history
    // even if the member edits their brand kit again before this job finishes.
    const brandKit = useBrandKit ? await getBrandKit(req.user.id) : null;
    const appliedBrandKit = brandKit && brandKitHasContent(brandKit) ? brandKit : null;

    const running = listJobs(req.user.id).find(
      (job) => job.imageKey === imageKey && (job.status === 'running' || job.status === 'queued'),
    );
    if (running) {
      if (reservation.usedFreeCredit) await credits.refund(req.user.id, 'duplicate request', reservation.count);
      return res.json(409, { error: 'Bu içerik için bir akış zaten çalışıyor' });
    }

    const job = createJob({
      userId: req.user.id,
      imageKey,
      contentType: type,
      usedFreeCredit: reservation.usedFreeCredit,
      variants: variantSpecs,
      input: {
        idea: String(idea).slice(0, 2000),
        model: effectiveModel,
        aspectRatio: aspectRatio || settings.aspectRatio,
        formats: resolvedFormats,
        brandKit: appliedBrandKit,
      },
    });
    if (downgraded) log(job, `Ücretsiz kredi: "${requestedModel}" yerine "${effectiveModel}" kullanılıyor`, 'warn');
    if (requestedVariants > 1) log(job, `${requestedVariants} hook varyantı üretilecek: ${variantSpecs.map((v) => v.angleLabel).join(', ')}`);
    if (requestedFormats > 1) log(job, `${requestedFormats} format render edilecek: ${resolvedFormats.join(', ')}`);
    if (appliedBrandKit) log(job, 'Marka kiti bu üretime uygulandı');

    // Fire and forget: progress reaches the browser over SSE. Any variant that didn't finish
    // (or the whole job, for content types without variants) refunds its own credit - free
    // trials shouldn't be spent on our bugs, a transient provider error, or a variant that
    // failed while its siblings succeeded.
    runPipeline(job, { ...upload, imageKey })
      .catch((error) => {
        console.error('Pipeline crashed:', error);
        setStatus(job, 'failed', error.message);
      })
      .then(() => {
        if (!reservation.usedFreeCredit) return undefined;
        // Each unfinished variant is worth `requestedFormats` credits, not one - a variant
        // reserved one credit per format it was going to render.
        const unearned = job.variants.length > 0
          ? job.variants.filter((variant) => variant.status !== 'done').length * requestedFormats
          : (job.status === 'failed' ? reservation.count : 0);
        if (unearned > 0) return credits.refund(req.user.id, 'pipeline failed', unearned);
        return undefined;
      })
      .catch((error) => console.error('Credit refund failed:', error));
    res.json(202, job);
  } catch (error) {
    // Reached only when something threw after a credit was already reserved but before a
    // job took ownership of it (e.g. a bad upload) - give it back rather than lose it.
    if (reservation.usedFreeCredit) await credits.refund(req.user.id, 'request failed before job started', reservation.count).catch(() => {});
    fail(res, error);
  }
});

/** Server-sent events: one stream carrying this member's job updates. */
app.get('/api/events', (req, res) => {
  if (!requireAuth(req, res)) return;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ event: 'hello', jobs: listJobs(req.user.id) })}\n\n`);

  const userId = req.user.id;
  const onUpdate = (payload) => {
    if (payload.job.userId !== userId) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  bus.on('jobs', onUpdate);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('jobs', onUpdate);
  });
});

await restoreJobs();

const port = await listenOnFreePort(app.server, config.port);
if (!process.env.PUBLIC_URL) setPublicUrl(`http://localhost:${port}`);

/** Opens the default browser when started by a double-click launcher. */
const openBrowser = (url) => {
  if (process.env.OPEN_BROWSER === '0' || !process.stdout.isTTY) return;
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // Opening the browser is a convenience; the URL is printed either way.
  }
};

const providers = providerStatus();
const missing = ['openai', 'fal', 'kie'].filter((key) => !providers[key]);
console.log('');
console.log('  ===========================================');
console.log('   VIRAL VIDEO STUDIO');
console.log('  ===========================================');
console.log('');
console.log(`   Tarayicida ac:  ${config.publicUrl}`);
console.log('');
console.log(`   Klasor:  ${paths.root}`);
console.log(`   ${missing.length ? `Mock mod: ${missing.join(', ')} (API anahtari girilmedi)` : 'Tum servisler canli'}`);
console.log('');
console.log('   Bu pencereyi kapatma - kapatirsan uygulama durur.');
console.log('   Durdurmak icin: Ctrl+C');
console.log('');

openBrowser(config.publicUrl);
