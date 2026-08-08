import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as repo from '../repositories/builder.repository.js';
import { durableJobsEnabled, isolatedPreviewEnabled, jobsUnavailableError } from '../builder/builderFlags.js';
import { hasFreshWorkerHeartbeat } from '../builder/builderReadiness.service.js';
import { pinTemplate } from '../builder/generation/templateLoader.js';
import { verifyArtifact } from '../builder/generation/artifactWriter.js';
import {
  requireExpectedVersion,
  sanitizeCreateProjectInput,
  validateAnswerSheet,
  validatePlan,
} from '../builder/builderValidationService.js';
import { createProject as createClientProject, getProject as getClientProject } from './projectService.js';

const IDEMPOTENCY_MAX = 160;

export async function createProject(user, body = {}) {
  const data = sanitizeCreateProjectInput(body);
  if (data.sourceType === 'template' && !data.templateId) {
    throw httpError('BUILDER_TEMPLATE_REQUIRED', 'Choose a template before creating a builder project.', 400);
  }
  if (!String(data.name || data.templateId || '').trim()) {
    throw httpError('BUILDER_NAME_REQUIRED', 'Project name is required.', 400);
  }
  // Template integrity is pinned HERE, from the server's own template files.
  // Any templateVersion/commit/manifest hash in the request body is ignored.
  let templatePin = null;
  if (data.sourceType === 'template') {
    templatePin = await pinTemplate(data.templateId);
  }
  if (data.clientProjectId) {
    await getClientProject({ projectId: data.clientProjectId, userId: user.id });
  } else {
    const parent = await createClientProject({
      userId: user.id,
      input: {
        name: String(data.name || data.templateId || 'New website').trim(),
        serviceType: 'website',
        status: 'draft',
        source: 'site_builder',
      },
    });
    data.clientProjectId = parent.id;
  }
  return repo.createProject({ user, data, templatePin });
}

export async function listProjects(user, query = {}) {
  return repo.listProjectsForUser(user.id, {
    status: query.status,
    limit: query.limit,
  });
}

export async function getProject(user, projectId) {
  const project = await repo.getProjectForUser(projectId, user.id);
  if (!project) throw notFound();
  return withSummaries(project);
}

function unwrapDocumentUpdate(result) {
  if (!result) throw notFound();
  if (result.conflict) {
    throw httpError('BUILDER_VERSION_CONFLICT', 'This project changed since you opened it. Reload before saving.', 409, {
      currentVersion: result.currentVersion,
    });
  }
  if (result.illegal) {
    throw httpError('BUILDER_ILLEGAL_TRANSITION', `This project cannot be edited while it is ${result.status}.`, 409, {
      status: result.status,
      target: result.target,
    });
  }
  return result.project;
}

export async function updatePlan(user, projectId, body = {}, requestId = null) {
  const expectedVersion = requireExpectedVersion(body, 'plan update');
  const plan = validatePlan(body.plan);
  const project = unwrapDocumentUpdate(await repo.updateProjectPlan({
    projectId,
    userId: user.id,
    expectedVersion,
    plan,
    requestId,
  }));
  return { projectId: project.id, version: project.version, savedAt: project.updatedAt, plan: project.plan };
}

export async function buildAnswerSheet(user, projectId, requestId = null) {
  const project = await getOwnedProject(user, projectId);
  const planData = project.plan?.data || project.plan || {};
  const brief = planData.brief || {};
  const answerSheet = {
    schemaVersion: 1,
    data: {
      businessName: brief.businessName || brief.name || project.name,
      industry: brief.industry || '',
      description: brief.description || '',
      goals: Array.isArray(brief.goals) ? brief.goals : [],
      pages: planData.sitemap?.pages || [],
      style: planData.style || {},
    },
  };
  const updated = unwrapDocumentUpdate(await repo.updateProjectAnswerSheet({
    projectId,
    userId: user.id,
    expectedVersion: project.version,
    answerSheet,
    requestId,
  }));
  return { projectId, version: updated.version, answerSheet: updated.answerSheet };
}

export async function updateAnswerSheet(user, projectId, body = {}, requestId = null) {
  const expectedVersion = requireExpectedVersion(body, 'answer sheet update');
  const answerSheet = validateAnswerSheet(body.answerSheet || body.data || {});
  const project = unwrapDocumentUpdate(await repo.updateProjectAnswerSheet({
    projectId,
    userId: user.id,
    expectedVersion,
    answerSheet,
    requestId,
  }));
  return { projectId, version: project.version, answerSheet: project.answerSheet };
}

/**
 * Fail closed instead of queuing dead work: durable-job endpoints refuse when
 * the flag is off or no worker is heartbeating.
 */
async function assertJobsAvailable() {
  if (!durableJobsEnabled()) throw jobsUnavailableError('BUILDER_JOBS_DISABLED');
  if (!(await hasFreshWorkerHeartbeat())) throw jobsUnavailableError('BUILDER_WORKER_UNAVAILABLE');
}

export async function startGeneration(user, projectId, body = {}, idempotencyHeader, requestId = null) {
  await assertJobsAvailable();
  const project = await getOwnedProject(user, projectId);
  if (!hasUsefulDoc(project.plan)) {
    throw httpError('BUILDER_PLAN_INCOMPLETE', 'Save a project plan before starting generation.', 400);
  }
  const scopedKey = scopedIdempotencyKey(user.id, 'generate', projectId, idempotencyHeader);
  const payload = {
    schemaVersion: 1,
    mode: body.mode || 'full',
    baseRevisionId: body.baseRevisionId || null,
    changeRequest: body.changeRequest || null,
  };
  const requestHash = repo.stableHash(payload);
  const result = await repo.startGenerationJob({ project, userId: user.id, idempotencyKey: scopedKey, requestHash, payload, requestId });
  if (result.conflict) {
    throw httpError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used with different input.', 409);
  }
  if (result.illegal) {
    throw httpError('BUILDER_ILLEGAL_TRANSITION', `Generation cannot start while the project is ${result.status}.`, 409, {
      status: result.status,
      target: result.target,
    });
  }
  return {
    statusCode: result.reused ? 200 : 202,
    data: {
      jobId: result.job.id,
      projectId: result.job.projectId,
      revisionId: result.job.revisionId,
      status: result.job.status,
      reused: result.reused,
    },
  };
}

export async function getJobEvents(user, jobId) {
  const job = await repo.getJobForUser(jobId, user.id);
  if (!job) throw httpError('BUILDER_JOB_NOT_FOUND', 'Job not found.', 404);
  return repo.listJobEventsForUser(jobId, user.id);
}

export async function getJob(user, jobId) {
  const job = await repo.getJobForUser(jobId, user.id);
  if (!job) throw httpError('BUILDER_JOB_NOT_FOUND', 'Job not found.', 404);
  return job;
}

export async function listRevisions(user, projectId) {
  await getOwnedProject(user, projectId);
  return repo.listRevisions(projectId, user.id);
}

export async function getRevision(user, projectId, revisionId) {
  const revision = await repo.getRevision(projectId, revisionId, user.id);
  if (!revision) throw httpError('BUILDER_REVISION_NOT_FOUND', 'Revision not found.', 404);
  return revision;
}

export async function approveRevision(user, projectId, revisionId) {
  const result = await repo.approveRevision({ projectId, revisionId, userId: user.id });
  if (result.missing) throw httpError('BUILDER_REVISION_NOT_FOUND', 'Revision not found.', 404);
  if (result.invalid) {
    throw httpError('BUILDER_REVISION_NOT_READY', 'Only ready revisions can be approved.', 409, {
      status: result.revision.status,
    });
  }
  if (result.illegal) {
    throw httpError('BUILDER_ILLEGAL_TRANSITION', `Approval is not allowed while the project is ${result.status}.`, 409, {
      status: result.status,
      target: result.target,
    });
  }
  return result.revision;
}

export async function createChangeRequest(user, projectId, revisionId, body = {}, idempotencyHeader) {
  await getRevision(user, projectId, revisionId);
  return startGeneration(user, projectId, {
    mode: 'change_request',
    baseRevisionId: revisionId,
    changeRequest: body.changeRequest || body,
  }, idempotencyHeader);
}

export async function createPreviewGrant(user, projectId, revisionId) {
  const revision = await getRevision(user, projectId, revisionId);
  if (!['READY', 'APPROVED'].includes(revision.status)) {
    throw httpError('BUILDER_PREVIEW_NOT_READY', 'A revision must be ready before previewing.', 409, { status: revision.status });
  }
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const ttlMs = Number(process.env.BUILDER_PREVIEW_TTL_MS || 30 * 60 * 1000);
  const expiresAt = new Date(Date.now() + ttlMs);
  // Stored in SQLite CURRENT_TIMESTAMP shape so expiry comparisons stay sane.
  const grant = await repo.createPreviewGrant({ projectId, revisionId, userId: user.id, tokenHash, expiresAt: repo.sqliteTimestamp(ttlMs) });
  // Opportunistic hygiene: drop long-expired grants.
  repo.deleteExpiredPreviewGrants().catch(() => {});
  const previewBase = String(process.env.BUILDER_PREVIEW_ORIGIN || '').replace(/\/+$/, '');
  const path = isolatedPreviewEnabled()
    ? `/p/${encodeURIComponent(revisionId)}?grant=${encodeURIComponent(token)}`
    : `/api/v1/builder/previews/${encodeURIComponent(revisionId)}?grant=${encodeURIComponent(token)}`;
  return {
    grantId: grant.id,
    url: previewBase ? `${previewBase}${path}` : path,
    expiresAt: expiresAt.toISOString(),
  };
}

export async function revokePreviewGrant(user, grantId) {
  const revoked = await repo.revokePreviewGrant({ grantId, userId: user.id });
  if (!revoked) throw httpError('BUILDER_PREVIEW_GRANT_NOT_FOUND', 'Preview grant not found or already revoked.', 404);
  return { grantId, revoked: true };
}

export async function createDeployment(user, projectId, body = {}, idempotencyHeader, requestId = null) {
  await assertJobsAvailable();
  const project = await getOwnedProject(user, projectId);
  const revisionId = body.revisionId || project.approvedRevisionId;
  if (!revisionId) throw httpError('BUILDER_APPROVED_REVISION_REQUIRED', 'Approve a revision before deployment.', 409);
  const revision = await getRevision(user, projectId, revisionId);
  if (revision.status !== 'APPROVED') {
    throw httpError('BUILDER_REVISION_NOT_APPROVED', 'Only approved revisions can be deployed.', 409, { status: revision.status });
  }
  if (!revision.artifactChecksum) {
    throw httpError('BUILDER_REVISION_ARTIFACT_REQUIRED', 'Approved revision is missing an artifact checksum.', 409);
  }
  // The artifact must exist on disk and still match its recorded checksum.
  try {
    await verifyArtifact(revisionId, revision.artifactChecksum);
  } catch (err) {
    throw httpError(err.code || 'BUILDER_ARTIFACT_INVALID', 'The approved revision artifact failed verification.', 409);
  }

  // Customers never control provider plans/commands: only the exact revision
  // is accepted here; tier stays a server decision (launch-first free plan).
  const payload = {
    schemaVersion: 1,
    revisionId,
    artifactChecksum: revision.artifactChecksum,
  };
  const scopedKey = scopedIdempotencyKey(user.id, 'deploy', projectId, idempotencyHeader);
  const requestHash = repo.stableHash(payload);
  const result = await repo.createDeploymentJob({
    project, revision, userId: user.id,
    idempotencyKey: scopedKey, requestHash, payload, requestId,
  });
  if (result.conflict) {
    throw httpError('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used with different input.', 409);
  }
  if (result.illegal) {
    throw httpError('BUILDER_ILLEGAL_TRANSITION', `Deployment cannot start while the project is ${result.status}.`, 409, {
      status: result.status,
      target: result.target,
    });
  }
  return {
    statusCode: result.reused ? 200 : 202,
    data: {
      jobId: result.job.id,
      jobStatus: result.job.status,
      deployment: result.link,
      reused: result.reused,
    },
  };
}

export async function listDeployments(user, projectId) {
  await getOwnedProject(user, projectId);
  return repo.listDeploymentsForProject(projectId, user.id);
}

function withSummaries(project) {
  return {
    ...project,
    summaries: {
      hasPlan: hasUsefulDoc(project.plan),
      hasAnswerSheet: hasUsefulDoc(project.answerSheet),
      currentRevisionId: project.currentRevisionId,
      approvedRevisionId: project.approvedRevisionId,
    },
  };
}

async function getOwnedProject(user, projectId) {
  const project = await repo.getProjectForUser(projectId, user.id);
  if (!project) throw notFound();
  return project;
}

function hasUsefulDoc(doc) {
  const data = doc?.data ?? doc;
  return data && typeof data === 'object' && Object.keys(data).length > 0;
}

function scopedIdempotencyKey(userId, operation, projectId, header) {
  const raw = String(header || '').trim();
  if (!raw) throw httpError('IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required.', 400);
  if (raw.length > IDEMPOTENCY_MAX) throw httpError('IDEMPOTENCY_KEY_TOO_LONG', 'Idempotency-Key is too long.', 400);
  return `${userId}:${operation}:${projectId}:${raw}`;
}

function notFound() {
  return httpError('BUILDER_PROJECT_NOT_FOUND', 'Builder project not found.', 404);
}

export function httpError(code, message, status = 500, details = undefined) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = details;
  return err;
}
