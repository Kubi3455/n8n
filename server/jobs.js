import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';

const JOBS_FILE = path.join(paths.data, 'jobs.json');
const MAX_JOBS = 100;

export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Each content type walks through its own stages. For 'video'/'ugc' these are only the
// SHARED stages (idea + image are produced once); the per-variant stages live in
// VARIANT_STEP_DEFINITIONS below and are forked once per hook/angle (see Hook/Varyant Testi).
const STEP_DEFINITIONS_BY_TYPE = {
  video: [
    { id: 'collect', title: 'Fikir ve görsel toplama' },
    { id: 'image', title: 'Görsel üretimi' },
  ],
  ugc: [
    { id: 'collect', title: 'Fikir ve görsel toplama' },
    { id: 'image', title: 'Görsel üretimi' },
  ],
  carousel: [
    { id: 'collect', title: 'Konu toplama' },
    { id: 'plan', title: 'Carousel içerik planı' },
    { id: 'slides', title: '6 slayt görseli' },
    { id: 'caption', title: 'Paylaşım metni' },
  ],
  character3d: [
    { id: 'collect', title: 'Konu ve görsel toplama' },
    { id: 'prompt', title: '3D karakter prompt\'u' },
    { id: 'model', title: '3D model üretimi' },
    { id: 'caption', title: 'Paylaşım metni' },
  ],
};

export const getStepDefinitions = (contentType) => STEP_DEFINITIONS_BY_TYPE[contentType] || STEP_DEFINITIONS_BY_TYPE.ugc;

// Each hook/angle variant of a video/ugc job walks through its own copy of these three.
export const VARIANT_STEP_DEFINITIONS = [
  { id: 'script', title: 'Video senaryosu' },
  { id: 'video', title: 'Video render' },
  { id: 'caption', title: 'Paylaşım metni' },
];

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

/**
 * `variants`, when given, is a list of `{ id, angle, angleLabel }` resolved by the caller
 * (index.js, using HOOK_ANGLE_ORDER/HOOK_ANGLES from prompts.js) - jobs.js stays agnostic of
 * what an "angle" actually means and just gives each one its own step/result bookkeeping.
 * Content types other than video/ugc never pass this and get the old single-`steps` shape.
 */
export const createJob = ({ userId, imageKey, contentType, input, usedFreeCredit = false, variants }) => {
  const job = {
    id: crypto.randomUUID(),
    userId,
    imageKey,
    contentType,
    usedFreeCredit, // drives the free-trial watermark in the UI; see server/credits.js
    status: 'queued',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    input,
    steps: getStepDefinitions(contentType).map((step) => ({ ...step, status: 'pending', detail: '' })),
    variants: (variants || []).map((variant) => ({
      ...variant,
      status: 'pending',
      steps: VARIANT_STEP_DEFINITIONS.map((step) => ({ ...step, status: 'pending', detail: '' })),
      result: {},
    })),
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

// ---------- Hook/Varyant Testi: per-variant equivalents of setStep/setResult/setStatus ----

const findVariant = (job, variantId) => job.variants.find((variant) => variant.id === variantId);

export const setVariantStep = (job, variantId, stepId, status, detail = '') => {
  const variant = findVariant(job, variantId);
  if (!variant) return;
  const step = variant.steps.find((candidate) => candidate.id === stepId);
  if (!step) return;
  step.status = status;
  if (detail) step.detail = detail;
  if (status === 'running') step.startedAt = new Date().toISOString();
  if (status === 'done' || status === 'failed') step.finishedAt = new Date().toISOString();
  emit(job, 'variant-step');
};

export const setVariantResult = (job, variantId, patch) => {
  const variant = findVariant(job, variantId);
  if (!variant) return;
  Object.assign(variant.result, patch);
  emit(job, 'variant-result');
};

export const setVariantStatus = (job, variantId, status, error = null) => {
  const variant = findVariant(job, variantId);
  if (!variant) return;
  variant.status = status;
  if (error) variant.error = error;
  emit(job, 'variant-status');
};
