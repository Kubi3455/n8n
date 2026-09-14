import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { attachUser, clearSessionCookie, createSession, destroySession, login, register, requireAuth, setSessionCookie } from './auth.js';
import { config, paths, providerStatus, setPublicUrl } from './config.js';
import { createServer, listenOnFreePort } from './http-server.js';
import { bus, createJob, getJob, listJobs, restoreJobs } from './jobs.js';
import { runPipeline } from './pipeline.js';
import { CONTENT_TYPES, deleteProject, getSettings, listProjects, saveSettings } from './store.js';

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
  res.json(200, { user: req.user, providers: providerStatus(), settings, publicUrl: config.publicUrl });
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

app.post('/api/jobs', async (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    const { image, idea = '', model, aspectRatio, contentType } = req.body;
    const type = CONTENT_TYPES[contentType] || CONTENT_TYPES.ugc;

    if (type !== 'carousel' && !image) return res.json(400, { error: 'Bir görsel yükleyin' });
    if (!String(idea).trim() && !image) return res.json(400, { error: 'Bir konu ya da fikir yazın' });

    const settings = await getSettings(req.user.id);
    const upload = await saveUpload(image, req.user.id);
    // Scoped by content type too: the same photo can become a video AND a carousel
    // without one overwriting the other's project.
    const imageKey = `${type}:${upload.imageKey || keyFromIdea(idea)}`;

    const running = listJobs(req.user.id).find(
      (job) => job.imageKey === imageKey && (job.status === 'running' || job.status === 'queued'),
    );
    if (running) return res.json(409, { error: 'Bu içerik için bir akış zaten çalışıyor' });

    const job = createJob({
      userId: req.user.id,
      imageKey,
      contentType: type,
      input: {
        idea: String(idea).slice(0, 2000),
        model: model || settings.model,
        aspectRatio: aspectRatio || settings.aspectRatio,
      },
    });

    // Fire and forget: progress reaches the browser over SSE.
    runPipeline(job, { ...upload, imageKey }).catch((error) => console.error('Pipeline crashed:', error));
    res.json(202, job);
  } catch (error) {
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
