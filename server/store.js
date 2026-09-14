import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from './config.js';

const PROJECTS_FILE = path.join(paths.data, 'projects.json');
const SETTINGS_FILE = path.join(paths.data, 'settings.json');

export const PROJECT_STATUS = {
  processing: 'processing',
  ready: 'ready',
  published: 'published',
  error: 'error',
};

// Publishing targets, one per social account the member connects.
export const DEFAULT_SETTINGS = {
  model: 'veo3_fast',
  aspectRatio: '16:9',
  platforms: [
    { id: 'tiktok', label: 'TikTok', enabled: true, accountId: '' },
    { id: 'instagram', label: 'Instagram', enabled: true, accountId: '' },
    { id: 'youtube', label: 'YouTube', enabled: true, accountId: '', privacyStatus: 'private', notifySubscribers: false },
    { id: 'linkedin', label: 'LinkedIn', enabled: true, accountId: '' },
    { id: 'facebook', label: 'Facebook', enabled: true, accountId: '', pageId: '' },
    { id: 'twitter', label: 'Twitter (X)', enabled: true, accountId: '' },
    { id: 'threads', label: 'Threads', enabled: true, accountId: '' },
    { id: 'bluesky', label: 'Bluesky', enabled: true, accountId: '' },
    { id: 'pinterest', label: 'Pinterest', enabled: true, accountId: '', boardId: '' },
  ],
};

let writeChain = Promise.resolve();

export const readJsonFile = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
};

/** Serialised writes: two concurrent jobs can never clobber each other's record. */
export const writeJsonFile = (file, data) => {
  writeChain = writeChain.then(async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`);
  });
  return writeChain;
};

const allProjects = () => readJsonFile(PROJECTS_FILE, []);

export const listProjects = async (userId) => (await allProjects()).filter((project) => project.userId === userId);

export const getProject = async (userId, imageKey) =>
  (await allProjects()).find((project) => project.userId === userId && project.imageKey === imageKey) || null;

/**
 * Creates or updates one member's project. The image content hash is the key, so
 * re-submitting the same picture refreshes that project instead of duplicating it.
 */
export const upsertProject = async (userId, imageKey, values) => {
  const projects = await allProjects();
  const index = projects.findIndex((project) => project.userId === userId && project.imageKey === imageKey);
  const now = new Date().toISOString();

  if (index === -1) {
    const project = {
      id: `${userId}:${imageKey}`,
      userId,
      imageKey,
      imageUrl: '',
      idea: '',
      imageDescription: '',
      imagePrompt: '',
      title: '',
      caption: '',
      finalPrompt: '',
      videoUrl: '',
      status: PROJECT_STATUS.processing,
      createdAt: now,
      updatedAt: now,
      ...values,
    };
    projects.unshift(project);
    await writeJsonFile(PROJECTS_FILE, projects);
    return project;
  }

  const project = { ...projects[index], ...values, updatedAt: now };
  projects[index] = project;
  await writeJsonFile(PROJECTS_FILE, projects);
  return project;
};

export const deleteProject = async (userId, imageKey) => {
  const projects = await allProjects();
  const remaining = projects.filter((project) => !(project.userId === userId && project.imageKey === imageKey));
  await writeJsonFile(PROJECTS_FILE, remaining);
  return projects.length !== remaining.length;
};

export const deleteProjectsOfUser = async (userId) => {
  const projects = await allProjects();
  await writeJsonFile(PROJECTS_FILE, projects.filter((project) => project.userId !== userId));
};

const allSettings = () => readJsonFile(SETTINGS_FILE, {});

/** Every member keeps their own defaults and their own social accounts. */
export const getSettings = async (userId) => {
  const stored = (await allSettings())[userId] || {};
  const platforms = DEFAULT_SETTINGS.platforms.map((base) => ({
    ...base,
    ...(stored.platforms || []).find((platform) => platform.id === base.id),
  }));
  return { ...DEFAULT_SETTINGS, ...stored, platforms };
};

export const saveSettings = async (userId, patch) => {
  const settings = await allSettings();
  const current = await getSettings(userId);
  const next = {
    ...current,
    ...patch,
    platforms: current.platforms.map((platform) => ({
      ...platform,
      ...(patch.platforms || []).find((candidate) => candidate.id === platform.id),
    })),
  };
  settings[userId] = next;
  await writeJsonFile(SETTINGS_FILE, settings);
  return next;
};
