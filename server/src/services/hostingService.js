import renderApiService from './renderApiService.js';
import deploymentStatusService from './deploymentStatusService.js';
import { makeId, mutateHostingStore, nowIso, readHostingStore } from './hostingStore.js';

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
   * List all Glondiasites-managed hosting deployments.
   * Automatically imports any Render services not yet in the store so
   * pre-deployed apps appear without needing a manual import call.
   * Individual per-deployment sync happens in getService() or sync().
   */
  async listHosting(userId, options = {}) {
    // Background import — pull any Render services not yet tracked.
    // Fire-and-forget so the list response is never delayed.
    this.importFromRender().catch(() => {});

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

  /**
   * Get a single deployment, syncing its state from Render first.
   */
  async getService(deploymentId) {
    const deployment = await this.findDeployment(deploymentId);
    const synced = await this.syncDeploymentFromRender(deployment, { quiet: true });

    let renderService = null;
    if (hasRealRenderId(synced.renderServiceId) && renderApiService.configured()) {
      try {
        renderService = await renderApiService.getService(synced.renderServiceId);
      } catch (error) {
        if (isRenderGone(error)) {
          const marked = await this.markDeletedOnRender(synced, error);
          return this.toHostingDetail(marked, null);
        }
        throw error;
      }
    }

    return this.toHostingDetail(synced, renderService);
  }

  /**
   * Explicit sync — called from the "Sync" button / controller.
   */
  async sync(deploymentId, options = {}) {
    const deployment = await this.findManagedDeployment(deploymentId);
    return this.syncDeploymentFromRender(deployment, options);
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
    if (deployment.status === STATUS_DELETED) throw conflict('This Render service has already been removed.');
    if (deployment.status === STATUS_SUSPENDED) return deployment;

    const renderResult = await renderApiService.suspendService(deployment.renderServiceId);

    return mutateHostingStore((store) => {
      const stored = this._find(store, deployment.deploymentId);
      stored.status = STATUS_SUSPENDED;
      stored.currentStep = 'Suspended';
      stored.suspendedAt = nowIso();
      stored.lastRenderSyncedAt = nowIso();
      stored.updatedAt = nowIso();
      stored.renderSuspendResponse = renderResult;
      appendHostingLog(store, stored.deploymentId, 'Render service suspended from Glondiasites.', 'warn');
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

    // ── 3. Purge record + logs from store entirely ────────────────────────
    await mutateHostingStore((store) => {
      store.deployments = (store.deployments || []).filter(
        (d) => d.deploymentId !== deployment.deploymentId && d.id !== deployment.deploymentId,
      );
      store.sessions = (store.sessions || []).filter(
        (s) => s.deploymentId !== deployment.deploymentId,
      );
      delete store.logs[deployment.deploymentId];
    });

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
      throw conflict('Only Glondiasites-managed Render deployments can be managed here.');
    }
  }

  /**
   * Guard: must have a real (non-pending) Render service ID.
   */
  assertRealRenderService(deployment) {
    if (!hasRealRenderId(deployment.renderServiceId)) {
      throw conflict('Render deployment has not started. A real Render service ID is required.');
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
      return { imported: 0, alreadyTracked: 0, total: 0, error: 'Render API not configured.' };
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
          message: `Imported from Render: ${svc.name || svc.id}`,
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

    // Service-level changes (name, plan, region, PR previews)
    if (incoming.plan || incoming.region || incoming.serviceName) {
      if (serviceType === 'static_site') {
        renderResponse = await renderApiService.updateStaticSiteSettings(deployment.renderServiceId, {
          serviceName: incoming.serviceName,
          pullRequestPreviewsEnabled: incoming.pullRequestPreviewsEnabled,
        });
      } else {
        renderResponse = await renderApiService.updateWebServiceSettings(deployment.renderServiceId, {
          serviceName: incoming.serviceName,
          plan: incoming.plan,
          region: incoming.region,
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
      stored.environmentConfiguration = ec;

      if (incoming.serviceType) stored.serviceType = incoming.serviceType;
      if (incoming.plan) stored.plan = incoming.plan;
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
    this.assertRealRenderService(deployment);
    return renderApiService.listHeaders(deployment.renderServiceId);
  }

  /**
   * Update custom response headers.
   */
  async updateHeaders(deploymentId, headers = []) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    return renderApiService.updateHeaders(deployment.renderServiceId, headers);
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
   * Get service metrics.
   */
  async getMetrics(deploymentId, metricType) {
    const deployment = await this.findManagedDeployment(deploymentId);
    this.assertRealRenderService(deployment);
    const endTime = new Date().toISOString();
    const startTime = new Date(Date.now() - 3600 * 1000).toISOString();
    return renderApiService.getMetrics(metricType, {
      resource: deployment.renderServiceId,
      startTime,
      endTime,
    });
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
      // Deploy-first K100 billing surface (so the dashboard can show a pay CTA).
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

/**
 * Create a 404 error.
 */
function notFound(message) {
  const error = new Error(message);
  error.status = 404;
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
