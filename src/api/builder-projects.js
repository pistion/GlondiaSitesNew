import { authHeaders } from './auth.js';

function apiUrl(path) {
  const base = String(import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '');
  return base ? `${base}${path}` : `/api${path}`;
}

/**
 * A Builder API error preserves the full server error envelope so the UI can
 * branch on `code` (e.g. BUILDER_VERSION_CONFLICT, IDEMPOTENCY_KEY_REUSED) and
 * surface `details`/`requestId` — never reduced to a plain message string.
 */
export class BuilderApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message || `Builder request failed (${status}).`);
    this.name = 'BuilderApiError';
    this.status = status;
    this.code = code || 'BUILDER_ERROR';
    this.details = details;
    this.requestId = requestId;
  }
}

async function builderRequest(path, options = {}) {
  const response = await fetch(apiUrl(`/v1/builder${path}`), {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...authHeaders(),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new BuilderApiError({
      status: response.status,
      code: result?.error?.code,
      message: result?.error?.message,
      details: result?.error?.details,
      requestId: result?.requestId ?? result?.meta?.requestId,
    });
  }
  return result?.data ?? result;
}

/** Generate an idempotency key for a mutation the user should not double-submit. */
export function newIdempotencyKey(prefix = 'op') {
  const rand = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  return `${prefix}-${rand}`;
}

export const builderProjectsApi = {
  createProject: (body) => builderRequest('/projects', { method: 'POST', body }),
  listProjects: (query = {}) => {
    const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString();
    return builderRequest(`/projects${qs ? `?${qs}` : ''}`);
  },
  getProject: (projectId) => builderRequest(`/projects/${encodeURIComponent(projectId)}`),
  updatePlan: (projectId, body) => builderRequest(`/projects/${encodeURIComponent(projectId)}/plan`, { method: 'PATCH', body }),
  buildAnswerSheet: (projectId) => builderRequest(`/projects/${encodeURIComponent(projectId)}/answer-sheet/build`, { method: 'POST' }),
  // expectedVersion is required by the server for safe answer-sheet writes.
  updateAnswerSheet: (projectId, answerSheet, expectedVersion) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/answer-sheet`, {
      method: 'PATCH',
      body: { answerSheet, expectedVersion },
    }),
  startGeneration: (projectId, body, idempotencyKey) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/generations`, { method: 'POST', body, idempotencyKey }),
  getJob: (jobId) => builderRequest(`/jobs/${encodeURIComponent(jobId)}`),
  // Durable generation/deployment progress — the real job stage timeline.
  getJobEvents: (jobId) => builderRequest(`/jobs/${encodeURIComponent(jobId)}/events`),
  listRevisions: (projectId) => builderRequest(`/projects/${encodeURIComponent(projectId)}/revisions`),
  getRevision: (projectId, revisionId) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}`),
  approveRevision: (projectId, revisionId) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/approve`, { method: 'POST' }),
  requestChange: (projectId, revisionId, body, idempotencyKey) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/change-request`, { method: 'POST', body, idempotencyKey }),
  createPreviewGrant: (projectId, revisionId) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/preview-grants`, { method: 'POST' }),
  revokePreviewGrant: (grantId) =>
    builderRequest(`/preview-grants/${encodeURIComponent(grantId)}`, { method: 'DELETE' }),
  createDeployment: (projectId, body, idempotencyKey) =>
    builderRequest(`/projects/${encodeURIComponent(projectId)}/deployments`, { method: 'POST', body, idempotencyKey }),
  listDeployments: (projectId) => builderRequest(`/projects/${encodeURIComponent(projectId)}/deployments`),
};
