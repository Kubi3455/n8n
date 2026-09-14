import fs from 'node:fs';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

/**
 * A very small router over node:http. The app only needs static files, JSON routes and
 * one SSE stream, so this replaces a framework and keeps the project dependency-free.
 */
export const createServer = ({ staticDirs = [], maxBodyBytes = 30 * 1024 * 1024 } = {}) => {
  const routes = [];
  const middlewares = [];

  const addRoute = (method, pattern, handler) => {
    // "/api/projects/:imageKey" -> regex with a named group.
    const keys = [];
    const regex = new RegExp(
      `^${pattern.replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
        keys.push(key);
        return '([^/]+)';
      })}$`,
    );
    routes.push({ method, regex, keys, handler });
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBodyBytes) {
          reject(Object.assign(new Error('İstek gövdesi çok büyük'), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });

  const sendStatic = async (res, filePath) => {
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return false;
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': 'no-cache',
      });
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath).on('error', reject).on('end', resolve).pipe(res);
      });
      return true;
    } catch {
      return false;
    }
  };

  const server = http.createServer(async (req, res) => {
    // Helpers the route handlers use, mirroring the Express API the app was written against.
    res.json = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(body);
    };

    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = decodeURIComponent(url.pathname);
      req.path = pathname;
      req.query = Object.fromEntries(url.searchParams);

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const raw = await readBody(req);
        req.body = raw.length ? JSON.parse(raw.toString('utf8')) : {};
      } else {
        req.body = {};
      }

      for (const middleware of middlewares) await middleware(req, res);

      for (const route of routes) {
        if (route.method !== req.method) continue;
        const match = route.regex.exec(pathname);
        if (!match) continue;
        req.params = Object.fromEntries(route.keys.map((key, index) => [key, match[index + 1]]));
        await route.handler(req, res);
        return;
      }

      // Static files: the SPA shell, its assets and the uploaded images.
      if (req.method === 'GET') {
        for (const { prefix, dir } of staticDirs) {
          if (!pathname.startsWith(prefix)) continue;
          const relative = pathname.slice(prefix.length).replace(/^\/+/, '') || 'index.html';
          const filePath = path.join(dir, relative);
          // Never serve anything outside the directory that was opened up.
          if (!filePath.startsWith(path.resolve(dir))) break;
          if (await sendStatic(res, filePath)) return;
        }
      }

      res.json(404, { error: 'Not found' });
    } catch (error) {
      if (res.headersSent) return;
      const status = error.status || (error instanceof SyntaxError ? 400 : 500);
      res.json(status, { error: error.message || 'Sunucu hatası' });
    }
  });

  return {
    server,
    use: (middleware) => middlewares.push(middleware),
    get: (pattern, handler) => addRoute('GET', pattern, handler),
    post: (pattern, handler) => addRoute('POST', pattern, handler),
    put: (pattern, handler) => addRoute('PUT', pattern, handler),
    delete: (pattern, handler) => addRoute('DELETE', pattern, handler),
  };
};

/** Picks the next free port, so an already-used port never blocks the first run. */
export const listenOnFreePort = (server, preferredPort, attempts = 20) =>
  new Promise((resolve, reject) => {
    let port = preferredPort;
    const tryPort = () => {
      server.once('error', (error) => {
        if (error.code === 'EADDRINUSE' && port < preferredPort + attempts) {
          port += 1;
          tryPort();
          return;
        }
        reject(error);
      });
      server.listen(port, () => resolve(port));
    };
    tryPort();
  });
