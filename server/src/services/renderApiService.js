import { normalizeRenderPlan, renderPlanMap } from '../config/hostingLifecycle.js';

const RENDER_BASE_URL = process.env.RENDER_API_BASE_URL || 'https://api.render.com/v1';

/**
 * Resolve the Render plan for a NEW service payload from a trusted intent field,
 * never from raw user/frontend `input.plan`. Initial deploys always launch free;
 * paid plans are applied later via updateWebServiceSettings after verified payment.
 *
 *   trial_free     → free      (normal ZIP/GitHub deploy)
 *   paid_default   → configured paid Render plan
 *   admin_override → normalized input.plan (admin/staff only), defaulting free
 *   (anything else / missing) → free
 */
function resolveRenderPlanForPayload(input = {}) {
  if (input.renderPlanIntent === 'trial_free') return renderPlanMap.trial;
  if (input.renderPlanIntent === 'paid_default' || input.renderPlanIntent === 'standard_paid') return renderPlanMap.paidDefault;
  if (input.renderPlanIntent === 'admin_override') return normalizeRenderPlan(input.plan, 'free');
  return 'free';
}

class RenderApiService {
  configured() {
    if (String(process.env.RENDER_API_DISABLED || '').toLowerCase() === 'true') return false;
    return Boolean(process.env.RENDER_API_KEY && process.env.RENDER_OWNER_ID);
  }

  settings() {
    return {
      provider: 'render',
      configured: this.configured(),
      ownerIdPresent: Boolean(process.env.RENDER_OWNER_ID),
      required: ['RENDER_API_KEY', 'RENDER_OWNER_ID'].filter((key) => !process.env[key]),
    };
  }

  // ── Core CRUD ────────────────────────────────────────────────────────────────

  async createService(input = {}) {
    this.assertConfigured('create_service');
    const body = this.buildServicePayload(input);
    try {
      return await this.request('/services', { method: 'POST', body });
    } catch (error) {
      // Attach a secret-free payload summary so a Render 400 is actually
      // diagnosable (type/repo/rootDir/build/publish/start) without leaking env.
      error.payloadSummary = summarizeServicePayload(body);
      throw error;
    }
  }

  async getService(serviceId) {
    this.assertConfigured('get_service');
    return this.request(`/services/${encodeURIComponent(serviceId)}`);
  }

  async updateService(serviceId, settings = {}) {
    this.assertConfigured('update_service');
    return this.request(`/services/${encodeURIComponent(serviceId)}`, { method: 'PATCH', body: settings });
  }

  async suspendService(serviceId) {
    this.assertConfigured('suspend_service');
    return this.request(`/services/${encodeURIComponent(serviceId)}/suspend`, { method: 'POST', body: {} });
  }

  async resumeService(serviceId) {
    this.assertConfigured('resume_service');
    return this.request(`/services/${encodeURIComponent(serviceId)}/resume`, { method: 'POST', body: {} });
  }

  async restartService(serviceId) {
    this.assertConfigured('restart_service');
    return this.request(`/services/${encodeURIComponent(serviceId)}/restart`, { method: 'POST', body: {} });
  }

  async purgeCache(serviceId) {
    this.assertConfigured('purge_cache');
    return this.request(`/services/${encodeURIComponent(serviceId)}/cache/purge`, { method: 'POST', body: {} });
  }

  async listServiceEvents(serviceId) {
    this.assertConfigured('list_service_events');
    return this.request(`/services/${encodeURIComponent(serviceId)}/events?limit=50`);
  }

  async listSecretFiles(serviceId) {
    this.assertConfigured('list_secret_files');
    return this.request(`/services/${encodeURIComponent(serviceId)}/secret-files`);
  }

  async upsertSecretFiles(serviceId, files = []) {
    this.assertConfigured('upsert_secret_files');
    return this.request(`/services/${encodeURIComponent(serviceId)}/secret-files`, { method: 'PUT', body: files });
  }

  async listHeaders(serviceId) {
    this.assertConfigured('list_headers');
    return this.request(`/services/${encodeURIComponent(serviceId)}/headers`);
  }

  async updateHeaders(serviceId, headers = []) {
    this.assertConfigured('update_headers');
    return this.request(`/services/${encodeURIComponent(serviceId)}/headers`, { method: 'PUT', body: headers });
  }

  async listRoutes(serviceId) {
    this.assertConfigured('list_routes');
    return this.request(`/services/${encodeURIComponent(serviceId)}/routes`);
  }

  async updateRoutes(serviceId, routes = []) {
    this.assertConfigured('update_routes');
    return this.request(`/services/${encodeURIComponent(serviceId)}/routes`, { method: 'PUT', body: routes });
  }

  async getMetrics(metricType, params = {}) {
    this.assertConfigured('get_metrics');
    const qs = new URLSearchParams(params).toString();
    return this.request(`/metrics/${encodeURIComponent(metricType)}${qs ? `?${qs}` : ''}`);
  }

  async deleteService(serviceId) {
    this.assertConfigured('delete_service');
    return this.request(`/services/${encodeURIComponent(serviceId)}`, { method: 'DELETE' });
  }

  // ── Deploys ──────────────────────────────────────────────────────────────────

  async triggerDeploy(serviceId, input = {}) {
    this.assertConfigured('trigger_deploy');
    return this.request(`/services/${encodeURIComponent(serviceId)}/deploys`, {
      method: 'POST',
      body: {
        // Render Public API deploy body: clearCache, commitId, imageUrl, deployMode.
        clearCache: normalizeClearCache(input.clearCache),
        deployMode: input.deployMode || 'build_and_deploy',
        ...(input.commitId ? { commitId: input.commitId } : {}),
      },
    });
  }

  async getDeploy(serviceId, deployId) {
    this.assertConfigured('get_deploy');
    return this.request(`/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`);
  }

  async listDeploys(serviceId, limit = 20) {
    this.assertConfigured('list_deploys');
    return this.request(`/services/${encodeURIComponent(serviceId)}/deploys?limit=${encodeURIComponent(limit)}`);
  }

  async cancelDeploy(serviceId, deployId) {
    this.assertConfigured('cancel_deploy');
    return this.request(
      `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}/cancel`,
      { method: 'POST', body: {} }
    );
  }

  async rollbackDeploy(serviceId, deployId) {
    this.assertConfigured('rollback_deploy');
    return this.request(`/services/${encodeURIComponent(serviceId)}/rollback`, { method: 'POST', body: { deployId } });
  }

  async getDeployLogs(serviceId, deployId, cursor = null) {
    this.assertConfigured('get_deploy_logs');
    const params = new URLSearchParams({ limit: '200' });
    if (cursor) params.set('cursor', cursor);
    return this.request(
      `/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}/logs?${params}`
    );
  }

  // ── Env Vars ─────────────────────────────────────────────────────────────────

  async listEnvVars(serviceId) {
    this.assertConfigured('list_env_vars');
    return this.request(`/services/${encodeURIComponent(serviceId)}/env-vars?limit=100`);
  }

  async upsertEnvVars(serviceId, envVars = []) {
    this.assertConfigured('upsert_env_vars');
    const results = [];
    for (const envVar of envVars) {
      results.push(await this.request(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(envVar.key)}`, {
        method: 'PUT',
        body: { value: envVar.value },
      }));
    }
    return { envVars: results };
  }

  async deleteEnvVar(serviceId, key) {
    this.assertConfigured('delete_env_var');
    return this.request(`/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, { method: 'DELETE' });
  }

  // ── Disks ────────────────────────────────────────────────────────────────────

  // Render Public API: disks are a top-level resource, NOT nested under a
  // service. Create is POST /disks with serviceId in the body; update/delete
  // target /disks/{diskId}. (There is no /services/{id}/disks path.)
  async createDisk(serviceId, disk = {}) {
    this.assertConfigured('create_disk');
    return this.request('/disks', {
      method: 'POST',
      body: {
        serviceId,
        name: disk.name,
        mountPath: disk.mountPath,
        sizeGB: Number(disk.sizeGB || disk.size || 1),
      },
    });
  }

  async updateDisk(serviceId, diskId, disk = {}) {
    this.assertConfigured('update_disk');
    // Only name, mountPath, sizeGB are accepted on update.
    return this.request(`/disks/${encodeURIComponent(diskId)}`, {
      method: 'PATCH',
      body: cleanObject({
        name: disk.name,
        mountPath: disk.mountPath,
        sizeGB: disk.sizeGB !== undefined || disk.size !== undefined ? Number(disk.sizeGB || disk.size) : undefined,
      }),
    });
  }

  async deleteDisk(serviceId, diskId) {
    this.assertConfigured('delete_disk');
    return this.request(`/disks/${encodeURIComponent(diskId)}`, { method: 'DELETE' });
  }

  // ── Custom Domains ───────────────────────────────────────────────────────────

  async addCustomDomain(serviceId, domainName) {
    this.assertConfigured('add_custom_domain');
    return this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains`, {
      method: 'POST',
      body: { name: domainName },
    });
  }

  async listCustomDomains(serviceId) {
    this.assertConfigured('list_custom_domains');
    return this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains?limit=100`);
  }

  async getCustomDomain(serviceId, domainId) {
    this.assertConfigured('get_custom_domain');
    return this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(domainId)}`);
  }

  async deleteCustomDomain(serviceId, domainId) {
    this.assertConfigured('delete_custom_domain');
    return this.request(`/services/${encodeURIComponent(serviceId)}/custom-domains/${encodeURIComponent(domainId)}`, { method: 'DELETE' });
  }

  // ── Typed Service Creation ───────────────────────────────────────────────────

  /**
   * Create a Render static site with proper defaults and validation.
   */
  async createStaticSite(input = {}) {
    this.assertConfigured('create_static_site');

    this.validateDeployPayload({
      ...input,
      serviceType: 'static_site',
    });

    return this.createService({
      ...input,
      serviceType: 'static_site',
      buildCommand: input.buildCommand || 'npm run build',
      outputDirectory: input.outputDirectory || input.publishDirectory || 'dist',
    });
  }

  /**
   * Create a Render web service with proper runtime/start command defaults.
   */
  async createWebService(input = {}) {
    this.assertConfigured('create_web_service');

    this.validateDeployPayload({
      ...input,
      serviceType: 'web_service',
    });

    return this.createService({
      ...input,
      serviceType: 'web_service',
      runtime: input.runtime || input.env || 'node',
      buildCommand: input.buildCommand || 'npm install && npm run build',
      startCommand: input.startCommand || 'npm start',
    });
  }

  // ── Validation & Schema ─────────────────────────────────────────────────────

  /**
   * Validate deploy configuration before sending to Render.
   * Catches missing or dangerous settings early.
   */
  validateDeployPayload(input = {}) {
    const serviceType = input.serviceType || inferServiceType(input);
    const schema = this.getDeployConfigSchema(serviceType);
    const errors = [];

    const sourceRepository =
      input.sourceRepository ||
      input.repoUrl ||
      input.repositoryUrl ||
      input.repo ||
      '';

    const serviceName = input.serviceName || input.name || input.slug || '';

    if (!serviceName) errors.push({ field: 'serviceName', message: 'Service name is required.' });
    if (!sourceRepository) errors.push({ field: 'sourceRepository', message: 'Source repository is required.' });

    if (!input.branch && !input.productionBranch) {
      errors.push({ field: 'branch', message: 'Branch is required.' });
    }

    if (String(input.rootDirectory || '').includes('/opt/render/project')) {
      errors.push({
        field: 'rootDirectory',
        message: 'Root directory must be a repository path, not a local Render filesystem path.',
      });
    }

    if (serviceType === 'static_site') {
      if (!input.buildCommand) {
        errors.push({ field: 'buildCommand', message: 'Static site build command is required.' });
      }

      if (!(input.publishDirectory || input.outputDirectory)) {
        errors.push({ field: 'publishDirectory', message: 'Static site publish directory is required.' });
      }
    }

    if (serviceType === 'web_service') {
      if (!input.buildCommand) {
        errors.push({ field: 'buildCommand', message: 'Web service build command is required.' });
      }

      if (!input.startCommand) {
        errors.push({ field: 'startCommand', message: 'Web service start command is required.' });
      }
    }

    if (errors.length) {
      const error = new Error('Render deploy configuration is incomplete.');
      error.status = 400;
      error.code = 'RENDER_DEPLOY_CONFIG_INVALID';
      error.details = { errors, schema };
      error.expose = true;
      throw error;
    }

    return {
      valid: true,
      serviceType,
      schema,
      sourceRepository,
      serviceName,
    };
  }

  /**
   * Structured schema for deploy configuration fields per service type.
   * Used by frontend to render the correct form and by backend for validation.
   */
  getDeployConfigSchema(serviceType = 'static_site') {
    const type = String(serviceType || 'static_site');

    const common = {
      serviceName: { required: true, label: 'Service name' },
      sourceRepository: { required: true, label: 'Source repository' },
      branch: { required: true, defaultValue: 'main', label: 'Branch' },
      rootDirectory: { required: false, label: 'Root directory' },
      plan: { required: false, defaultValue: process.env.RENDER_INITIAL_PLAN || 'free', label: 'Plan' },
      region: { required: false, defaultValue: 'oregon', label: 'Region' },
    };

    if (type === 'web_service') {
      return {
        serviceType: 'web_service',
        required: ['serviceName', 'sourceRepository', 'branch', 'buildCommand', 'startCommand', 'runtime'],
        fields: {
          ...common,
          runtime: { required: true, defaultValue: 'node', label: 'Runtime' },
          buildCommand: { required: true, defaultValue: 'npm install && npm run build', label: 'Build command' },
          startCommand: { required: true, defaultValue: 'npm start', label: 'Start command' },
          healthCheckPath: { required: false, defaultValue: '/', label: 'Health check path' },
        },
      };
    }

    if (type === 'docker') {
      return {
        serviceType: 'docker',
        required: ['serviceName', 'sourceRepository', 'branch'],
        fields: {
          ...common,
          dockerfilePath: { required: false, defaultValue: './Dockerfile', label: 'Dockerfile path' },
          dockerContext: { required: false, defaultValue: '.', label: 'Docker context' },
        },
        advanced: true,
      };
    }

    return {
      serviceType: 'static_site',
      required: ['serviceName', 'sourceRepository', 'branch', 'buildCommand', 'publishDirectory'],
      fields: {
        ...common,
        buildCommand: { required: true, defaultValue: 'npm run build', label: 'Build command' },
        publishDirectory: { required: true, defaultValue: 'dist', label: 'Publish directory' },
        pullRequestPreviewsEnabled: { required: false, defaultValue: 'no', label: 'Pull request previews' },
      },
    };
  }

  // ── High-Level Settings Updates ──────────────────────────────────────────────

  /**
   * Update static site settings (build command, publish path, PR previews, etc.)
   */
  async updateStaticSiteSettings(serviceId, input = {}) {
    this.assertConfigured('update_static_site_settings');
    const payload = buildStaticSiteUpdatePayload(input);
    return this.updateService(serviceId, payload);
  }

  /**
   * Update web service settings (build/start commands, runtime, plan, region, etc.)
   */
  async updateWebServiceSettings(serviceId, input = {}) {
    this.assertConfigured('update_web_service_settings');
    const payload = buildWebServiceUpdatePayload(input);
    return this.updateService(serviceId, payload);
  }

  /**
   * Update source settings (repo URL, branch, root directory).
   */
  async updateSourceSettings(serviceId, input = {}) {
    this.assertConfigured('update_source_settings');
    const payload = buildSourceUpdatePayload(input);
    return this.updateService(serviceId, payload);
  }

  /**
   * Update build settings — auto-routes to static or web service update
   * based on serviceType or framework inference.
   */
  async updateBuildSettings(serviceId, input = {}) {
    this.assertConfigured('update_build_settings');
    const serviceType = input.serviceType || inferServiceType(input);

    if (serviceType === 'static_site') {
      return this.updateStaticSiteSettings(serviceId, {
        buildCommand: input.buildCommand,
        publishDirectory: input.publishDirectory || input.outputDirectory,
      });
    }

    return this.updateWebServiceSettings(serviceId, {
      buildCommand: input.buildCommand,
      startCommand: input.startCommand,
      runtime: input.runtime || input.env,
    });
  }

  /**
   * Save settings then trigger a fresh deploy in one call.
   * Supports "Save & Redeploy" button workflow.
   */
  async redeployWithSettings(serviceId, input = {}) {
    this.assertConfigured('redeploy_with_settings');
    const serviceType = input.serviceType || inferServiceType(input);

    if (serviceType === 'static_site') {
      await this.updateStaticSiteSettings(serviceId, input);
    } else {
      await this.updateWebServiceSettings(serviceId, input);
    }

    return this.triggerDeploy(serviceId, {
      clearCache: normalizeClearCache(input.clearCache),
      deployMode: input.deployMode || 'build_and_deploy',
      ...(input.commitId ? { commitId: input.commitId } : {}),
    });
  }

  /**
   * Full Render snapshot for sync — service details, latest deploy,
   * env vars metadata, and custom domains in a single call.
   * Backend-only: controllers must strip secret env var values before
   * sending to the browser.
   */
  async getServiceSnapshot(serviceId) {
    this.assertConfigured('get_service_snapshot');

    const [service, deploys, envVars, domains] = await Promise.all([
      this.getService(serviceId),
      this.listDeploys(serviceId, 1).catch((error) => ({ error: error.message || 'Could not list deploys.' })),
      this.listEnvVars(serviceId).catch((error) => ({ error: error.message || 'Could not list env vars.' })),
      this.listCustomDomains(serviceId).catch((error) => ({ error: error.message || 'Could not list custom domains.' })),
    ]);

    return {
      service,
      latestDeploy: extractFirstDeploy(deploys),
      envVars,
      domains,
      syncedAt: new Date().toISOString(),
    };
  }

  /**
   * Safe, layered diagnostics for a deploy that failed or errored. The deploy
   * logs endpoint (/deploys/:id/logs) can 404 or be unavailable, so fall back
   * to service events, then a service snapshot. Never throws — returns a
   * normalized object describing which sources were available.
   */
  async getDeployDiagnostics(serviceId, deployId) {
    const result = {
      logsAvailable: false,
      eventsAvailable: false,
      serviceAvailable: false,
      messages: [],
      raw: {},
    };
    if (!serviceId || !this.configured()) return result;

    // 1. Deploy logs (best detail, least reliable).
    if (deployId) {
      try {
        const logs = await this.getDeployLogs(serviceId, deployId);
        result.logsAvailable = true;
        result.raw.logs = logs;
        for (const msg of extractLogMessages(logs)) result.messages.push(msg);
      } catch (error) {
        result.raw.logsError = { status: error.status, message: error.message };
      }
    }

    // 2. Service events.
    try {
      const events = await this.listServiceEvents(serviceId);
      result.eventsAvailable = true;
      result.raw.events = events;
      for (const msg of extractEventMessages(events)) result.messages.push(msg);
    } catch (error) {
      result.raw.eventsError = { status: error.status, message: error.message };
    }

    // 3. Service snapshot (last resort — at least surfaces current state).
    if (!result.logsAvailable && !result.eventsAvailable) {
      try {
        const snapshot = await this.getServiceSnapshot(serviceId);
        result.serviceAvailable = true;
        result.raw.snapshot = snapshot;
        const status = snapshot?.service?.service?.suspended || snapshot?.service?.suspended;
        if (status) result.messages.push(`Service state: ${status}`);
        if (snapshot?.latestDeploy?.status) result.messages.push(`Latest deploy status: ${snapshot.latestDeploy.status}`);
      } catch (error) {
        result.raw.snapshotError = { status: error.status, message: error.message };
      }
    }

    if (!result.messages.length) {
      result.messages.push('No Render diagnostics available (deploy logs, events, and snapshot all unavailable).');
    }
    return result;
  }

  // ── HTTP Transport ───────────────────────────────────────────────────────────

  async request(path, options = {}) {
    const method = options.method || 'GET';
    const response = await fetch(`${RENDER_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    const text = await response.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) {
      const errorMessage =
        body?.message ||
        body?.error ||
        body?.errors?.[0]?.message ||
        `Render API returned ${response.status}.`;
      const error = new Error(errorMessage);
      error.status = response.status === 401 ? 401 : response.status >= 500 ? 502 : response.status;
      error.details = body;
      error.expose = true;
      error.renderPath = path;
      error.renderMethod = method;
      throw error;
    }
    return body;
  }

  // ── Payload Builder ──────────────────────────────────────────────────────────

  buildServicePayload(input = {}) {
    const serviceType = input.serviceType || inferServiceType(input);
    const runtime = input.runtime || input.env || 'node';
    const buildCommand = input.buildCommand || (serviceType === 'static_site' ? 'npm run build' : 'npm install && npm run build');

    const details = serviceType === 'static_site'
      ? {
          buildCommand,
          publishPath: input.outputDirectory || input.publishDirectory || 'dist',
          pullRequestPreviewsEnabled: input.pullRequestPreviewsEnabled || 'no',
        }
      : serviceType === 'docker'
        ? {
            plan: input.plan || 'starter',
            region: input.region || 'oregon',
          }
        : {
            // Render Public API: web service detail field is `runtime` (enum:
            // node|python|ruby|go|rust|elixir|docker|image). There is no `env`
            // field; `runtime` is required, so sending `env` drops it entirely.
            runtime,
            // Launch-first rule: the plan comes from a TRUSTED renderPlanIntent,
            // never raw input.plan, so a user/frontend deploy can't create a paid
            // service. Paid plans are applied only after payment is verified
            // (deploymentBillingService.upgradeRenderPlanAfterPayment).
            plan: resolveRenderPlanForPayload(input),
            region: input.region || 'oregon',
            envSpecificDetails: {
              buildCommand,
              startCommand: input.startCommand || 'npm start',
            },
            ...(input.healthCheckPath ? { healthCheckPath: input.healthCheckPath } : {}),
            ...(input.disk ? { disk: { name: input.disk.name || 'data', mountPath: input.disk.mountPath, sizeGB: Number(input.disk.sizeGB || 1) } } : {}),
          };

    const repo = input.repoUrl || input.repositoryUrl || input.sourceReference;
    const name = renderSafeName(input.serviceName || input.name || input.slug || 'glondia-site');

    if (!repo) {
      const err = new Error('Cannot create Render service without a source repository URL.');
      err.status = 400; err.code = 'RENDER_MISSING_REPO'; err.expose = true;
      throw err;
    }
    if (name === 'glondia-site' && !input.serviceName) {
      console.warn('[render-api] Service name is generic — consider providing a specific serviceName.');
    }

    // Always include GLONDIA_SITE_SLUG (and the matching GLONDIA_SITE_ROOT_DIR
    // base) so the root dispatcher can find the correct subdirectory even if
    // rootDir is not honoured. The root base must match the generated-sites
    // root the publisher used (e.g. generated-sites vs uploaded-sites).
    const siteSlugVar = input.siteSlug
      ? [{ key: 'GLONDIA_SITE_SLUG', value: input.siteSlug }]
      : [];
    const siteRootVar = input.siteSlug && input.siteRootDir
      ? [{ key: 'GLONDIA_SITE_ROOT_DIR', value: input.siteRootDir }]
      : [];
    const envVars = [...siteSlugVar, ...siteRootVar, ...(input.envVars || [])];

    return cleanObject({
      type: serviceType,
      name,
      ownerId: input.ownerId || process.env.RENDER_OWNER_ID,
      repo,
      branch: input.branch || input.productionBranch || 'main',
      rootDir: input.rootDirectory || undefined,
      // Always disable auto-deploy — the pipeline triggers manually after all
      // files are committed to GitHub. Without this Render fires on every
      // individual file commit and runs the build before the script is there.
      autoDeploy: 'no',
      serviceDetails: details,
      envVars: envVars.length ? envVars : undefined,
    });
  }

  // ── Auth Guard ───────────────────────────────────────────────────────────────

  assertConfigured(action = 'render_api') {
    if (this.configured()) return;
    const error = new Error(this.configurationRequired(action).message);
    error.status = 503;
    error.code = 'RENDER_CONFIGURATION_REQUIRED';
    error.expose = true;
    error.details = this.settings();
    throw error;
  }

  configurationRequired(action) {
    return {
      status: 'configuration_required',
      action,
      provider: 'render',
      settings: this.settings(),
      message: 'Hosting API credentials are not configured. Add RENDER_API_KEY and RENDER_OWNER_ID to enable live hosting changes.',
    };
  }
}

// ── Helpers: Service Type Inference ──────────────────────────────────────────

function inferServiceType(input = {}) {
  if (input.startCommand) return 'web_service';
  const fw = String(input.framework || '').toLowerCase();
  const serverFrameworks = ['express', 'node', 'node.js server', 'fastify', 'koa', 'hapi', 'nestjs', 'next.js', 'remix', 'sveltekit'];
  if (serverFrameworks.some(s => fw.includes(s))) return 'web_service';
  return 'static_site';
}

function renderSafeName(value) {
  return String(value || 'glondia-site').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'glondia-site';
}

/** Secret-free summary of a Render service payload for error diagnostics. */
function summarizeServicePayload(body = {}) {
  const sd = body.serviceDetails || {};
  const esd = sd.envSpecificDetails || {};
  return {
    type: body.type,
    name: body.name,
    repo: body.repo,
    branch: body.branch,
    rootDir: body.rootDir || null,
    autoDeploy: body.autoDeploy,
    buildCommand: sd.buildCommand || esd.buildCommand || null,
    publishPath: sd.publishPath || null,
    startCommand: esd.startCommand || null,
    runtime: sd.runtime || null,
    plan: sd.plan || null,
    region: sd.region || null,
    // Only the env var KEYS — never values.
    envVarKeys: Array.isArray(body.envVars) ? body.envVars.map((e) => e.key) : [],
  };
}

// ── Helpers: Settings Update Payloads ───────────────────────────────────────

function buildStaticSiteUpdatePayload(input = {}) {
  return cleanObject({
    ...(input.name || input.serviceName
      ? { name: renderSafeName(input.name || input.serviceName) }
      : {}),

    ...(input.autoDeploy !== undefined
      ? { autoDeploy: normalizeAutoDeploy(input.autoDeploy) }
      : {}),

    ...(input.branch
      ? { branch: input.branch }
      : {}),

    ...(input.rootDirectory !== undefined
      ? { rootDir: input.rootDirectory || undefined }
      : {}),

    serviceDetails: {
      ...(input.buildCommand !== undefined
        ? { buildCommand: input.buildCommand }
        : {}),

      ...(input.publishDirectory !== undefined || input.outputDirectory !== undefined
        ? { publishPath: input.publishDirectory || input.outputDirectory }
        : {}),

      ...(input.pullRequestPreviewsEnabled !== undefined
        ? { pullRequestPreviewsEnabled: input.pullRequestPreviewsEnabled }
        : {}),
    },
  });
}

function buildWebServiceUpdatePayload(input = {}) {
  return cleanObject({
    ...(input.name || input.serviceName
      ? { name: renderSafeName(input.name || input.serviceName) }
      : {}),

    ...(input.autoDeploy !== undefined
      ? { autoDeploy: normalizeAutoDeploy(input.autoDeploy) }
      : {}),

    ...(input.branch
      ? { branch: input.branch }
      : {}),

    ...(input.rootDirectory !== undefined
      ? { rootDir: input.rootDirectory || undefined }
      : {}),

    serviceDetails: {
      ...(input.runtime || input.env
        ? { runtime: input.runtime || input.env }
        : {}),

      ...(input.plan
        ? { plan: input.plan }
        : {}),

      ...(input.region
        ? { region: input.region }
        : {}),

      ...(input.healthCheckPath !== undefined
        ? { healthCheckPath: input.healthCheckPath }
        : {}),

      envSpecificDetails: {
        ...(input.buildCommand !== undefined
          ? { buildCommand: input.buildCommand }
          : {}),

        ...(input.startCommand !== undefined
          ? { startCommand: input.startCommand }
          : {}),
      },
    },
  });
}

function buildSourceUpdatePayload(input = {}) {
  return cleanObject({
    ...(input.repoUrl || input.repositoryUrl || input.repo || input.sourceRepository
      ? { repo: input.repoUrl || input.repositoryUrl || input.repo || input.sourceRepository }
      : {}),

    ...(input.branch
      ? { branch: input.branch }
      : {}),

    ...(input.rootDirectory !== undefined
      ? { rootDir: input.rootDirectory || undefined }
      : {}),

    ...(input.autoDeploy !== undefined
      ? { autoDeploy: normalizeAutoDeploy(input.autoDeploy) }
      : {}),
  });
}

// ── Helpers: Utilities ──────────────────────────────────────────────────────

/**
 * Recursively strip empty strings, null values, and empty nested objects
 * so Render never receives blank or structurally empty payload fields.
 */
function cleanObject(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => cleanObject(item))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === 'object') {
    const output = {};

    for (const [key, child] of Object.entries(value)) {
      const cleaned = cleanObject(child);

      if (
        cleaned !== undefined &&
        cleaned !== null &&
        !(
          typeof cleaned === 'object' &&
          !Array.isArray(cleaned) &&
          Object.keys(cleaned).length === 0
        )
      ) {
        output[key] = cleaned;
      }
    }

    return output;
  }

  if (value === '') return undefined;
  return value;
}

function normalizeClearCache(value) {
  if (value === true) return 'clear';
  if (value === false || value === undefined || value === null) return 'do_not_clear';
  if (value === 'clear' || value === 'do_not_clear') return value;
  return 'do_not_clear';
}

function normalizeAutoDeploy(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['yes', 'true', 'on', 'enabled', 'enable'].includes(normalized)) return 'yes';
    if (['no', 'false', 'off', 'disabled', 'disable'].includes(normalized)) return 'no';
  }
  return value ? 'yes' : 'no';
}

function extractLogMessages(logs) {
  const rows = Array.isArray(logs) ? logs : logs?.logs || logs?.data || [];
  return rows
    .map((row) => row?.message || row?.log || (typeof row === 'string' ? row : null))
    .filter(Boolean)
    .slice(-25);
}

function extractEventMessages(events) {
  const rows = Array.isArray(events) ? events : events?.events || events?.data || [];
  return rows
    .map((row) => {
      const e = row?.event || row;
      const type = e?.type || e?.details?.type;
      const ts = e?.timestamp || e?.createdAt;
      const detail = e?.details?.text || e?.details?.message || e?.message;
      return [ts, type, detail].filter(Boolean).join(' — ');
    })
    .filter(Boolean)
    .slice(0, 25);
}

function extractFirstDeploy(deploysResponse) {
  if (!deploysResponse || deploysResponse.error) return null;

  if (Array.isArray(deploysResponse)) {
    const first = deploysResponse[0] || null;
    return first?.deploy || first;
  }

  if (Array.isArray(deploysResponse.deploys)) {
    const first = deploysResponse.deploys[0] || null;
    return first?.deploy || first;
  }

  if (Array.isArray(deploysResponse.data)) {
    const first = deploysResponse.data[0] || null;
    return first?.deploy || first;
  }

  return deploysResponse.deploy || null;
}

export default new RenderApiService();
