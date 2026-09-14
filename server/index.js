import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import {
  attachUser,
  clearSessionCookie,
  createSession,
  destroySession,
  login,
  register,
  requireAuth,
  setSessionCookie,
} from './auth.js';
import { config, paths, providerStatus } from './config.js';
import { bus, createJob, getJob, listJobs, restoreJobs } from './jobs.js';
import { runPipeline } from './pipeline.js';
import { deleteProject, getSettings, listProjects, saveSettings } from './store.js';

const app = express();
app.use(express.json({ limit: '30mb' }));
app.use(attachUser);
app.use(express.static(paths.public));
app.use('/uploads', express.static(paths.uploads));

const EXTENSION_BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** Decodes the browser's data URL upload into a file on disk. */
const saveUpload = async (dataUrl, userId) => {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(dataUrl || '');
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

const fail = (res, error) => res.status(error.status || 400).json({ error: error.message });

// ---------- membership ------------------------------------------------------
app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await register(req.body || {});
    setSessionCookie(res, await createSession(user.id));
    res.status(201).json({ user });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const user = await login(req.body || {});
    setSessionCookie(res, await createSession(user.id));
    res.json({ user });
  } catch (error) {
    fail(res, error);
  }
});

app.post('/api/auth/logout', async (req, res) => {
  if (req.sessionToken) await destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => res.json({ user: req.user }));

// ---------- app -------------------------------------------------------------
app.get('/api/status', async (req, res) => {
  const settings = req.user ? await getSettings(req.user.id) : null;
  res.json({ user: req.user, providers: providerStatus(), settings, publicUrl: config.publicUrl });
});

app.get('/api/settings', requireAuth, async (req, res) => res.json(await getSettings(req.user.id)));

app.put('/api/settings', requireAuth, async (req, res) => {
  try {
    res.json(await saveSettings(req.user.id, req.body || {}));
  } catch (error) {
    fail(res, error);
  }
});

app.get('/api/projects', requireAuth, async (req, res) => res.json(await listProjects(req.user.id)));

app.delete('/api/projects/:imageKey', requireAuth, async (req, res) => {
  const removed = await deleteProject(req.user.id, req.params.imageKey);
  res.status(removed ? 200 : 404).json({ removed });
});

app.get('/api/jobs', requireAuth, (req, res) => res.json(listJobs(req.user.id)));

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const job = getJob(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'Akış bulunamadı' });
  res.json(job);
});

app.post('/api/jobs', requireAuth, async (req, res) => {
  try {
    const { image, idea = '', model, aspectRatio, platforms } = req.body || {};
    const settings = await getSettings(req.user.id);
    const upload = await saveUpload(image, req.user.id);

    const running = listJobs(req.user.id).find(
      (job) => job.imageKey === upload.imageKey && (job.status === 'running' || job.status === 'queued'),
    );
    if (running) return res.status(409).json({ error: 'Bu görsel için bir akış zaten çalışıyor' });

    const job = createJob({
      userId: req.user.id,
      imageKey: upload.imageKey,
      input: {
        idea: String(idea).slice(0, 2000),
        model: model || settings.model,
        aspectRatio: aspectRatio || settings.aspectRatio,
        platforms: Array.isArray(platforms) && platforms.length
          ? platforms
          : settings.platforms.filter((platform) => platform.enabled).map((platform) => platform.id),
      },
    });

    // Fire and forget: progress reaches the browser over SSE.
    runPipeline(job, upload).catch((error) => console.error('Pipeline crashed:', error));
    res.status(202).json(job);
  } catch (error) {
    fail(res, error);
  }
});

/** Server-sent events: one stream carrying this member's job updates. */
app.get('/api/events', requireAuth, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`data: ${JSON.stringify({ event: 'hello', jobs: listJobs(req.user.id) })}\n\n`);

  const onUpdate = (payload) => {
    if (payload.job.userId !== req.user.id) return;
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };
  bus.on('jobs', onUpdate);

  const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('jobs', onUpdate);
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found' }));

await restoreJobs();
app.listen(config.port, () => {
  const providers = providerStatus();
  const missing = ['openai', 'fal', 'kie', 'blotato'].filter((key) => !providers[key]);
  console.log(`Viral Video Studio running on ${config.publicUrl}`);
  if (missing.length) console.log(`Mock mode for: ${missing.join(', ')} (add the API keys in .env to go live)`);
});
