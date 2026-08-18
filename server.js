'use strict';

const express = require('express');
const app = express();
app.use(express.json({ limit: '1mb', strict: true }));

// ---- Fixed policy scope ----
const ASSIGNED_ENVIRONMENT = 'prod-mnu3ks';
const REQUIRED_LABELS = {
  owner: 'student-3e7hk',
  environment: 'production',
  cost_center: 'cc-1wbe',
};
const ALLOWED_BACKENDS = new Set(['gcs', 's3', 'azurerm', 'remote']);
const ALLOWED_ACTIONS = new Set(['create', 'update', 'delete']);
const DESTROY_APPROVAL_TYPES = new Set(['storage_bucket', 'sql_database', 'persistent_disk']);

// ---- helpers ----
function isPlainObject(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Exact pin: "6.2.1" or "= 6.2.1" (optional "=" then M.m.p)
const EXACT_VERSION_RE = /^(=\s*)?\d+\.\d+\.\d+$/;
// Pessimistic pin: "~> 6.0" or "~> 6.0.1"
const PESSIMISTIC_VERSION_RE = /^~>\s*\d+\.\d+(\.\d+)?$/;

function isPinnedProviderVersion(v) {
  if (typeof v !== 'string') return false;
  const trimmed = v.trim();
  return EXACT_VERSION_RE.test(trimmed) || PESSIMISTIC_VERSION_RE.test(trimmed);
}

function isValidSecret(secret) {
  if (secret === null) return true;
  if (typeof secret !== 'string') return false;
  const prefix = 'secret://';
  return secret.startsWith(prefix) && secret.length > prefix.length;
}

// ---- top-level + nested schema validation ----
function validateSchema(body) {
  if (!isPlainObject(body)) return false;

  if (typeof body.environment !== 'string') return false;

  if (!isPlainObject(body.state)) return false;
  if (typeof body.state.backend !== 'string') return false;
  if (typeof body.state.locked !== 'boolean') return false;

  if (typeof body.providerVersion !== 'string') return false;
  if (typeof body.destroyApproved !== 'boolean') return false;

  if (!isPlainObject(body.resource)) return false;
  const r = body.resource;
  if (typeof r.address !== 'string') return false;
  if (typeof r.type !== 'string') return false;
  if (typeof r.action !== 'string' || !ALLOWED_ACTIONS.has(r.action)) return false;
  if (!isPlainObject(r.labels)) return false;
  for (const key of Object.keys(r.labels)) {
    if (typeof r.labels[key] !== 'string') return false;
  }
  if (!(r.secret === null || typeof r.secret === 'string')) return false;
  if (typeof r.forceDestroy !== 'boolean') return false;

  return true;
}

function hasRequiredLabels(labels) {
  return Object.entries(REQUIRED_LABELS).every(
    ([key, value]) => labels[key] === value
  );
}

// ---- main decision endpoint ----
app.post('/terraform/plan', (req, res) => {
  const respond = (decision, reason) => res.status(200).json({ decision, reason });

  const body = req.body;

  // 1) Schema / type validation
  if (!validateSchema(body)) {
    return respond('reject', 'INVALID_PLAN');
  }

  const { environment, state, providerVersion, destroyApproved, resource } = body;

  // 2) Environment must match assigned production workspace
  if (environment !== ASSIGNED_ENVIRONMENT) {
    return respond('reject', 'ENVIRONMENT_MISMATCH');
  }

  // 3) Remote state must be a known backend and locked
  if (!ALLOWED_BACKENDS.has(state.backend) || state.locked !== true) {
    return respond('reject', 'STATE_UNSAFE');
  }

  // 4) Provider must be pinned (exact or pessimistic), not open-ended
  if (!isPinnedProviderVersion(providerVersion)) {
    return respond('reject', 'UNPINNED_PROVIDER');
  }

  // 5) Required cost-ownership labels must be present with exact values
  if (!hasRequiredLabels(resource.labels)) {
    return respond('reject', 'MISSING_LABELS');
  }

  // 6) No plaintext secrets
  if (!isValidSecret(resource.secret)) {
    return respond('reject', 'PLAINTEXT_SECRET');
  }

  // 7) Destructive delete of stateful/cost-bearing resources needs explicit approval
  if (
    resource.action === 'delete' &&
    DESTROY_APPROVAL_TYPES.has(resource.type) &&
    destroyApproved !== true
  ) {
    return respond('reject', 'DELETE_NOT_APPROVED');
  }

  // 8) Production storage buckets may never allow forceDestroy
  if (resource.type === 'storage_bucket' && resource.forceDestroy === true) {
    return respond('reject', 'FORCE_DESTROY');
  }

  return respond('approve', 'APPROVE');
});

app.get('/healthz', (_req, res) => res.status(200).json({ ok: true }));

const PORT = process.env.PORT || 8788;
app.listen(PORT, () => {
  console.log(`terraform-policy listening on :${PORT}`);
});

module.exports = app;
