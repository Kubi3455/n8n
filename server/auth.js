import crypto from 'node:crypto';
import path from 'node:path';
import { auth as authConfig, config, paths } from './config.js';
import { grantSignupCredits } from './credits.js';
import { readJsonFile, writeJsonFile } from './store.js';

const USERS_FILE = path.join(paths.data, 'users.json');
const SESSIONS_FILE = path.join(paths.data, 'sessions.json');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 8;

const hashPassword = (password, salt) =>
  crypto.scryptSync(password, salt, 64).toString('hex');

const publicUser = (user) => ({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt });

const loadUsers = () => readJsonFile(USERS_FILE, []);
const loadSessions = () => readJsonFile(SESSIONS_FILE, {});

const pruneSessions = (sessions) => {
  const now = Date.now();
  return Object.fromEntries(Object.entries(sessions).filter(([, session]) => session.expiresAt > now));
};

export const register = async ({ email, password, name }) => {
  const normalisedEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_PATTERN.test(normalisedEmail)) throw Object.assign(new Error('Geçerli bir e-posta girin'), { status: 400 });
  if (String(password || '').length < MIN_PASSWORD_LENGTH) {
    throw Object.assign(new Error(`Şifre en az ${MIN_PASSWORD_LENGTH} karakter olmalı`), { status: 400 });
  }

  const users = await loadUsers();
  if (users.some((user) => user.email === normalisedEmail)) {
    throw Object.assign(new Error('Bu e-posta zaten kayıtlı'), { status: 409 });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: crypto.randomUUID(),
    email: normalisedEmail,
    name: String(name || '').trim() || normalisedEmail.split('@')[0],
    salt,
    passwordHash: hashPassword(password, salt),
    createdAt: new Date().toISOString(),
  };

  users.push(user);
  await writeJsonFile(USERS_FILE, users);
  await grantSignupCredits(user.id); // see server/credits.js for how to remove this feature
  return publicUser(user);
};

export const login = async ({ email, password }) => {
  const normalisedEmail = String(email || '').trim().toLowerCase();
  const users = await loadUsers();
  const user = users.find((candidate) => candidate.email === normalisedEmail);

  // Hash even when the account is unknown, so a missing user and a wrong password
  // take a comparable amount of time.
  const salt = user?.salt || crypto.randomBytes(16).toString('hex');
  const attempt = hashPassword(String(password || ''), salt);
  const expected = user?.passwordHash || attempt.replace(/./g, '0');

  const matches = crypto.timingSafeEqual(Buffer.from(attempt, 'hex'), Buffer.from(expected, 'hex'));
  if (!user || !matches) throw Object.assign(new Error('E-posta veya şifre hatalı'), { status: 401 });

  return publicUser(user);
};

export const createSession = async (userId) => {
  const sessions = pruneSessions(await loadSessions());
  const token = crypto.randomBytes(32).toString('hex');
  sessions[token] = { userId, expiresAt: Date.now() + authConfig.sessionTtlMs };
  await writeJsonFile(SESSIONS_FILE, sessions);
  return token;
};

export const destroySession = async (token) => {
  const sessions = pruneSessions(await loadSessions());
  delete sessions[token];
  await writeJsonFile(SESSIONS_FILE, sessions);
};

export const userFromToken = async (token) => {
  if (!token) return null;
  const sessions = await loadSessions();
  const session = sessions[token];
  if (!session || session.expiresAt <= Date.now()) return null;

  const users = await loadUsers();
  const user = users.find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
};

const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      }),
  );

export const setSessionCookie = (res, token) => {
  const attributes = [
    `${authConfig.cookieName}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/',
    `Max-Age=${Math.floor(authConfig.sessionTtlMs / 1000)}`,
  ];
  if (config.publicUrl.startsWith('https://')) attributes.push('Secure');
  res.setHeader('Set-Cookie', attributes.join('; '));
};

export const clearSessionCookie = (res) => {
  res.setHeader('Set-Cookie', `${authConfig.cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
};

/** Attaches req.user when the request carries a valid session cookie. */
export const attachUser = async (req) => {
  const cookies = parseCookies(req.headers.cookie);
  req.sessionToken = cookies[authConfig.cookieName] || null;
  req.user = await userFromToken(req.sessionToken);
};

/** Returns false (and answers with 401) when the request has no session. */
export const requireAuth = (req, res) => {
  if (req.user) return true;
  res.json(401, { error: 'Giriş yapmanız gerekiyor' });
  return false;
};
