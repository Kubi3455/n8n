// ============================================================================
// FREE CREDIT SYSTEM — self-contained on purpose.
//
// Prices and free-credit amounts aren't final yet, so every knob lives in one
// place (CREDIT_CONFIG / ENGINE_TIERS below or their env var overrides) and every
// other file only ever calls the functions exported here.
//
// TO REMOVE THIS FEATURE ENTIRELY:
//   1. Delete this file.
//   2. In server/auth.js: remove the `grantSignupCredits` call and import.
//   3. In server/index.js: remove the credit gate + refund handling in POST /api/jobs
//      (everything referencing `credits` or `reservation`), the `credits: ...` field in
//      GET /api/status, and the `log`/`setStatus` imports from jobs.js if nothing else
//      in this file still needs them.
//   4. In server/jobs.js: drop the `usedFreeCredit` field from createJob (optional -
//      harmless to leave, it just always stays false).
//   5. In public/: remove the credit pill, the out-of-credits dialog, and the
//      `usedFreeCredit` watermark branches in app.js (search "usedFreeCredit").
// Nothing else in the app depends on credits existing - every pipeline runs
// unmetered today if CREDIT_SYSTEM_ENABLED is simply set to false, with no code
// changes needed at all.
// ============================================================================

import path from 'node:path';
import { paths } from './config.js';
import { readJsonFile, writeJsonFile } from './store.js';

const CREDITS_FILE = path.join(paths.data, 'credits.json');

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

export const CREDIT_CONFIG = {
  enabled: bool(process.env.CREDIT_SYSTEM_ENABLED, true),
  freeCreditsOnSignup: Number(process.env.FREE_CREDITS_ON_SIGNUP || 2),
};

/**
 * Per-engine cheap/premium tiers. Free credits may only ever run the cheap variant of
 * each engine; anything else is downgraded (not rejected) so a free run never silently
 * fails just because a fancier option was pre-selected.
 *
 * Only `veo3` is wired to an actual UI control today (the model dropdown on Normal
 * Video / UGC Reklam). NanoBanana and Tripo3D have no quality selector in this app yet -
 * their entries are here so that if one is added later, it's free-credit-aware from day
 * one with no extra plumbing.
 */
export const ENGINE_TIERS = {
  veo3: { cheap: 'veo3_fast', premium: ['veo3'] },
  nanobanana: { cheap: 'standard', premium: ['pro'] },
  tripo3d: { cheap: 'h3.1', premium: ['p1'] },
};

/** Forces a requested engine value down to the free tier's cheap variant when needed. */
export const enforceFreeTier = (engine, requestedValue, { usedFreeCredit }) => {
  const tier = ENGINE_TIERS[engine];
  if (!usedFreeCredit || !tier || !tier.premium.includes(requestedValue)) {
    return { value: requestedValue, downgraded: false };
  }
  return { value: tier.cheap, downgraded: true };
};

// ---------------------------------------------------------------------------
// Storage: one small JSON file, mutations serialised through a single promise
// chain so "check balance, then decrement" can never race between two requests.
// ---------------------------------------------------------------------------

let chain = Promise.resolve();

const withCredits = (mutator) => {
  chain = chain.then(async () => {
    const all = await readJsonFile(CREDITS_FILE, {});
    const result = mutator(all);
    await writeJsonFile(CREDITS_FILE, all);
    return result;
  });
  return chain;
};

const emptyRecord = () => ({ freeCreditsRemaining: 0, freeCreditsGranted: 0, history: [] });

const addHistory = (record, entry) => {
  record.history.unshift({ at: new Date().toISOString(), ...entry });
  if (record.history.length > 50) record.history.length = 50;
};

/** Called once, right after a new account is created. */
export const grantSignupCredits = (userId) => withCredits((all) => {
  const amount = CREDIT_CONFIG.freeCreditsOnSignup;
  all[userId] = { freeCreditsRemaining: amount, freeCreditsGranted: amount, history: [] };
  addHistory(all[userId], { type: 'grant', amount });
  return all[userId];
});

export const getCredits = async (userId) => (await readJsonFile(CREDITS_FILE, {}))[userId] || emptyRecord();

/**
 * Atomically checks and reserves one free credit for a job that is about to run against a
 * real (non-mocked) provider. Returns { usedFreeCredit: false } straight away when the
 * feature is disabled or the run is fully mocked - mock mode stays unlimited regardless of
 * balance. Never throws; the caller decides what to do with `allowed: false`.
 */
export const reserve = async ({ userId, isFullyMocked }) => {
  if (!CREDIT_CONFIG.enabled || isFullyMocked) return { allowed: true, usedFreeCredit: false };

  return withCredits((all) => {
    const record = all[userId] || emptyRecord();
    if (record.freeCreditsRemaining <= 0) {
      all[userId] = record;
      return { allowed: false, usedFreeCredit: false, remaining: 0 };
    }
    record.freeCreditsRemaining -= 1;
    addHistory(record, { type: 'consume' });
    all[userId] = record;
    return { allowed: true, usedFreeCredit: true, remaining: record.freeCreditsRemaining };
  });
};

/** Gives a credit back when a job that reserved one failed before producing anything. */
export const refund = async (userId, reason = 'job failed') => withCredits((all) => {
  const record = all[userId] || emptyRecord();
  record.freeCreditsRemaining += 1;
  addHistory(record, { type: 'refund', reason });
  all[userId] = record;
  return record;
});

/** Shape returned to the browser (GET /api/status) - enough to render a pill and a gate. */
export const publicStatus = async (userId, { isFullyMocked }) => {
  if (!CREDIT_CONFIG.enabled) return { enabled: false };
  const record = await getCredits(userId);
  return {
    enabled: true,
    remaining: record.freeCreditsRemaining,
    granted: record.freeCreditsGranted,
    // Whether credits actually gate anything right now - false while running fully mocked.
    appliesNow: !isFullyMocked,
  };
};

export const OUT_OF_CREDITS_MESSAGE =
  'Ücretsiz krediniz bitti. Gerçek üretim yapmaya devam etmek için üyeliğinizi yükseltmeniz gerekiyor.';
