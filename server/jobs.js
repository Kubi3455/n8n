import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';

const JOBS_FILE = path.join(paths.data, 'jobs.json');
const MAX_JOBS = 100;

export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Each content type walks through its own stages.
const STEP_DEFINITIONS_BY_TYPE = {
  video: [
    { id: 'collect', title: 'Fikir ve görsel toplama' },
    { id: 'image', title: 'Görsel üretimi' },
    { id: 'script', title: 'Video senaryosu' },
    { id: 'video', title: 'Video render' },
    { id: 'caption', title: 'Paylaşım metni' },
  ],
  ugc: [
    { id: 'collect', title: 'Fikir ve görsel toplama' },
    { id: 'image', title: 'Görsel üretimi' },
    { id: 'script', title: 'Video senaryosu' },
    { id: 'video', title: 'Video render' },
    { id: 'caption', title: 'Paylaşım metni' },
  ],
  carousel: [
    { id: 'collect', title: 'Konu toplama' },
    { id: 'plan', title: 'Carousel içerik planı' },
    { id: 'slides', title: '6 slayt görseli' },
    { id: 'caption', title: 'Paylaşım metni' },
  ],
};

export const getStepDefinitions = (contentType) => STEP_DEFINITIONS_BY_TYPE[contentType] || STEP_DEFINITIONS_BY_TYPE.ugc;

const jobs = new Map();
let persistChain = Promise.resolve();

const persist = () => {
  const snapshot = [...jobs.values()].slice(0, MAX_JOBS);
  persistChain = persistChain.then(async () => {
    await fs.mkdir(paths.data, { recursive: true });
    await fs.writeFile(JOBS_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
  }).catch(() => {});
  return persistChain;
};

export const restoreJobs = async () => {
  try {
    const stored = JSON.parse(await fs.readFile(JOBS_FILE, 'utf8'));
    for (const job of stored) {
      // A job that was mid-flight when the server stopped can never finish; mark it honestly.
      if (job.status === 'running' || job.status === 'queued') {
        job.status = 'failed';
        job.error = 'Sunucu yeniden başladığı için yarıda kaldı';
        job.steps = job.steps.map((step) => (step.status === 'running' ? { ...step, status: 'failed' } : step));
      }
      jobs.set(job.id, job);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not restore jobs:', error.message);
  }
};

const emit = (job, event = 'job') => {
  job.updatedAt = new Date().toISOString();
  bus.emit(`job:${job.id}`, { event, job });
  bus.emit('jobs', { event, job });
  persist();
};

export const createJob = ({ userId, imageKey, contentType, input }) => {
  const job = {
    id: crypto.randomUUID(),
    userId,
    imageKey,
    contentType,
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input,
    steps: getStepDefinitions(contentType).map((step) => ({ ...step, status: 'pending', detail: '' })),
    logs: [],
    result: { slides: [] },
    error: null,
  };
  // Newest first, and keep the map from growing without bound.
  const existing = [...jobs.entries()];
  jobs.clear();
  jobs.set(job.id, job);
  for (const [id, value] of existing.slice(0, MAX_JOBS - 1)) jobs.set(id, value);
  emit(job, 'created');
  return job;
};

export const getJob = (id, userId) => {
  const job = jobs.get(id);
  // A job only ever belongs to the member who started it.
  return job && (!userId || job.userId === userId) ? job : null;
};

export const listJobs = (userId) =>
  [...jobs.values()].filter((job) => !userId || job.userId === userId);

export const log = (job, message, level = 'info') => {
  job.logs.push({ ts: new Date().toISOString(), level, message });
  if (job.logs.length > 300) job.logs.shift();
  emit(job, 'log');
};

export const setStep = (job, stepId, status, detail = '') => {
  const step = job.steps.find((candidate) => candidate.id === stepId);
  if (!step) return;
  step.status = status;
  if (detail) step.detail = detail;
  if (status === 'running') step.startedAt = new Date().toISOString();
  if (status === 'done' || status === 'failed') step.finishedAt = new Date().toISOString();
  emit(job, 'step');
};

export const setResult = (job, patch) => {
  Object.assign(job.result, patch);
  emit(job, 'result');
};

export const setStatus = (job, status, error = null) => {
  job.status = status;
  job.error = error;
  emit(job, 'status');
};
