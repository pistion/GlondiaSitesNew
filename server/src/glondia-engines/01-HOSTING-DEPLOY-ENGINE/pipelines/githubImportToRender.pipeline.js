/**
 * githubImportToRender.pipeline.js
 *
 * Controlled-source GitHub pipeline:
 *
 *   client GitHub repo
 *   → import source with GitHub App credentials
 *   → detect project + write build script
 *   → create Glondiasites-controlled repo + publish source
 *   → create Render service FROM THE CONTROLLED REPO
 *   → trigger Render deploy
 *   → store original (githubSource) + controlled (controlledSource) metadata
 *
 * Render never receives the client repo URL. The client repo is an import
 * source only.
 */

import renderApiService from '../../../services/renderApiService.js';
import { normalizeGithubLinkInput } from '../01-GITHUB-LINK-INTAKE-MOUNTAIN/githubLink.intake.js';
import { importClientGithubRepo } from '../02-GITHUB-CLIENT-IMPORT-MOUNTAIN/githubClientImport.stage.js';
import { detectProject } from '../02-UNZIP-AND-DETECT-MOUNTAIN/projectDetector.stage.js';
import { writeRenderBuildScript } from '../02-UNZIP-AND-DETECT-MOUNTAIN/buildScriptWriter.stage.js';
import { resolveDeployMode } from '../02-UNZIP-AND-DETECT-MOUNTAIN/deployModeResolver.stage.js';
import { publishToControlledRepo, archiveControlledRepo } from '../03-GITHUB-SOURCE-MOUNTAIN/controlledRepoPublisher.stage.js';
import { githubAppConfigured } from '../03-GITHUB-SOURCE-MOUNTAIN/githubAppAuth.stage.js';
import { buildRenderPayload } from '../04-RENDER-PAYLOAD-MOUNTAIN/renderPayloadBuilder.stage.js';
import { createAndTriggerRenderDeploy } from '../05-RENDER-DEPLOY-MOUNTAIN/renderDeploy.stage.js';
import { publishStaticSiteToVps } from '../06-VPS-HOSTING-MOUNTAIN/vpsHostingPublisher.stage.js';
import { startPostDeployPolling } from '../../../services/deploymentPostDeployPoller.js';
import { hasRealValue } from '../../00-SHARED/runtimeConfig.js';
import {
  addDeploymentLog,
  createDeploymentRecord,
  renderSafeName,
  updateDeploymentRecord,
} from '../../00-SHARED/deploymentRecordStore.js';

export async function run(input = {}, context = {}) {
  const normalized = normalizeGithubLinkInput(input, context);
  const requestedProvider = input.hostingTarget || input.hostingProvider || '';
  const dedicatedRequested = ['vultr', 'dedicated', 'dedicated-vultr'].includes(String(requestedProvider).toLowerCase());
  const useSharedServer = !dedicatedRequested && !(context.isAdmin === true && String(requestedProvider).toLowerCase() === 'render');

  const deployment = await createDeploymentRecord({
    userId: normalized.userId,
    siteId: normalized.siteId,
    projectId: normalized.projectId,
    serviceName: renderSafeName(normalized.siteName),
    provider: dedicatedRequested ? 'vultr' : useSharedServer ? 'vps' : 'render',
    plan: input.dedicatedTier || input.dedicatedPlanId || null,
    source: 'github-import',
    sourceReference: normalized.repoUrl,
    repoUrl: null, // controlled repo URL is filled in after publish — never the client repo
    githubBranch: normalized.branch,
    status: 'preparing',
    buildStatus: 'queued',
    currentStep: 'Importing client GitHub repository',
    environmentConfiguration: {
      sourceRepository: '',
      originalSourceRepository: normalized.repoUrl,
      branch: normalized.branch,
      rootDirectory: '',
    },
  });

  // Track the controlled repo so a Render failure AFTER repo creation can clean
  // up (archive) the orphaned dedicated repo. Stays null until publish succeeds.
  let controlledRepoRef = null;

  try {
    if (dedicatedRequested && !input.dedicatedTier) {
      await addDeploymentLog(deployment.deploymentId, 'Dedicated hosting tier was not recorded; deployment stopped before provisioning.', 'error', { stage: 'provider_select' });
      return updateDeploymentRecord(deployment.deploymentId, {
        platformDeployed: false,
        status: 'failed',
        buildStatus: 'configuration_required',
        currentStep: 'Choose dedicated hosting tier',
        paymentStatus: 'not_billable_yet',
        errorMessage: 'Choose a dedicated hosting tier before deploying.',
      });
    }
    if (dedicatedRequested) {
      await addDeploymentLog(deployment.deploymentId, `Dedicated ${input.dedicatedTier} hosting request recorded.`, 'ok', {
        stage: 'provider_select',
        tier: input.dedicatedTier,
        requestedPlan: input.dedicatedPlanId || null,
      });
    }
    await addDeploymentLog(deployment.deploymentId, `Selected hosting target: ${useSharedServer ? 'Glondia Shared Server' : 'Render'}.`, 'info', {
      provider: useSharedServer ? 'vps' : 'render',
      stage: 'provider_select',
    });
    await addDeploymentLog(deployment.deploymentId, `Importing client GitHub repository: ${normalized.parsedRepo.fullName}@${normalized.branch}.`, 'info', {
      originalSource: normalized.repoUrl,
    });

    const imported = await importClientGithubRepo({ ...normalized, deploymentSafeId: deployment.deploymentId });
    await addDeploymentLog(deployment.deploymentId, `Imported ${imported.files.length} files from client repository.`, 'ok');

    const detected = await detectProject(imported.localDir, imported.files);
    const project = applyDeployOverrides(input, detected);
    const resolvedMode = resolveDeployMode({
      detected: project,
      selectedMode: input.deployMode || input.mode || 'auto',
      fields: input,
      files: imported.files,
    });
    const shell = await writeRenderBuildScript(imported.localDir, project);
    await addDeploymentLog(deployment.deploymentId, `Detected ${detectedLabel(detected)}. Deploying as ${project.serviceType}. Build script prepared.`, 'info');
    if (detected.envHints?.requiredEnv?.length) {
      await addDeploymentLog(
        deployment.deploymentId,
        `Detected required env hints: ${detected.envHints.requiredEnv.join(', ')}. Set these on the service before the app can run correctly.`,
        detected.envHints.riskLevel === 'high' ? 'warn' : 'info',
        { envHints: detected.envHints },
      );
    }

    const githubSource = {
      originalRepoUrl: imported.originalRepoUrl,
      originalFullName: imported.originalFullName,
      originalBranch: imported.originalBranch,
      originalRootDirectory: imported.originalRootDirectory,
      clientInstallationId: imported.clientInstallationId,
      importedAt: imported.importedAt,
    };

    if (useSharedServer) {
      const baseUpdate = {
        repoUrl: normalized.repoUrl,
        githubRepo: normalized.repoUrl,
        githubBranch: normalized.branch,
        serviceType: project.serviceType,
        deployMode: resolvedMode.mode,
        deployModeConfidence: resolvedMode.confidence,
        deployModeWarnings: resolvedMode.warnings,
        githubSource,
        environmentConfiguration: {
          sourceRepository: normalized.repoUrl,
          originalSourceRepository: normalized.repoUrl,
          branch: normalized.branch,
          rootDirectory: imported.originalRootDirectory || '',
          buildCommand: shell.buildCommand,
          outputDirectory: project.publishDirectory,
          startCommand: project.startCommand || '',
          runtime: project.runtime || '',
          provider: 'vps',
          deployMode: resolvedMode.mode,
          deployModeConfidence: resolvedMode.confidence,
        },
      };

      if (dedicatedRequested) {
        await addDeploymentLog(deployment.deploymentId, 'Repository intake is recorded and waiting for the managed dedicated provisioning worker.', 'info', { stage: 'provision' });
        return updateDeploymentRecord(deployment.deploymentId, {
          ...baseUpdate,
          provider: 'vultr',
          hostingPlan: 'dedicated',
          dedicatedTier: input.dedicatedTier,
          dedicatedPlanId: input.dedicatedPlanId || null,
          platformDeployed: false,
          status: 'ready',
          buildStatus: 'provisioning_queued',
          currentStep: 'Dedicated server provisioning queued',
          paymentStatus: 'not_billable_yet',
        });
      }

      try {
        const vpsResult = await publishStaticSiteToVps({
        deploymentId: deployment.deploymentId,
        sourceDir: imported.localDir,
        serviceType: project.serviceType,
        buildCommand: shell.buildCommand,
        publishDirectory: project.publishDirectory,
      });
      await addDeploymentLog(deployment.deploymentId, `Published to Glondia hosting server: ${vpsResult.liveUrl}`, 'ok', {
        provider: 'vps',
        publicPath: vpsResult.publicPath,
        publishDirectory: vpsResult.publishDirectory,
      });

        return updateDeploymentRecord(deployment.deploymentId, {
        ...baseUpdate,
        provider: 'vps',
        platformDeployed: true,
        status: 'live',
        buildStatus: 'succeeded',
        currentStep: 'Live on Glondia hosting server',
        paymentStatus: 'billing_pending',
        subscriptionStatus: 'trial_pending',
        billingAttachStatus: 'queued',
        renderServiceId: vpsResult.serviceId,
        renderDeployId: vpsResult.deployId,
        providerServiceId: vpsResult.serviceId,
        providerDeployId: vpsResult.deployId,
        providerStatus: vpsResult.providerStatus,
        liveUrl: vpsResult.liveUrl,
        verifiedUrl: vpsResult.liveUrl,
        urlReachable: true,
        vpsHosting: vpsResult,
        render: null,
        errorMessage: null,
        lastDeployedAt: new Date().toISOString(),
        });
      } catch (primaryError) {
        if (!renderApiService.configured()) throw primaryError;
        await updateDeploymentRecord(deployment.deploymentId, {
          providerFailover: {
            from: 'vps',
            to: 'render',
            reason: primaryError.message,
            stage: primaryError.stage || 'vps_publish',
            occurredAt: new Date().toISOString(),
          },
          currentStep: 'Retrying deployment',
          buildStatus: 'retrying',
        });
      }
    }

    // Capability check: we can publish to a controlled repo if we have a usable
    // credential (GitHub App or non-PEM PAT) AND a controlled target (a creatable
    // owner or the shared RENDER_GENERATED_SITES_REPO_URL fallback).
    const patToken = process.env.GITHUB_GENERATED_SITES_TOKEN || process.env.GITHUB_TOKEN || '';
    const hasControlledCreds = githubAppConfigured() || (hasRealValue(patToken) && !patToken.includes('-----BEGIN'));
    const hasControlledTarget = hasRealValue(process.env.GITHUB_GLONDIASITES_OWNER) || hasRealValue(process.env.RENDER_GENERATED_SITES_REPO_URL);
    if (!hasControlledCreds || !hasControlledTarget) {
      return ready(
        deployment.deploymentId,
        'Ready - controlled repo publishing not configured',
        'Configure GitHub App credentials (GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY) and a controlled target (GITHUB_GLONDIASITES_OWNER or RENDER_GENERATED_SITES_REPO_URL) before deploying client repos.',
        { githubSource },
      );
    }

    const controlledRepo = await publishToControlledRepo({
      localDir: imported.localDir,
      siteName: normalized.siteName,
      userId: normalized.userId,
      owner: input.controlledRepoOwner || process.env.GITHUB_GLONDIASITES_OWNER,
      privateRepo: input.privateRepo,
    });
    controlledRepoRef = controlledRepo;
    await addDeploymentLog(deployment.deploymentId, `Published ${controlledRepo.publishedCount} files to controlled repo (${controlledRepo.mode}): ${controlledRepo.controlledFullName}${controlledRepo.rootDirectory ? '/' + controlledRepo.rootDirectory : ''}.`, 'ok', {
      controlledSource: controlledRepo.controlledRepoUrl,
      mode: controlledRepo.mode,
      rootDirectory: controlledRepo.rootDirectory,
      commitId: controlledRepo.commitId,
    });

    const controlledSource = {
      repoUrl: controlledRepo.controlledRepoUrl,
      fullName: controlledRepo.controlledFullName,
      mode: controlledRepo.mode,
      branch: controlledRepo.branch,
      rootDirectory: controlledRepo.rootDirectory || '',
      commitId: controlledRepo.commitId,
      private: controlledRepo.private,
      createdAt: controlledRepo.createdAt,
      publishedCount: controlledRepo.publishedCount,
    };

    // Launch-first rule: deploy on the free plan. Only an admin may force a
    // non-free initial plan; a normal user's supplied `plan` is ignored. The
    // trusted renderPlanIntent is what the Render payload builder honours.
    const adminPlanOverride = context.isAdmin === true && Boolean(input.plan);
    const renderPlanIntent = adminPlanOverride ? 'admin_override' : 'trial_free';
    const initialPlan = adminPlanOverride
      ? input.plan
      : (process.env.RENDER_INITIAL_PLAN || 'free');

    const renderPayload = buildRenderPayload({
      ...input,
      serviceName: normalized.siteName,
      // Render source is ALWAYS the controlled repo, never the client repo.
      repoUrl: controlledRepo.controlledRepoUrl,
      repositoryUrl: controlledRepo.controlledRepoUrl,
      sourceReference: controlledRepo.controlledRepoUrl,
      branch: controlledRepo.branch,
      rootDirectory: controlledRepo.rootDirectory || '',
      buildCommand: shell.buildCommand,
      publishDirectory: project.publishDirectory,
      outputDirectory: project.publishDirectory,
      startCommand: project.startCommand || '',
      runtime: project.runtime || '',
      serviceType: project.serviceType,
      framework: project.framework,
      plan: initialPlan,
    });

    const baseUpdate = {
      repoUrl: controlledRepo.controlledRepoUrl,
      githubRepo: controlledRepo.controlledRepoUrl,
      githubBranch: controlledRepo.branch,
      serviceType: project.serviceType,
      deployMode: resolvedMode.mode,
      deployModeConfidence: resolvedMode.confidence,
      deployModeWarnings: resolvedMode.warnings,
      githubSource,
      controlledSource,
      environmentConfiguration: {
        sourceRepository: controlledRepo.controlledRepoUrl,
        originalSourceRepository: normalized.repoUrl,
        branch: controlledRepo.branch,
        rootDirectory: controlledRepo.rootDirectory || '',
        buildCommand: renderPayload.buildCommand,
        outputDirectory: renderPayload.outputDirectory,
        startCommand: renderPayload.startCommand || '',
        runtime: renderPayload.runtime || '',
        plan: renderPayload.plan,
        region: renderPayload.region,
        deployMode: resolvedMode.mode,
        deployModeConfidence: resolvedMode.confidence,
      },
    };

    if (!renderApiService.configured()) {
      const settings = renderApiService.settings();
      return ready(
        deployment.deploymentId,
        'Hosting temporarily unavailable',
        'Glondia could not start the fallback hosting route. Contact support.',
        baseUpdate,
      );
    }

    await addDeploymentLog(deployment.deploymentId, 'Creating hosting service and triggering deployment.', 'info');
    const renderResult = await createAndTriggerRenderDeploy({
      ...renderPayload,
      renderPlanIntent,
      // Pin the deploy to the freshly published commit when available.
      ...(controlledRepo.commitId ? { commitId: controlledRepo.commitId } : {}),
    });
    await addDeploymentLog(deployment.deploymentId, `Hosting deployment ${renderResult.deployId} started.`, 'ok', {
      renderServiceId: renderResult.serviceId,
      internalProvider: 'render',
    });

    const updated = await updateDeploymentRecord(deployment.deploymentId, {
      ...baseUpdate,
      provider: 'render',
      // Render handoff succeeded → real, billable platform deployment.
      platformDeployed: true,
      status: 'building',
      buildStatus: 'queued',
      currentStep: 'Queued for deploy',
      paymentStatus: 'billing_pending',
      subscriptionStatus: 'trial_pending',
      billingAttachStatus: 'queued',
      renderServiceId: renderResult.serviceId,
      renderDeployId: renderResult.deployId,
      providerServiceId: renderResult.serviceId,
      providerDeployId: renderResult.deployId,
      providerStatus: renderResult.providerStatus,
      liveUrl: renderResult.liveUrl,
      render: {
        serviceResponse: renderResult.serviceResponse,
        deployResponse: renderResult.deployResponse,
      },
      errorMessage: null,
    });
    // Background monitor advances the record to live/failed without blocking
    // the deploy response.
    startPostDeployPolling(deployment.deploymentId);
    return updated;
  } catch (error) {
    // Keep failed records visible with their source metadata intact.
    await addDeploymentLog(deployment.deploymentId, error.message || 'GitHub import deployment failed.', 'error', error.details || null);

    // Clean up an orphaned DEDICATED controlled repo if Render failed after we
    // created it. Shared-repo mode is never archived (other sites live there).
    const cleanup = await cleanupControlledRepoAfterFailure(deployment.deploymentId, controlledRepoRef);

    return updateDeploymentRecord(deployment.deploymentId, {
      // Never reached Render → not billable, no trial timer.
      platformDeployed: false,
      status: 'failed',
      buildStatus: 'failed',
      recordStatus: 'active',
      currentStep: stageToStep(error.stage),
      paymentStatus: 'not_billable_yet',
      subscriptionStatus: 'not_started',
      errorMessage: error.message || 'GitHub import deployment failed.',
      errorDetails: error.details || null,
      controlledRepoCleanupStatus: cleanup.status,
      ...(controlledRepoRef ? {
        controlledSource: {
          repoUrl: controlledRepoRef.controlledRepoUrl,
          fullName: controlledRepoRef.controlledFullName,
          mode: controlledRepoRef.mode,
          archivedAfterFailure: cleanup.archived,
        },
      } : {}),
    });
  }
}

/**
 * Archive a dedicated controlled repo after a failed deploy so we don't leave
 * orphan repos behind. Disabled when GITHUB_ARCHIVE_FAILED_CONTROLLED_REPOS is
 * 'false'. Never archives shared-repo mode. Best-effort — never throws.
 */
async function cleanupControlledRepoAfterFailure(deploymentId, controlledRepo) {
  if (!controlledRepo) return { status: 'not_applicable', archived: false };
  if (controlledRepo.mode !== 'dedicated-repo') return { status: 'skipped_shared_repo', archived: false };
  if (String(process.env.GITHUB_ARCHIVE_FAILED_CONTROLLED_REPOS || '').toLowerCase() === 'false') {
    await addDeploymentLog(deploymentId, `Controlled repo ${controlledRepo.controlledFullName} left intact (archival disabled).`, 'warn');
    return { status: 'disabled', archived: false };
  }
  try {
    await archiveControlledRepo({ repoUrl: controlledRepo.controlledRepoUrl });
    await addDeploymentLog(deploymentId, `Archived orphaned controlled repo after failed deploy: ${controlledRepo.controlledFullName}.`, 'ok');
    return { status: 'archived', archived: true };
  } catch (archiveError) {
    await addDeploymentLog(deploymentId, `Failed to archive controlled repo ${controlledRepo.controlledFullName}: ${archiveError.message}`, 'warn');
    return { status: 'archive_failed', archived: false };
  }
}

class GithubImportPipelineService {
  async create(input = {}, context = {}) {
    return run(input, context);
  }
}

async function ready(deploymentId, step, message, patch = {}) {
  await addDeploymentLog(deploymentId, message, 'warn');
  return updateDeploymentRecord(deploymentId, {
    ...patch,
    // Prepared but NOT handed off to Render → not billable, no trial timer.
    platformDeployed: false,
    status: 'ready',
    buildStatus: 'configuration_required',
    currentStep: step,
    paymentStatus: 'not_billable_yet',
    subscriptionStatus: 'not_started',
    errorMessage: message,
  });
}

function stageToStep(stage) {
  return {
    github_repo_validate: 'GitHub repo validation failed',
    github_client_import: 'Client GitHub import failed',
    project_detection: 'Project detection failed',
    build_script_write: 'Build script write failed',
    controlled_repo_create: 'Controlled repo creation failed',
    github_push: 'Controlled repo publish failed',
    render_service_create: 'Render service creation failed',
    render_deploy_trigger: 'Render deploy trigger failed',
  }[stage] || 'Failed';
}

function applyDeployOverrides(input = {}, detected = {}) {
  const requestedServiceType = normalizeServiceType(input.serviceType || input.deployServiceType);
  const serviceType = requestedServiceType || detected.serviceType || 'static_site';
  const publishDirectory = input.publishDirectory || input.outputDirectory || detected.publishDirectory || '.';
  const requestedBuildCommand = input.projectBuildCommand || input.detectedBuildCommand || (
    input.buildCommand && input.buildCommand !== 'bash glondia-render-build.sh'
      ? input.buildCommand
      : null
  );

  return {
    ...detected,
    serviceType,
    detectedServiceType: serviceType,
    framework: input.framework || detected.framework,
    publishDirectory,
    detectedPublishDirectory: publishDirectory,
    detectedBuildCommand: serviceType === 'static_site'
      ? (requestedBuildCommand || null)
      : (requestedBuildCommand || detected.detectedBuildCommand || null),
    startCommand: serviceType === 'web_service'
      ? (input.startCommand || detected.startCommand || detected.detectedStartCommand || 'npm start')
      : null,
    runtime: serviceType === 'web_service'
      ? (input.runtime || detected.runtime || 'node')
      : null,
  };
}

function normalizeServiceType(value) {
  const type = String(value || '').trim().toLowerCase();
  if (['static', 'static_site', 'static-site'].includes(type)) return 'static_site';
  if (['web', 'web_service', 'web-service'].includes(type)) return 'web_service';
  if (type === 'docker') return 'docker';
  return null;
}

function detectedLabel(detected = {}) {
  return `${detected.framework || 'Unknown'} (${detected.type || detected.projectType || 'unknown'})`;
}

export default new GithubImportPipelineService();
