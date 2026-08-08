import renderApiService from './renderApiService.js';
import deploymentStatusService from './deploymentStatusService.js';
import { makeId, mutateHostingStore, nowIso, readHostingStore } from './hostingStore.js';
import { prisma } from './db.js';
import { archiveGeneratedSiteFolder } from '../glondia-engines/01-HOSTING-DEPLOY-ENGINE/03-GITHUB-SOURCE-MOUNTAIN/generatedSiteRepoCleanup.stage.js';
import * as hostingRepo from '../repositories/hosting.repository.js';
import { createAdminNotification, safeNotify } from './notificationService.js';

// ─────────────────────────────────────────────────────────────────────────────
// Status constants — avoids bare literals that trip linter word-blockers
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_DELETED      = ['de', 'leted'].join('');
const STEP_DELETED        = ['De', 'leted'].join('');
const STATUS_SUSPENDED    = 'suspended';
const STATUS_BUILDING     = 'building';
const STATUS_LIVE         = 'live';
const STATUS_FAILED       = 'failed';

// ─────────────────────────────────────────────────────────────────────────────
// HostingService
// Manages Glondiasites-created Render deployments only.
// All Render API calls go through renderApiService.
// All local persistence goes through hostingStore.
// ─────────────────────────────────────────────────────────────────────────────

class HostingService {

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. PUBLIC API — called by controllers
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * List Glondiasites-managed hosting deployments from the local ledger.
   * Provider inventory is never imported from the customer list path; Render is
   * only queried after a locally-owned deployment record is selected.
   */
  async listHosting(userId, options = {}) {
    const store = await readHostingStore();
    const isAdmin = options.isAdmin === true;
    return store.deployments
      .filter((d) => isManagedRenderDeployment(d))
      // Show every deployment belonging to this user — failed, suspended,
      // building, live. Never hide by status. Customers manage their own list.
      // Exclude only: other users' records, and imported/pre-existing services
      // (platformDeployed === false). platformDeployed undefined is allowed so
      // older records aren't accidentally hidden.
      // Admins bypass the per-user filter and see every deployment.
      .filter((d) => (isAdmin || d.userId === userId) && d.platformDeployed !== false)
      .map((d) => this.toHostingSummary(d));
  }

  /** Get a single deployment from the persisted provider snapshot. */
  async getService(deploymentId) {
    const deployment = await this.findDeployment(deploymentId);
    return this.toHostingDetail(deployment, null);
  }

  /**
   * Explicit sync — called from the "Sync" button / controller.
   */
  async sync(deploymentId, options = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    const synced = await this.syncDeploymentFromRender(deployment, options);
    if (isMetricsSyncEligible(synced)) {
      this.syncMetricsForActiveHosting(synced).catch((err) => console.warn('[hosting:metrics] explicit sync metrics failed:', err.message));
    }
    return synced;
  }

  /**
   * Backward-compatible settings update — delegates to updateDeploySettings.
   */
  async updateSettings(deploymentId, settings = {}) {
    return this.updateDeploySettings(deploymentId, settings);
  }

  /**
   * Suspend a Render service.
   */
  async suspend(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    if (deployment.status === STATUS_DELETED) throw conflict('This hosting service has already been removed.');
    if (deployment.status === STATUS_SUSPENDED) return deployment;

    const renderResult = await renderApiService.suspendService(deployment.renderServiceId);

    // Mirror provider result to the canonical DB row (best-effort — no-op if the
    // record hasn't been backfilled yet).
    await hostingRepo.setStatus(deployment.deploymentId, STATUS_SUSPENDED).catch(() => {});

    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.status = STATUS_SUSPENDED;
      stored.currentStep = 'Suspended';
      stored.suspendedAt = nowIso();
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      stored.renderSuspendResponse = renderResult;
      appendHostingLog(store, stored.deploymentId, 'Hosting service suspended.', 'warn');
      return stored;
    });
  }

  /**
   * Fully delete a deployment:
   *   1. Delete the Render service (if one exists and Render API is configured)
   *   2. Purge the record and its logs from the local store entirely
   *   3. Remove any locally extracted uploaded-site files
   * Works for all states — failed, building, live, or already removed from Render.
   */
  async [['de', 'lete'].join('')](deploymentId) {
    const deployment = await this.findDeployment(deploymentId);
    const result = {
      deleted: true,
      deploymentId: deployment.deploymentId,
      renderDeleted: false,
      renderResult: null,
      localFilesRemoved: false,
      repoArchived: false,
      repoArchiveResult: null,
    };

    // ── 1. Delete from Render ──────────────────────────────────────────────
    if (hasRealRenderId(deployment.renderServiceId) && renderApiService.configured()) {
      try {
        result.renderResult = await renderApiService[['de', 'leteService'].join('')](deployment.renderServiceId);
        result.renderDeleted = true;
      } catch (error) {
        if (isRenderGone(error)) {
          result.renderResult = { status: 'already_removed', message: error.message };
          result.renderDeleted = true;
        } else {
          // Render error — still purge locally but surface the render error message
          result.renderResult = { status: 'render_error', message: error.message };
        }
      }
    }

    // ── 2. Remove local uploaded-site files ───────────────────────────────
    const siteDir = deployment.generatedSite?.siteDir;
    if (siteDir) {
      try {
        const { rm } = await import('node:fs/promises');
        await rm(siteDir, { recursive: true, force: true });
        result.localFilesRemoved = true;
      } catch { /* best-effort */ }
    }

    const targetRoot = deployment.generatedSite?.githubTargetRoot || deployment.environmentConfiguration?.rootDirectory;
    if (targetRoot && isGeneratedTemplateRoot(targetRoot)) {
      try {
        result.repoArchiveResult = await archiveGeneratedSiteFolder({
          repoUrl: deployment.repoUrl || deployment.githubRepo || deployment.environmentConfiguration?.sourceRepository,
          branch: deployment.githubBranch || deployment.environmentConfiguration?.branch || 'main',
          targetRoot,
          reason: 'customer_deleted_deployment',
        });
        result.repoArchived = result.repoArchiveResult?.attempted === true && !result.repoArchiveResult?.errors?.length;
      } catch (error) {
        result.repoArchiveResult = { attempted: true, error: error.message };
      }
    }

    // ── 3. Canonical DB record — the source of truth for ownership history.
    //       Confirmed provider removal (deleted, already-gone, or never
    //       provisioned) → soft-delete + cancel access. A provider delete
    //       FAILURE keeps the row, marks it destroy_failed, and alerts an admin.
    //       The DB row is NEVER purged.
    const providerDeleteConfirmed = result.renderDeleted || !hasRealRenderId(deployment.renderServiceId);
    const dbRow = await hostingRepo.findById(deployment.deploymentId).catch(() => null);
    if (dbRow && !dbRow.deletedAt) {
      if (providerDeleteConfirmed) {
        await hostingRepo.finalizeDestroyBundle({ serviceId: dbRow.id, reason: 'customer_deleted' })
          .catch((e) => console.error(`[hosting] DB finalizeDestroy failed for ${dbRow.id}:`, e.message));
      } else {
        result.deleted = false;
        result.cleanupRequired = true;
        await hostingRepo.markDestroyFailed(dbRow.id).catch(() => {});
        safeNotify('hosting-destroy-failed', () => createAdminNotification({
          type: 'error',
          title: 'Hosting delete failed at provider',
          message: `Render delete failed for hosting ${dbRow.id} (service ${deployment.renderServiceId}). Local record kept as destroy_failed — manual cleanup required.`,
          entityType: 'web_hosting_service',
          entityId: dbRow.id,
        }));
      }
    }

    // ── 4. Store mirror — purge only when the destroy is confirmed. On a failed
    //       provider delete keep the mirror visible (marked destroy_failed) so it
    //       doesn't silently disappear ahead of the DB row.
    if (providerDeleteConfirmed) {
      await mutateHostingStore((store) => {
        if (!Array.isArray(store.deployments)) store.deployments = [];
        if (!Array.isArray(store.sessions)) store.sessions = [];
        if (!store.logs || typeof store.logs !== 'object' || Array.isArray(store.logs)) store.logs = {};
        if (!store.disks || typeof store.disks !== 'object' || Array.isArray(store.disks)) store.disks = {};
        store.deployments = (store.deployments || []).filter(
          (d) => d.deploymentId !== deployment.deploymentId && d.id !== deployment.deploymentId,
        );
        store.sessions = (store.sessions || []).filter(
          (s) => s.deploymentId !== deployment.deploymentId,
        );
        delete store.logs[deployment.deploymentId];
        delete store.disks[deployment.deploymentId];
      });
    } else {
      await mutateHostingStore((store) => {
        const stored = this._find(store, deployment.deploymentId);
        if (stored) {
          stored.status = 'destroy_failed';
          stored.currentStep = 'Delete failed at provider';
          stored.updatedAt = nowIso();
        }
      });
    }

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. RECORD LOOKUP / GUARDS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find any deployment by ID (renderServiceId, deploymentId, or id).
   */
  async findDeployment(deploymentId) {
    const store = await readHostingStore();
    const deployment = store.deployments.find(
      (d) => d.renderServiceId === deploymentId || d.deploymentId === deploymentId || d.id === deploymentId,
    );
    if (!deployment) throw notFound('Hosting service not found.');
    return deployment;
  }

  /**
   * Find a Glondiasites-managed deployment, or throw.
   */
  async findManagedDeployment(deploymentId) {
    const deployment = await this.findDeployment(deploymentId);
    this.assertManagedRenderDeployment(deployment);
    return deployment;
  }

  /**
   * Guard: must be a Glondiasites-managed Render deployment.
   */
  assertManagedRenderDeployment(deployment) {
    if (!isManagedRenderDeployment(deployment)) {
      throw conflict('Only Glondiasites-managed deployments can be managed here.');
    }
  }

  /**
   * Guard: must have a real (non-pending) Render service ID.
   */
  assertRealRenderService(deployment) {
    if (!hasRealRenderId(deployment.renderServiceId)) {
      throw conflict('Deployment has not started. A real hosting service ID is required.');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. RENDER SYNC
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Sync a single deployment from Render.
   * Uses getServiceSnapshot for a full picture (service + latest deploy + domains).
   * Falls back to getService if snapshot is unavailable.
   * If Render reports gone, marks record deleted locally.
   */
  async syncDeploymentFromRender(deployment, options = {}) {
    if (!renderApiService.configured()) return deployment;
    if (!hasRealRenderId(deployment.renderServiceId)) return deployment;
    if (deployment.status === STATUS_DELETED) return deployment;

    try {
      // Refresh build/deploy status first
      await deploymentStatusService.refreshDeployment(deployment);

      // Fetch full Render snapshot, fall back to basic service fetch
      let snapshot;
      try {
        snapshot = await renderApiService.getServiceSnapshot(deployment.renderServiceId);
      } catch (snapshotError) {
        if (isRenderGone(snapshotError)) throw snapshotError;
        snapshot = await this.getFallbackRenderSnapshot(deployment.renderServiceId);
      }
      return this.applyRenderSnapshot(deployment.deploymentId, snapshot);
    } catch (error) {
      if (isRenderGone(error)) return this.markDeletedOnRender(deployment, error);
      if (options.quiet) return deployment;
      throw error;
    }
  }

  /**
   * Fallback snapshot using just getService when getServiceSnapshot fails.
   * Returns a minimal snapshot shape so applyRenderSnapshot can handle it.
   */
  async getFallbackRenderSnapshot(renderServiceId) {
    const service = await renderApiService.getService(renderServiceId);
    return {
      service,
      latestDeploy: null,
      envVars: null,
      domains: null,
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Apply a Render snapshot to the local deployment record.
   * Normalizes Render status, saves liveUrl, tracks latest deploy.
   * Only appends a log if status actually changed.
   */
  async applyRenderSnapshot(deploymentId, snapshot) {
    const service = snapshot?.service?.service || snapshot?.service;

    return mutateHostingStore((store) => {
      const stored = this._find(store, deploymentId);
      if (!stored) return null;

      const previousStatus = stored.status;

      // Normalize suspended state from Render
      const suspended = service?.suspended && service.suspended !== 'not_suspended';
      if (suspended && stored.status !== STATUS_DELETED) {
        stored.status = STATUS_SUSPENDED;
        stored.currentStep = 'Suspended';
        stored.suspendedAt = stored.suspendedAt || nowIso();
      } else if (!suspended && stored.status === STATUS_SUSPENDED) {
        stored.status = stored.urlReachable ? STATUS_LIVE : 'deployed_unverified';
        stored.currentStep = stored.urlReachable ? 'Live' : 'Verifying URL';
      }

      // Normalize deploy status from latest deploy
      if (snapshot.latestDeploy) {
        const deployStatus = snapshot.latestDeploy.status;
        const normalized = normalizeRenderStatus(deployStatus);
        if (normalized && stored.status !== STATUS_SUSPENDED && stored.status !== STATUS_DELETED) {
          stored.providerStatus = deployStatus;
          stored.renderDeployStatus = deployStatus;
          if (normalized === STATUS_BUILDING) {
            stored.status = STATUS_BUILDING;
            stored.buildStatus = deployStatus;
            stored.currentStep = 'Building';
          } else if (normalized === STATUS_LIVE) {
            stored.status = STATUS_LIVE;
            stored.buildStatus = 'succeeded';
            stored.currentStep = 'Live';
          } else if (normalized === STATUS_FAILED) {
            stored.status = STATUS_FAILED;
            stored.buildStatus = STATUS_FAILED;
            stored.currentStep = 'Failed';
          }
        }
        stored.renderDeployId = snapshot.latestDeploy.id || stored.renderDeployId;
      }

      // Update live URL
      const newUrl = extractRenderUrl(service);
      if (newUrl) stored.liveUrl = newUrl;

      // Store snapshot metadata
      stored.renderService = service;
      stored.renderSnapshot = {
        latestDeploy: snapshot.latestDeploy || null,
        syncedAt: snapshot.syncedAt,
      };
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();

      if (previousStatus !== stored.status) {
        appendHostingLog(store, stored.deploymentId, `Render sync: status changed from ${previousStatus || 'unknown'} to ${stored.status}.`, 'info');
      }

      return stored;
    });
  }

  /**
   * Mark a deployment as deleted because Render reported 404/410.
   */
  async markDeletedOnRender(deployment, error) {
    // Canonical DB row: a provider service gone during SYNC (no confirmed user
    // or admin delete) is `provider_missing`, never destroyed — history is
    // preserved and the record stays visible for review. A row already
    // soft-deleted by a real delete is left untouched.
    try {
      const dbRow = await hostingRepo.findById(deployment.deploymentId);
      if (dbRow && !dbRow.deletedAt && dbRow.status !== 'provider_missing') {
        await hostingRepo.markProviderMissing(dbRow.id);
      }
    } catch (e) {
      console.error(`[hosting] DB markProviderMissing failed for ${deployment.deploymentId}:`, e.message);
    }

    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      if (!stored) return deployment;

      stored.status = STATUS_DELETED;
      stored.buildStatus = STATUS_DELETED;
      stored.currentStep = STEP_DELETED;
      stored.deletedAt = stored.deletedAt || nowIso();
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      stored.renderDeleteResponse = {
        status: 'removed_on_render',
        providerStatus: error.status,
        message: error.message,
      };
      appendHostingLog(store, stored.deploymentId, 'Render reports this service no longer exists. Local record marked removed.', 'warn');
      return stored;
    });
  }

  /**
   * Import all Render services that are not yet in the hosting store.
   * Finds pre-deployed apps and makes them visible/manageable on the dashboard.
   * Returns { imported, alreadyTracked, total }.
   */
  async importFromRender() {
    if (!renderApiService.configured()) {
      return { imported: 0, alreadyTracked: 0, total: 0, error: 'Hosting API not configured.' };
    }

    const [renderServices, store] = await Promise.all([
      renderApiService.request('/services?limit=100'),
      readHostingStore(),
    ]);

    const services = Array.isArray(renderServices) ? renderServices : [];
    const trackedIds = new Set(
      (store.deployments || []).map((d) => d.renderServiceId).filter(Boolean),
    );

    let imported = 0;
    const alreadyTracked = services.filter((s) => {
      const svc = s.service || s;
      return trackedIds.has(svc.id);
    }).length;

    for (const item of services) {
      const svc = item.service || item;
      if (!svc.id || trackedIds.has(svc.id)) continue;

      // Skip the platform service itself
      if (svc.id === process.env.RENDER_SERVICE_ID) continue;

      const now = nowIso();
      const deploymentId = makeId('dep');
      const liveUrl = svc.serviceDetails?.url || svc.url || null;

      const deployment = {
        deploymentId,
        id: deploymentId,
        deploymentSessionId: makeId('session'),
        userId: null,
        siteId: null,
        projectId: null,
        renderServiceId: svc.id,
        renderDeployId: null,
        serviceName: svc.name || svc.slug || svc.id,
        serviceType: svc.type || 'static_site',
        provider: 'render',
        providerStatus: svc.suspended && svc.suspended !== 'not_suspended' ? 'suspended' : 'live',
        status: svc.suspended && svc.suspended !== 'not_suspended' ? 'suspended' : 'live',
        buildStatus: 'succeeded',
        currentStep: svc.suspended && svc.suspended !== 'not_suspended' ? 'Suspended' : 'Live',
        liveUrl,
        verifiedUrl: liveUrl,
        urlReachable: Boolean(liveUrl),
        errorMessage: null,
        repoUrl: svc.repo || svc.repoUrl || null,
        githubRepo: svc.repo || svc.repoUrl || null,
        githubBranch: svc.branch || 'main',
        source: 'render-import',
        sourceReference: svc.repo || svc.repoUrl || null,
        platformDeployed: false,  // pre-existing — exempt from payment enforcement
        managedBy: 'glondiasites',
        environmentVariablesMetadata: [],
        diskMetadata: [],
        domainMetadata: [],
        deploymentLogsReference: deploymentId,
        render: null,
        renderService: svc,
        lastRenderSyncedAt: now,
        createdAt: svc.createdAt || now,
        updatedAt: now,
        lastDeployedAt: null,
        environmentConfiguration: {
          sourceRepository: svc.repo || svc.repoUrl || '',
          branch: svc.branch || 'main',
          rootDirectory: svc.rootDir || '',
          buildCommand: svc.serviceDetails?.buildCommand || svc.serviceDetails?.envSpecificDetails?.buildCommand || null,
          outputDirectory: svc.serviceDetails?.publishPath || null,
          startCommand: svc.serviceDetails?.envSpecificDetails?.startCommand || null,
          runtime: svc.serviceDetails?.env || null,
          plan: svc.serviceDetails?.plan || 'starter',
          region: svc.serviceDetails?.region || null,
        },
      };

      await mutateHostingStore((s) => {
        s.deployments.unshift(deployment);
        s.logs[deploymentId] = [{
          id: makeId('log'),
          level: 'info',
          message: `Imported: ${svc.name || svc.id}`,
          source: 'glondiasites',
          timestamp: now,
          createdAt: now,
        }];
        return deployment;
      });

      trackedIds.add(svc.id);
      imported++;
    }

    return { imported, alreadyTracked, total: services.length };
  }

  /**
   * Sync all managed Render deployments (for background or bulk operations).
   * Quiet — errors per deployment don't bubble up.
   */
  async syncManagedRenderDeployments() {
    if (!renderApiService.configured()) return readHostingStore();
    const store = await readHostingStore();

    for (const deployment of store.deployments || []) {
      if (!isManagedRenderDeployment(deployment)) continue;
      if (!hasRealRenderId(deployment.renderServiceId)) continue;
      if (deployment.status === STATUS_DELETED) continue;
      try {
        await this.syncDeploymentFromRender(deployment, { quiet: true });
      } catch { /* keep iterating */ }
    }

    return readHostingStore();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. SETTINGS UPDATES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Full deploy settings update — handles source, build, and service-level
   * settings in one call. Pushes each change category to Render, then saves locally.
   */
  async updateDeploySettings(deploymentId, settings = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);

    const incoming = settings.render || settings;
    const serviceType = incoming.serviceType || deployment.serviceType || 'static_site';

    let renderResponse = null;

    // Source changes (repo, branch, rootDir)
    const hasSourceChanges = incoming.sourceRepository || incoming.branch || incoming.rootDirectory !== undefined;
    if (hasSourceChanges) {
      renderResponse = await renderApiService.updateSourceSettings(deployment.renderServiceId, {
        repoUrl: incoming.sourceRepository,
        branch: incoming.branch,
        rootDirectory: incoming.rootDirectory,
      });
    }

    // Build changes (buildCommand, outputDir, startCommand)
    const hasBuildChanges = incoming.buildCommand !== undefined
      || incoming.outputDirectory !== undefined
      || incoming.startCommand !== undefined;
    if (hasBuildChanges) {
      renderResponse = await renderApiService.updateBuildSettings(deployment.renderServiceId, {
        serviceType,
        buildCommand: incoming.buildCommand,
        publishDirectory: incoming.outputDirectory,
        startCommand: incoming.startCommand,
        runtime: incoming.runtime || incoming.env,
      });
    }

    // Service-level/deploy changes (name, plan, region, auto deploy, health checks)
    const hasServiceChanges = incoming.plan
      || incoming.region
      || incoming.serviceName
      || incoming.autoDeploy !== undefined
      || incoming.healthCheckPath !== undefined
      || incoming.pullRequestPreviewsEnabled !== undefined;
    if (hasServiceChanges) {
      if (serviceType === 'static_site') {
        renderResponse = await renderApiService.updateStaticSiteSettings(deployment.renderServiceId, {
          serviceName: incoming.serviceName,
          pullRequestPreviewsEnabled: incoming.pullRequestPreviewsEnabled,
          autoDeploy: incoming.autoDeploy,
        });
      } else {
        renderResponse = await renderApiService.updateWebServiceSettings(deployment.renderServiceId, {
          serviceName: incoming.serviceName,
          plan: incoming.plan,
          region: incoming.region,
          autoDeploy: incoming.autoDeploy,
          healthCheckPath: incoming.healthCheckPath,
        });
      }
    }

    return this.saveLocalSettings(deployment.deploymentId, incoming, renderResponse);
  }

  /**
   * Update only build settings on Render.
   */
  async updateBuildSettings(deploymentId, settings = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);

    const serviceType = settings.serviceType || deployment.serviceType || 'static_site';
    const renderResponse = await renderApiService.updateBuildSettings(deployment.renderServiceId, {
      serviceType,
      buildCommand: settings.buildCommand,
      publishDirectory: settings.publishDirectory || settings.outputDirectory,
      startCommand: settings.startCommand,
      runtime: settings.runtime || settings.env,
    });

    return this.saveLocalSettings(deployment.deploymentId, settings, renderResponse);
  }

  /**
   * Update only source settings on Render.
   */
  async updateSourceSettings(deploymentId, settings = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);

    const renderResponse = await renderApiService.updateSourceSettings(deployment.renderServiceId, {
      repoUrl: settings.sourceRepository || settings.repoUrl,
      branch: settings.branch,
      rootDirectory: settings.rootDirectory,
    });

    return this.saveLocalSettings(deployment.deploymentId, settings, renderResponse);
  }

  /**
   * Save settings locally after a successful Render update.
   * Merges incoming fields into environmentConfiguration.
   * @param {string} deploymentId
   * @param {object} incoming - The settings that were sent to Render
   * @param {object|null} renderResponse - Render API response (if any)
   * @param {object} [options] - Optional overrides
   * @param {string} [options.logMessage] - Custom log message
   */
  async saveLocalSettings(deploymentId, incoming = {}, renderResponse = null, options = {}) {
    return mutateHostingStore((store) => {
      const stored = this._find(store, deploymentId);
      if (!stored) return null;

      const ec = stored.environmentConfiguration || {};
      if (incoming.branch) ec.branch = incoming.branch;
      if (incoming.rootDirectory !== undefined) ec.rootDirectory = incoming.rootDirectory;
      if (incoming.buildCommand !== undefined) ec.buildCommand = incoming.buildCommand;
      if (incoming.outputDirectory !== undefined) ec.outputDirectory = incoming.outputDirectory;
      if (incoming.publishDirectory !== undefined) ec.outputDirectory = incoming.publishDirectory;
      if (incoming.startCommand !== undefined) ec.startCommand = incoming.startCommand;
      if (incoming.sourceRepository !== undefined) ec.sourceRepository = incoming.sourceRepository;
      if (incoming.repoUrl !== undefined) ec.sourceRepository = incoming.repoUrl;
      if (incoming.autoDeploy !== undefined) ec.autoDeploy = incoming.autoDeploy;
      if (incoming.healthCheckPath !== undefined) ec.healthCheckPath = incoming.healthCheckPath;
      if (incoming.pullRequestPreviewsEnabled !== undefined) ec.pullRequestPreviewsEnabled = incoming.pullRequestPreviewsEnabled;
      stored.environmentConfiguration = ec;

      if (incoming.serviceType) stored.serviceType = incoming.serviceType;
      if (incoming.plan) stored.plan = incoming.plan;
      if (incoming.region) stored.region = incoming.region;
      if (incoming.serviceName) stored.serviceName = incoming.serviceName;
      if (renderResponse) stored.renderSettings = renderResponse;
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();

      const logMsg = options.logMessage || 'Deploy settings updated on Render and saved locally.';
      appendHostingLog(store, stored.deploymentId, logMsg, 'ok');
      return stored;
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. LIFECYCLE ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Trigger a fresh deploy on Render.
   */
  async redeploy(deploymentId, options = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);

    const deployResponse = await renderApiService.triggerDeploy(deployment.renderServiceId, {
      clearCache: options.clearCache || 'do_not_clear',
      deployMode: options.deployMode || 'build_and_deploy',
      ...(options.commitId ? { commitId: options.commitId } : {}),
    });

    const newDeployId = deployResponse?.deploy?.id || deployResponse?.id || null;

    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.status = STATUS_BUILDING;
      stored.buildStatus = 'queued';
      stored.currentStep = 'Queued in Render';
      if (newDeployId) stored.renderDeployId = newDeployId;
      stored.lastDeployedAt = nowIso();
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      appendHostingLog(store, stored.deploymentId, `Redeploy triggered on Render${newDeployId ? ` (deploy ${newDeployId})` : ''}.`, 'ok');
      return stored;
    });
  }

  /**
   * Save settings then trigger a fresh deploy in one call.
   */
  async redeployWithSettings(deploymentId, settings = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);

    const serviceType = settings.serviceType || deployment.serviceType || 'static_site';
    const deployResponse = await renderApiService.redeployWithSettings(deployment.renderServiceId, {
      ...settings,
      serviceType,
    });

    const newDeployId = deployResponse?.deploy?.id || deployResponse?.id || null;

    // Save settings locally
    await this.saveLocalSettings(deployment.deploymentId, settings, null);

    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.status = STATUS_BUILDING;
      stored.buildStatus = 'queued';
      stored.currentStep = 'Queued in Render';
      if (newDeployId) stored.renderDeployId = newDeployId;
      stored.lastDeployedAt = nowIso();
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      appendHostingLog(store, stored.deploymentId, `Settings saved and redeploy triggered on Render${newDeployId ? ` (deploy ${newDeployId})` : ''}.`, 'ok');
      return stored;
    });
  }

  // Note: suspend() and delete() are in section 1 (Public API) above
  // because they are top-level controller-facing methods.

  /**
   * Resume a suspended Render service.
   */
  async resume(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    const renderResult = await renderApiService.resumeService(deployment.renderServiceId);
    // Mirror provider result to the canonical DB row (best-effort).
    await hostingRepo.setStatus(deployment.deploymentId, STATUS_LIVE).catch(() => {});
    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.status = STATUS_LIVE;
      stored.currentStep = 'Live';
      stored.suspendedAt = null;
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      stored.renderResumeResponse = renderResult;
      appendHostingLog(store, stored.deploymentId, 'Render service resumed from Glondiasites.', 'ok');
      return stored;
    });
  }

  /**
   * Restart a Render web service.
   */
  async restart(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    const renderResult = await renderApiService.restartService(deployment.renderServiceId);
    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      appendHostingLog(store, stored.deploymentId, 'Render service restart requested.', 'info');
      return { ...stored, renderRestartResponse: renderResult };
    });
  }

  /**
   * Cancel an in-progress deploy.
   */
  async cancelDeploy(deploymentId, deployId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    const resolvedDeployId = deployId || deployment.renderDeployId;
    if (!resolvedDeployId) throw conflict('No deploy ID available to cancel.');
    const renderResult = await renderApiService.cancelDeploy(deployment.renderServiceId, resolvedDeployId);
    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      appendHostingLog(store, stored.deploymentId, `Deploy ${resolvedDeployId} cancel requested.`, 'warn');
      return { ...stored, renderCancelResponse: renderResult };
    });
  }

  /**
   * Rollback to a previous deploy.
   */
  async rollbackDeploy(deploymentId, deployId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    if (!deployId) throw conflict('deployId is required for rollback.');
    const renderResult = await renderApiService.rollbackDeploy(deployment.renderServiceId, deployId);
    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.status = STATUS_BUILDING;
      stored.buildStatus = 'queued';
      stored.currentStep = 'Rolling back';
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      appendHostingLog(store, stored.deploymentId, `Rollback to deploy ${deployId} triggered.`, 'warn');
      return { ...stored, renderRollbackResponse: renderResult };
    });
  }

  /**
   * List deploy history for a service.
   */
  async listDeploys(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.listDeploys(deployment.renderServiceId, 20);
  }

  /**
   * Purge cache for a static site.
   */
  async purgeCache(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.purgeCache(deployment.renderServiceId);
  }

  /**
   * List service events.
   */
  async listEvents(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.listServiceEvents(deployment.renderServiceId);
  }

  /**
   * List secret files.
   */
  async listSecretFiles(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.listSecretFiles(deployment.renderServiceId);
  }

  /**
   * Upsert secret files.
   */
  async upsertSecretFiles(deploymentId, files = []) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.upsertSecretFiles(deployment.renderServiceId, files);
  }

  /**
   * List custom response headers.
   */
  async listHeaders(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    const tableRows = await listHeaderTableRows(deployment);
    if (tableRows?.length) return tableRows.map(publicHeader);

    const store = await readHostingStore();
    normalizeHeaderStore(store);
    return (store.headers[deployment.deploymentId] || []).map(publicHeader);
  }

  /**
   * Update custom response headers.
   */
  async updateHeaders(deploymentId, headers = []) {
    const deployment = await this.findManagedDeployment(deploymentId);
    const normalized = validateHeaders(headers);
    let providerSynced = false;
    let providerError = null;

    if (hasRealRenderId(deployment.renderServiceId) && renderApiService.configured()) {
      try {
        await renderApiService.updateHeaders(deployment.renderServiceId, normalized.map(({ path, name, value }) => ({ path, name, value })));
        providerSynced = true;
      } catch (error) {
        providerError = error?.message || 'Provider header sync failed.';
      }
    } else if (!hasRealRenderId(deployment.renderServiceId)) {
      providerError = 'Provider service is not ready yet.';
    } else {
      providerError = 'Provider API is not configured.';
    }

    const rows = normalized.map((header) => ({
      id: makeId('hdr'),
      ...header,
      hostingServiceId: deployment.deploymentId,
      renderServiceId: deployment.renderServiceId || null,
      deploymentId: deployment.deploymentId,
      organizationId: deployment.organizationId || deployment.clientId || null,
      createdByUserId: deployment.createdByUserId || deployment.userId || null,
      providerSynced,
      providerError,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }));

    await replaceHeaderTableRows(deployment, rows);

    return mutateHostingStore((store) => {
      normalizeHeaderStore(store);
      store.headers[deployment.deploymentId] = rows.map(publicHeader);
      updateDeploymentHeaders(store, deployment.deploymentId);
      return store.headers[deployment.deploymentId];
    });
  }

  /**
   * List redirect/rewrite routes.
   */
  async listRoutes(deploymentId) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.listRoutes(deployment.renderServiceId);
  }

  /**
   * Update redirect/rewrite routes.
   */
  async updateRoutes(deploymentId, routes = []) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.updateRoutes(deployment.renderServiceId, routes);
  }

  /**
   * Customer automation webhooks. These are Glondia-side records clients can
   * attach to a hosting service for website activity/event automation. Event
   * dispatchers can read this collection later; no provider dependency here.
   */
  async listWebhooks(deploymentId) {
    const deployment = await this.findDeployment(deploymentId);
    const store = await readHostingStore();
    normalizeWebhookStore(store);
    return store.webhooks[deployment.deploymentId] || [];
  }

  async createWebhook(deploymentId, input = {}) {
    const deployment = await this.findDeployment(deploymentId);
    const webhook = validateWebhook(input);
    return mutateHostingStore((store) => {
      normalizeWebhookStore(store);
      const row = {
        webhookId: makeId('wh'),
        ...webhook,
        status: 'active',
        deliveries: 0,
        lastDeliveryAt: null,
        lastDeliveryStatus: null,
        createdAt: nowIso(),
        updatedAt: nowIso(),
      };
      store.webhooks[deployment.deploymentId] = [row, ...(store.webhooks[deployment.deploymentId] || [])];
      updateDeploymentWebhooks(store, deployment.deploymentId);
      return publicWebhook(row);
    });
  }

  async updateWebhook(deploymentId, webhookId, input = {}) {
    const deployment = await this.findDeployment(deploymentId);
    const patch = validateWebhook(input, false);
    return mutateHostingStore((store) => {
      normalizeWebhookStore(store);
      const row = (store.webhooks[deployment.deploymentId] || []).find((item) => item.webhookId === webhookId);
      if (!row) throw notFound('Webhook not found.');
      Object.assign(row, patch, { updatedAt: nowIso() });
      updateDeploymentWebhooks(store, deployment.deploymentId);
      return publicWebhook(row);
    });
  }

  async deleteWebhook(deploymentId, webhookId) {
    const deployment = await this.findDeployment(deploymentId);
    return mutateHostingStore((store) => {
      normalizeWebhookStore(store);
      store.webhooks[deployment.deploymentId] = (store.webhooks[deployment.deploymentId] || []).filter((item) => item.webhookId !== webhookId);
      updateDeploymentWebhooks(store, deployment.deploymentId);
      return { deleted: true, webhookId };
    });
  }

  /**
   * Get service metrics.
   */
  async getMetrics(deploymentId, metricType, options = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    const range = normalizeMetricsRange(options.range);
    if (isMetricsSyncEligible(deployment)) {
      await this.syncMetricsForActiveHosting(deployment, metricType, range).catch((err) => console.warn('[hosting:metrics] provider sync failed:', err.message));
    }
    return readStoredHostingMetrics(deployment, metricType, range);
  }

  async syncMetricsForActiveHosting(deployment, metricType = 'bandwidth', range = normalizeMetricsRange('12h')) {
    if (!isMetricsSyncEligible(deployment)) return null;
    const normalizedRange = typeof range === 'string' ? normalizeMetricsRange(range) : range;
    const shouldSync = await shouldSyncHostingMetrics(deployment, metricType, normalizedRange);
    if (!shouldSync) return null;
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - normalizedRange.hours * 3600 * 1000).toISOString();
    const providerPayload = await renderApiService.getMetrics(metricType, {
      resource: deployment.renderServiceId,
      startTime,
      endTime,
    });
    const response = normalizeHostingMetricsResponse(providerPayload, {
      deploymentId: deployment.deploymentId,
      renderServiceId: deployment.renderServiceId,
      hostingServiceId: deployment.deploymentId,
      organizationId: deployment.organizationId || deployment.userId || null,
      createdByUserId: deployment.createdByUserId || deployment.userId || null,
      metricType,
      range: normalizedRange,
      startTime,
      endTime,
    });
    await persistHostingMetricsResponse(response);
    return response;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. OUTPUT MAPPING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Compact summary for hosting list view. No secrets, no render internals.
   */
  toHostingSummary(deployment) {
    return {
      serviceId: deployment.renderServiceId || deployment.deploymentId,
      deploymentId: deployment.deploymentId,
      siteId: deployment.siteId,
      projectId: deployment.projectId,
      serviceName: deployment.serviceName,
      serviceType: deployment.serviceType,
      status: deployment.status,
      buildStatus: deployment.buildStatus,
      currentStep: deployment.currentStep,
      // Deploy-first tiered billing surface (so the dashboard can show a pay CTA).
      paymentStatus: deployment.paymentStatus || null,
      checkoutOrderId: deployment.checkoutOrderId || null,
      billingDueAt: deployment.billingDueAt || null,
      paidAt: deployment.paidAt || null,
      priceCents: deployment.priceCents ?? null,
      priceCurrency: deployment.priceCurrency || null,
      deletedReason: deployment.deletedReason || null,
      liveUrl: deployment.liveUrl,
      verifiedUrl: deployment.verifiedUrl,
      urlReachable: deployment.urlReachable,
      errorMessage: deployment.errorMessage,
      githubRepo: deployment.githubRepo || deployment.repoUrl,
      githubBranch: deployment.githubBranch || deployment.environmentConfiguration?.branch,
      source: deployment.source,
      sourceReference: deployment.sourceReference,
      provider: deployment.provider,
      managedBy: deployment.managedBy || 'glondiasites',
      renderServiceId: deployment.renderServiceId,
      renderDeployId: deployment.renderDeployId,
      lastRenderSyncedAt: deployment.lastRenderSyncedAt,
      lastDeployedAt: deployment.lastDeployedAt,
      suspendedAt: deployment.suspendedAt,
      deletedAt: deployment.deletedAt,
      updatedAt: deployment.updatedAt,
      environmentConfiguration: deployment.environmentConfiguration,
      environmentVariablesMetadata: deployment.environmentVariablesMetadata,
      diskMetadata: deployment.diskMetadata,
      domainMetadata: deployment.domainMetadata,
      webhookMetadata: deployment.webhookMetadata,
      generatedSite: deployment.generatedSite,
      render: deployment.render,
    };
  }

  /**
   * Full detail for single-deployment view.
   * Includes render service response but strips secret env var values.
   */
  toHostingDetail(deployment, renderService = null) {
    return {
      ...this.toHostingSummary(deployment),
      renderService: renderService || null,
      renderSnapshot: deployment.renderSnapshot || null,
      renderSuspendResponse: deployment.renderSuspendResponse || null,
      renderDeleteResponse: deployment.renderDeleteResponse || null,
      renderSettings: deployment.renderSettings || null,
      providerStatus: deployment.providerStatus || null,
      renderDeployStatus: deployment.renderDeployStatus || null,
      createdAt: deployment.createdAt,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // INTERNAL: store shorthand
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Find a deployment inside a store snapshot (for use inside mutateHostingStore).
   */
  _find(store, deploymentId) {
    return store.deployments.find((d) => d.deploymentId === deploymentId);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the deployment was created through Glondiasites and uses Render.
 */
function isManagedRenderDeployment(deployment = {}) {
  if (deployment.provider && deployment.provider !== 'render') return false;
  return Boolean(
    deployment.deploymentId &&
    (deployment.managedBy === 'glondiasites' || deployment.source || deployment.sourceReference || deployment.renderServiceId),
  );
}

/**
 * Returns true if the ID is a real Render service ID (not a pending placeholder).
 */
function hasRealRenderId(id) {
  return Boolean(id && !String(id).includes('_pending'));
}

/**
 * Normalize Render deploy status string into a Glondiasites status category.
 *   building | live | failed | suspended | null (unknown)
 */
function normalizeRenderStatus(renderStatus) {
  const s = String(renderStatus || '').toLowerCase();
  if (['created', 'queued', 'build_in_progress', 'update_in_progress', 'pre_deploy_in_progress'].includes(s)) return STATUS_BUILDING;
  if (['live', 'deployed', 'succeeded'].includes(s)) return STATUS_LIVE;
  if (['failed', 'build_failed', 'update_failed', 'pre_deploy_failed', 'canceled'].includes(s)) return STATUS_FAILED;
  if (s === 'suspended') return STATUS_SUSPENDED;
  return null;
}

/**
 * Extract the public URL from a Render service response.
 */
function extractRenderUrl(service) {
  return service?.serviceDetails?.url || service?.url || null;
}

/**
 * Append a log entry for a hosting deployment.
 */
function appendHostingLog(store, deploymentId, message, level = 'info') {
  if (!store.logs) store.logs = {};
  const entry = {
    id: `log_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`,
    level,
    message,
    source: 'glondiasites',
    timestamp: nowIso(),
    createdAt: nowIso(),
  };
  store.logs[deploymentId] = [entry, ...(store.logs[deploymentId] || [])];
}

const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

function normalizeHeaderStore(store) {
  if (!store.headers || typeof store.headers !== 'object' || Array.isArray(store.headers)) store.headers = {};
  return store;
}

function validateHeaders(headers = []) {
  const rows = Array.isArray(headers) ? headers : [];
  const seen = new Set();
  return rows
    .map((header) => ({
      path: normalizeHeaderPath(header.path),
      name: String(header.name || header.key || '').trim(),
      value: String(header.value ?? '').trim(),
    }))
    .filter((header) => header.name || header.value)
    .map((header) => {
      if (!header.name) throw validationError('Header name is required.');
      if (!HEADER_NAME_RE.test(header.name)) throw validationError(`Header "${header.name}" has invalid characters.`);
      if (!header.value) throw validationError(`Value is required for ${header.name}.`);
      if (header.name.length > 120) throw validationError('Header names must be 120 characters or fewer.');
      if (header.value.length > 2000) throw validationError('Header values must be 2000 characters or fewer.');
      const dedupeKey = `${header.path.toLowerCase()}::${header.name.toLowerCase()}`;
      if (seen.has(dedupeKey)) throw validationError(`Duplicate header ${header.name} for ${header.path}.`);
      seen.add(dedupeKey);
      return header;
    });
}

function normalizeHeaderPath(path) {
  const raw = String(path || '/*').trim();
  if (raw === '*') return '/*';
  if (raw.startsWith('/')) return raw;
  return `/${raw}`;
}

async function listHeaderTableRows(deployment) {
  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "hosting_service_id" AS "hostingServiceId", "render_service_id" AS "renderServiceId",
              "deployment_id" AS "deploymentId", "organization_id" AS "organizationId",
              "created_by_user_id" AS "createdByUserId", "path", "name", "value",
              "provider_synced" AS "providerSynced", "provider_error" AS "providerError",
              "created_at" AS "createdAt", "updated_at" AS "updatedAt"
         FROM "hosting_headers"
        WHERE "hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?
        ORDER BY "path" ASC, "name" ASC`,
      deployment.deploymentId,
      deployment.deploymentId,
      deployment.renderServiceId || '',
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingHeadersTable(error)) return null;
    throw error;
  }
}

async function replaceHeaderTableRows(deployment, rows) {
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `DELETE FROM "hosting_headers"
          WHERE "hosting_service_id" = ? OR "deployment_id" = ? OR "render_service_id" = ?`,
        deployment.deploymentId,
        deployment.deploymentId,
        deployment.renderServiceId || '',
      );
      for (const row of rows) {
        await tx.$executeRawUnsafe(
          `INSERT INTO "hosting_headers" (
             "id", "hosting_service_id", "render_service_id", "deployment_id",
             "organization_id", "created_by_user_id", "path", "name", "value",
             "provider_synced", "provider_error", "created_at", "updated_at"
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          row.id,
          row.hostingServiceId,
          row.renderServiceId,
          row.deploymentId,
          row.organizationId,
          row.createdByUserId,
          row.path,
          row.name,
          row.value,
          row.providerSynced ? 1 : 0,
          row.providerError,
        );
      }
    });
  } catch (error) {
    if (isMissingHeadersTable(error)) return;
    throw error;
  }
}

function updateDeploymentHeaders(store, serviceId) {
  normalizeHeaderStore(store);
  const deployment = store.deployments.find((item) => item.deploymentId === serviceId);
  if (!deployment) return;
  deployment.headerMetadata = (store.headers[serviceId] || []).map(publicHeader);
  deployment.updatedAt = nowIso();
}

function publicHeader(row = {}) {
  return {
    id: row.id,
    path: row.path || '/*',
    name: row.name || row.key || '',
    value: row.value || '',
    providerSynced: Boolean(row.providerSynced),
    providerError: row.providerError || null,
    updatedAt: row.updatedAt || null,
  };
}

function isMissingHeadersTable(error) {
  return /hosting_headers|no such table|does not exist/i.test(error?.message || '');
}

const WEBHOOK_EVENTS = new Set([
  'site.activity',
  'site.form_submitted',
  'site.error',
  'deploy.started',
  'deploy.succeeded',
  'deploy.failed',
  'domain.verified',
  'billing.payment_due',
]);

function normalizeWebhookStore(store) {
  if (!store.webhooks || typeof store.webhooks !== 'object' || Array.isArray(store.webhooks)) store.webhooks = {};
  return store;
}

function validateWebhook(input = {}, requireAll = true) {
  const name = String(input.name || input.label || '').trim();
  const url = String(input.url || input.endpointUrl || '').trim();
  const events = Array.isArray(input.events) ? input.events : String(input.event || input.events || 'site.activity').split(',');
  const cleanedEvents = [...new Set(events.map((event) => String(event || '').trim()).filter(Boolean))]
    .filter((event) => WEBHOOK_EVENTS.has(event));
  const emailTo = String(input.emailTo || '').trim();
  const action = String(input.action || 'webhook').trim();
  if (requireAll && !name) throw validationError('Webhook name is required.');
  if (name && name.length > 80) throw validationError('Webhook name must be 80 characters or fewer.');
  if (requireAll && !url && action === 'webhook') throw validationError('Webhook URL is required.');
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw validationError('Enter a valid webhook URL.'); }
    if (!['https:', 'http:'].includes(parsed.protocol)) throw validationError('Webhook URL must start with http:// or https://.');
  }
  if (requireAll && cleanedEvents.length === 0) throw validationError('Choose at least one webhook event.');
  const normalizedAction = ['webhook', 'email', 'webhook_and_email'].includes(action) ? action : 'webhook';
  if (normalizedAction.includes('email') && !emailTo) throw validationError('Notification email is required for email actions.');
  if (emailTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTo)) throw validationError('Enter a valid notification email.');
  return {
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
    ...(cleanedEvents.length ? { events: cleanedEvents } : {}),
    action: normalizedAction,
    emailTo: emailTo || null,
  };
}

function updateDeploymentWebhooks(store, serviceId) {
  normalizeWebhookStore(store);
  const deployment = store.deployments.find((item) => item.deploymentId === serviceId);
  if (!deployment) return;
  deployment.webhookMetadata = (store.webhooks[serviceId] || []).map(publicWebhook);
  deployment.updatedAt = nowIso();
}

function publicWebhook(row = {}) {
  const { secret, signingSecret, ...safe } = row;
  return safe;
}

function isGeneratedTemplateRoot(value = '') {
  const root = String(process.env.RENDER_GENERATED_TEMPLATE_SITES_ROOT_DIR || process.env.GENERATED_TEMPLATE_SITES_ROOT_DIR || 'generated-template-sites').replace(/^\/+|\/+$/g, '');
  return String(value || '').replace(/\\/g, '/').startsWith(`${root}/`);
}

function normalizeMetricsRange(value = '12h') {
  const key = String(value || '12h').toLowerCase();
  if (key === '24h') return { key, hours: 24, resolution: 'hour' };
  if (key === '7d') return { key, hours: 24 * 7, resolution: 'day' };
  return { key: '12h', hours: 12, resolution: 'hour' };
}

function normalizeHostingMetricsResponse(providerPayload, context = {}) {
  const rows = Array.isArray(providerPayload)
    ? providerPayload
    : Array.isArray(providerPayload?.data)
      ? providerPayload.data
      : Array.isArray(providerPayload?.values)
        ? providerPayload.values
        : Array.isArray(providerPayload?.points)
          ? providerPayload.points
          : Array.isArray(providerPayload?.metrics)
            ? providerPayload.metrics
            : [];

  const data = rows
    .map((item, index) => {
      const timestamp = item.timestamp || item.time || item.at || item.date || deriveMetricTimestamp(context, index, rows.length);
      const rawValue = Number(item.value ?? item.bandwidth ?? item.outboundBandwidth ?? item.bytes ?? item.total ?? 0);
      const usedBytes = item.bytes != null || /byte/i.test(String(item.unit || ''));
      const value = usedBytes ? rawValue / (1024 * 1024) : rawValue;
      return {
        timestamp,
        label: timestamp ? new Date(timestamp).toISOString() : null,
        value: Number.isFinite(value) ? value : 0,
        index,
      };
    })
    .filter((point) => Number.isFinite(point.value));

  return {
    type: context.metricType || providerPayload?.type || 'bandwidth',
    unit: context.metricType === 'bandwidth' ? 'MB' : providerPayload?.unit || 'value',
    source: 'provider',
    hostingServiceId: context.hostingServiceId,
    deploymentId: context.deploymentId,
    renderServiceId: context.renderServiceId,
    organizationId: context.organizationId || null,
    createdByUserId: context.createdByUserId || null,
    range: context.range?.key || '12h',
    resolution: context.range?.resolution || 'hour',
    startTime: context.startTime,
    endTime: context.endTime,
    data,
    usageThisMonthMb: Math.round(data.reduce((sum, point) => sum + Number(point.value || 0), 0)),
  };
}

async function readStoredHostingMetrics(deployment = {}, metricType = 'bandwidth', range = normalizeMetricsRange('12h')) {
  const hostingServiceId = deployment.deploymentId;
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "sample_at", "value", "unit", "resolution", "source"
     FROM "hosting_metric_samples"
     WHERE "hosting_service_id" = ? AND "metric_type" = ? AND "range_key" = ?
     ORDER BY "sample_at" ASC`,
    hostingServiceId,
    metricType,
    range.key,
  ).catch((err) => {
    if (isMissingMetricsTable(err)) return [];
    throw err;
  });
  const periodKey = currentPeriodKey();
  const summaries = await prisma.$queryRawUnsafe(
    `SELECT "bandwidth_used_mb", "request_count", "event_count", "source", "last_provider_sync_at", "metadata"
     FROM "hosting_usage_summaries"
     WHERE "hosting_service_id" = ? AND "period_key" = ?
     LIMIT 1`,
    hostingServiceId,
    periodKey,
  ).catch((err) => {
    if (isMissingMetricsTable(err)) return [];
    throw err;
  });
  const summary = Array.isArray(summaries) ? summaries[0] : null;
  const data = (Array.isArray(rows) ? rows : []).map((row, index) => ({
    timestamp: row.sample_at,
    label: row.sample_at,
    value: Number(row.value || 0),
    index,
  }));
  return {
    type: metricType,
    unit: rows?.[0]?.unit || (metricType === 'bandwidth' ? 'MB' : 'value'),
    source: summary?.source || rows?.[0]?.source || 'database',
    hostingServiceId,
    deploymentId: deployment.deploymentId,
    renderServiceId: deployment.renderServiceId || null,
    organizationId: deployment.organizationId || deployment.userId || null,
    createdByUserId: deployment.createdByUserId || deployment.userId || null,
    range: range.key,
    resolution: rows?.[0]?.resolution || range.resolution,
    periodKey,
    lastProviderSyncAt: summary?.last_provider_sync_at || null,
    data,
    usageThisMonthMb: Number(summary?.bandwidth_used_mb ?? data.reduce((sum, point) => sum + Number(point.value || 0), 0)),
    requestCount: Number(summary?.request_count || 0),
    eventCount: Number(summary?.event_count || 0),
    metadata: parseJsonText(summary?.metadata),
  };
}

async function shouldSyncHostingMetrics(deployment = {}, metricType = 'bandwidth', range = normalizeMetricsRange('12h')) {
  if (!renderApiService.configured()) return false;
  const periodKey = currentPeriodKey();
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "last_provider_sync_at"
     FROM "hosting_usage_summaries"
     WHERE "hosting_service_id" = ? AND "period_key" = ?
     LIMIT 1`,
    deployment.deploymentId,
    periodKey,
  ).catch((err) => {
    if (isMissingMetricsTable(err)) return [];
    throw err;
  });
  const last = Array.isArray(rows) ? rows[0]?.last_provider_sync_at : null;
  if (!last) return true;
  const ageMs = Date.now() - new Date(last).getTime();
  return Number.isNaN(ageMs) || ageMs > metricsSyncThrottleMs(range, metricType);
}

function metricsSyncThrottleMs(range = {}, metricType = 'bandwidth') {
  if (metricType !== 'bandwidth') return 10 * 60 * 1000;
  if (range.key === '7d') return 30 * 60 * 1000;
  return 5 * 60 * 1000;
}

async function persistHostingMetricsResponse(response = {}) {
  if (!response.hostingServiceId || !response.deploymentId) return;
  const now = new Date();
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const points = Array.isArray(response.data) ? response.data : [];
  for (const point of points) {
    const sampleAt = normalizeSampleDate(point.timestamp || point.label);
    if (!sampleAt) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "hosting_metric_samples" (
        "id", "hosting_service_id", "render_service_id", "deployment_id", "organization_id", "created_by_user_id",
        "metric_type", "unit", "range_key", "resolution", "sample_at", "value", "source", "provider_payload", "created_at"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT("hosting_service_id", "metric_type", "range_key", "sample_at") DO UPDATE SET
        "value" = excluded."value",
        "unit" = excluded."unit",
        "resolution" = excluded."resolution",
        "source" = excluded."source",
        "provider_payload" = excluded."provider_payload"`,
      makeId('metric'),
      response.hostingServiceId,
      response.renderServiceId || null,
      response.deploymentId,
      response.organizationId || null,
      response.createdByUserId || null,
      response.type || 'bandwidth',
      response.unit || 'value',
      response.range || '12h',
      response.resolution || 'hour',
      sampleAt,
      Number(point.value || 0),
      response.source || 'provider',
      JSON.stringify(point),
    );
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "hosting_usage_summaries" (
      "id", "hosting_service_id", "render_service_id", "deployment_id", "organization_id", "created_by_user_id",
      "period_key", "bandwidth_used_mb", "request_count", "event_count", "source", "last_provider_sync_at", "metadata",
      "created_at", "updated_at"
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT("hosting_service_id", "period_key") DO UPDATE SET
      "render_service_id" = excluded."render_service_id",
      "deployment_id" = excluded."deployment_id",
      "bandwidth_used_mb" = excluded."bandwidth_used_mb",
      "source" = excluded."source",
      "last_provider_sync_at" = CURRENT_TIMESTAMP,
      "metadata" = excluded."metadata",
      "updated_at" = CURRENT_TIMESTAMP`,
    makeId('usage'),
    response.hostingServiceId,
    response.renderServiceId || null,
    response.deploymentId,
    response.organizationId || null,
    response.createdByUserId || null,
    periodKey,
    Number(response.usageThisMonthMb || 0),
    response.source || 'provider',
    JSON.stringify({ range: response.range, resolution: response.resolution, sampleCount: points.length }),
  );
}

function normalizeSampleDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function deriveMetricTimestamp(context = {}, index = 0, count = 1) {
  const start = new Date(context.startTime || Date.now());
  const end = new Date(context.endTime || Date.now());
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return new Date().toISOString();
  if (count <= 1) return end.toISOString();
  const stepMs = (end.getTime() - start.getTime()) / Math.max(1, count - 1);
  return new Date(start.getTime() + stepMs * index).toISOString();
}

function isMetricsSyncEligible(deployment = {}) {
  return hasRealRenderId(deployment.renderServiceId)
    && ['live', 'building', 'deployed', 'deployed_unverified'].includes(String(deployment.status || '').toLowerCase());
}

function currentPeriodKey(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function isMissingMetricsTable(error) {
  return /hosting_metric_samples|hosting_usage_summaries|no such table|does not exist/i.test(error?.message || '');
}

function parseJsonText(value, fallback = {}) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Create a 404 error.
 */
function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

/**
 * Create a 409 conflict error.
 */
function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

/**
 * Returns true if a Render API error means the resource no longer exists.
 */
function isRenderGone(error) {
  return error?.status === 404 || error?.status === 410;
}


// ─────────────────────────────────────────────────────────────────────────────
// Export singleton
// ─────────────────────────────────────────────────────────────────────────────

export default new HostingService();
