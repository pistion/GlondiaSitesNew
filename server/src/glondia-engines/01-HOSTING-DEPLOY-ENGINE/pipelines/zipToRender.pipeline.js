/**
 * zipToRender.pipeline.js
 *
 * ZIP -> GitHub generated-sites repo -> Render pipeline.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import renderApiService from '../../../services/renderApiService.js';
import { normalizeZipUploadInput } from '../01-ZIP-INTAKE-MOUNTAIN/zipUpload.intake.js';
import { extractZipSafely } from '../02-UNZIP-AND-DETECT-MOUNTAIN/zipExtractor.stage.js';
import { detectProject } from '../02-UNZIP-AND-DETECT-MOUNTAIN/projectDetector.stage.js';
import { writeRenderBuildScript, writeRootDispatcherScript } from '../02-UNZIP-AND-DETECT-MOUNTAIN/buildScriptWriter.stage.js';
import { resolveDeployMode } from '../02-UNZIP-AND-DETECT-MOUNTAIN/deployModeResolver.stage.js';
import { publishDirectoryToGithub } from '../03-GITHUB-SOURCE-MOUNTAIN/githubPublisher.stage.js';
import { publishDirectoryToTemporaryRepo, shouldUseTemporaryRepo } from '../03-GITHUB-SOURCE-MOUNTAIN/temporaryRepoManager.stage.js';
import { getRuntimeConfig, hasRealValue } from '../../00-SHARED/runtimeConfig.js';
import {
  addDeploymentLog,
  createDeploymentRecord,
  renderSafeName,
  serviceUrl,
  updateDeploymentRecord,
} from '../../00-SHARED/deploymentRecordStore.js';
import { createAndTriggerRenderDeploy } from '../05-RENDER-DEPLOY-MOUNTAIN/renderDeploy.stage.js';
import { publishStaticSiteToVps } from '../06-VPS-HOSTING-MOUNTAIN/vpsHostingPublisher.stage.js';
import { startPostDeployPolling } from '../../../services/deploymentPostDeployPoller.js';

export async function run(input = {}, context = {}) {
  const normalized = normalizeZipUploadInput(input, context);
  const { file, fields, siteName, slug, uploadId, siteDir, targetRoot, sourceRepo, branch } = normalized;
  const requestedProvider = fields.hostingTarget || fields.hostingProvider || '';
  const dedicatedRequested = ['vultr', 'dedicated', 'dedicated-vultr'].includes(String(requestedProvider).toLowerCase());
  // Customer input cannot select the infrastructure vendor. Direct Render is
  // reserved for explicit admin operations; normal deployments start on the
  // Glondia hosting server and fail over internally when necessary.
  const useSharedServer = !dedicatedRequested && !(context.isAdmin === true && String(requestedProvider).toLowerCase() === 'render');
  const cfg = getRuntimeConfig();

  // Launch-first rule: every deployment starts on the free plan. Only an admin
  // may force a non-free initial plan (e.g. internal/staff deploys). The trusted
  // renderPlanIntent — NOT the raw plan — is what the Render payload builder honours.
  const adminPlanOverride = context.isAdmin === true && Boolean(fields.plan);
  const renderPlanIntent = adminPlanOverride ? 'admin_override' : 'trial_free';
  const initialPlan = adminPlanOverride
    ? fields.plan
    : (process.env.RENDER_INITIAL_PLAN || 'free');

  const deployment = await createDeploymentRecord({
    userId: normalized.userId,
    siteId: fields.siteId || null,
    projectId: fields.projectId || fields.siteId || null,
    serviceName: renderSafeName(siteName),
    provider: dedicatedRequested ? 'vultr' : useSharedServer ? 'vps' : 'render',
    plan: fields.dedicatedTier || fields.dedicatedPlanId || null,
    source: 'zip-upload',
    sourceReference: file.originalname,
    repoUrl: sourceRepo || null,
    githubBranch: branch,
    status: 'preparing',
    buildStatus: 'uploaded',
    currentStep: 'ZIP received',
    generatedSite: {
      uploadId,
      uploadedFileName: file.originalname,
      uploadedBytes: file.size,
      siteDir,
      githubTargetRoot: targetRoot,
    },
    environmentConfiguration: { sourceRepository: sourceRepo || '', branch, rootDirectory: targetRoot },
  });

  try {
    const logStage = (stage, message, level = 'info', details = {}) =>
      addDeploymentLog(deployment.deploymentId, message, level, { stage, ...details });
    const setStage = async (stage, currentStep, buildStatus, message) => {
      await updateDeploymentRecord(deployment.deploymentId, { currentStep, buildStatus });
      if (message) await logStage(stage, message);
    };
    if (dedicatedRequested && !fields.dedicatedTier) {
      await logStage('provider_select', 'Dedicated hosting tier was not recorded; deployment stopped before provisioning.', 'error');
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
      await logStage('provider_select', `Dedicated ${fields.dedicatedTier} hosting request recorded.`, 'ok', {
        tier: fields.dedicatedTier,
        requestedPlan: fields.dedicatedPlanId || null,
      });
    }

    await logStage('upload', `ZIP upload received: ${file.originalname} (${file.size} bytes).`, 'info', {
      fileName: file.originalname,
      bytes: file.size,
    });
    await logStage('provider_select', `Selected hosting target: ${useSharedServer ? 'Glondia Shared Server' : 'Render'}.`, 'info', {
      provider: useSharedServer ? 'vps' : 'render',
    });
    await setStage('extract', 'Extracting ZIP archive', 'extracting', 'Validating archive paths and extracting deployable files.');
    const extracted = await extractZipSafely(file.buffer || file.path, siteDir);
    await logStage('extract', `ZIP extraction complete: ${extracted.files.length} deployable files, ${extracted.ignoredFiles.length} ignored.`, 'ok', {
      deployableFiles: extracted.files.length,
      ignoredFiles: extracted.ignoredFiles.length,
    });
    await setStage('detect', 'Detecting project', 'detecting', 'Inspecting package files, framework, runtime, and output directory.');
    const detected = await detectProject(siteDir, extracted.files);
    // Resolve the deploy mode (auto unless the user picked one) and let it drive
    // the build script and Render service settings.
    const resolvedMode = resolveDeployMode({
      detected,
      selectedMode: fields.deployMode || fields.mode || 'auto',
      fields,
      files: extracted.files,
    });
    const shell = await writeRenderBuildScript(siteDir, {
      ...detected,
      serviceType: resolvedMode.serviceType,
      detectedBuildCommand: resolvedMode.buildCommand,
      publishDirectory: resolvedMode.publishDirectory,
    });
    await logStage('detect', `Project detected: ${detected.framework} (${detected.type}); package manager ${detected.packageManager || 'npm'}.`, 'ok', {
      framework: detected.framework,
      projectType: detected.type,
      packageManager: detected.packageManager || 'npm',
      buildCommand: resolvedMode.buildCommand,
      publishDirectory: resolvedMode.publishDirectory,
    });
    const manifest = await writeManifest(siteDir, deployment.deploymentId, uploadId, file.originalname, targetRoot, sourceRepo, branch, detected, extracted);

    const serviceType = fields.serviceType || resolvedMode.serviceType;
    const outputDirectory = fields.outputDirectory || fields.publishDirectory || resolvedMode.publishDirectory || 'dist';
    // Root base the site source is published under (targetRoot === `${rootBase}/${slug}`).
    // The root dispatcher and GLONDIA_SITE_ROOT_DIR env var must use this same base
    // so a shared-repo deploy published under generated-sites/foo is found there.
    const dirOfTarget = path.posix.dirname(String(targetRoot || ''));
    const rootBase = (!dirOfTarget || dirOfTarget === '.')
      ? (cfg.generatedSitesRootDir || 'uploaded-sites')
      : dirOfTarget;
    const useTemporaryRepo = shouldUseTemporaryRepo(fields);
    let activeSourceRepo = sourceRepo;
    let activeTargetRoot = targetRoot;
    let renderInput = buildRenderInput(fields, siteName, serviceType, activeSourceRepo, branch, activeTargetRoot, shell, outputDirectory, detected, initialPlan);
    let baseUpdate = buildBaseUpdate(deployment, serviceType, activeSourceRepo, branch, activeTargetRoot, renderInput, detected, extracted, manifest);
    // Record the resolved deploy mode + warnings so the dashboard can show them.
    baseUpdate.deployMode = resolvedMode.mode;
    baseUpdate.deployModeConfidence = resolvedMode.confidence;
    baseUpdate.deployModeWarnings = resolvedMode.warnings;
    baseUpdate.environmentConfiguration.deployMode = resolvedMode.mode;
    baseUpdate.environmentConfiguration.deployModeConfidence = resolvedMode.confidence;
    if (resolvedMode.warnings.length) {
      await addDeploymentLog(deployment.deploymentId, `Deploy mode "${resolvedMode.mode}": ${resolvedMode.warnings.join(' ')}`, 'warn');
    }

    await addDeploymentLog(deployment.deploymentId, `Detected ${detected.framework} (${detected.type}) and prepared ${extracted.files.length} deployable files.`, 'info');
    if (detected.envHints?.requiredEnv?.length) {
      await addDeploymentLog(
        deployment.deploymentId,
        `Detected required env hints: ${detected.envHints.requiredEnv.join(', ')}. Set these on the service before the app can run correctly.`,
        detected.envHints.riskLevel === 'high' ? 'warn' : 'info',
        { envHints: detected.envHints },
      );
    }

    if (dedicatedRequested) {
      await logStage('provision', 'Source intake is recorded and waiting for the managed dedicated provisioning worker.', 'info');
      return updateDeploymentRecord(deployment.deploymentId, {
        ...baseUpdate,
        provider: 'vultr',
        hostingPlan: 'dedicated',
        dedicatedTier: fields.dedicatedTier,
        dedicatedPlanId: fields.dedicatedPlanId || null,
        platformDeployed: false,
        status: 'ready',
        buildStatus: 'provisioning_queued',
        currentStep: 'Dedicated server provisioning queued',
        paymentStatus: 'not_billable_yet',
      });
    }

    if (useSharedServer) {
      try {
        await setStage('server_pull', 'Preparing hosting server workspace', 'preparing_server', 'Hosting server is copying the extracted source into an isolated build workspace.');
        const vpsResult = await publishStaticSiteToVps({
        deploymentId: deployment.deploymentId,
        sourceDir: siteDir,
        serviceType,
        buildCommand: shell.buildCommand,
        publishDirectory: outputDirectory,
        onLog: ({ message, level, source, stage }) =>
          addDeploymentLog(deployment.deploymentId, message, level, { source, stage }),
      });
      await logStage('publish', `Build output copied to the public hosting directory (${outputDirectory}).`, 'ok', { source: 'vps' });
      await logStage('verify', 'Nginx configuration validated and reloaded.', 'ok', { source: 'vps' });
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

    if (!useTemporaryRepo && !hasRealValue(sourceRepo)) {
      return ready(deployment.deploymentId, baseUpdate, 'Hosting configuration required', 'The fallback hosting route is not configured. Contact Glondia support.');
    }
    if (!cfg.githubPublisherConfigured) {
      return ready(deployment.deploymentId, baseUpdate, 'Hosting configuration required', 'The fallback source publisher is not configured. Contact Glondia support.');
    }

    let githubPublish;
    await setStage('github_push', 'Publishing source to GitHub', 'publishing_source', `Publishing extracted source to GitHub branch ${branch}.`);
    if (useTemporaryRepo) {
      const tempRepo = await publishDirectoryToTemporaryRepo({
        directory: siteDir,
        slug,
        branch,
        token: cfg.githubPublisherToken,
        owner: fields.temporaryRepoOwner || fields.githubOwner,
        name: fields.temporaryRepoName,
        privateRepo: fields.temporaryRepoPrivate !== false && fields.temporaryRepoPrivate !== 'false',
      });
      activeSourceRepo = tempRepo.repoUrl;
      activeTargetRoot = '';
      githubPublish = tempRepo.githubPublish;
      renderInput = buildRenderInput(fields, siteName, serviceType, activeSourceRepo, tempRepo.branch || branch, activeTargetRoot, shell, outputDirectory, detected, initialPlan);
      baseUpdate = buildBaseUpdate(deployment, serviceType, activeSourceRepo, tempRepo.branch || branch, activeTargetRoot, renderInput, detected, extracted, manifest);
      baseUpdate.generatedSite.temporaryRepo = {
        repoUrl: tempRepo.repoUrl,
        fullName: tempRepo.fullName,
        private: tempRepo.private,
        archived: tempRepo.archived,
      };
    } else {
      githubPublish = await publishDirectoryToGithub({
        directory: siteDir,
        targetRoot,
        repoUrl: sourceRepo,
        branch,
        token: cfg.githubPublisherToken,
        // Bind the dispatcher to the SAME root base used for targetRoot so it
        // looks under generated-sites/<slug>, not the hardcoded uploaded-sites.
        rootDispatcher: (dir) => writeRootDispatcherScript(dir, { rootBase }),
      });
    }
    baseUpdate.generatedSite.githubPublish = githubPublish;
    await logStage('github_push', `Published ${githubPublish.published.length} files to GitHub.`, 'ok', {
      source: 'github',
      branch,
      repository: activeSourceRepo,
    });

    if (!renderApiService.configured()) {
      return ready(deployment.deploymentId, baseUpdate, 'Hosting temporarily unavailable', 'Glondia could not start the fallback hosting route. Contact support.');
    }

    await setStage('provider_pull', 'Hosting provider pulling source', 'queued', 'GitHub publish complete; creating the hosting service and requesting a fresh source pull.');
    // For shared-repo mode the dispatcher needs the root base; for a temporary
    // repo the site lives at the repo root so no root base is sent.
    const renderResult = await createAndTriggerRenderDeploy({
      ...renderInput,
      renderPlanIntent,
      siteSlug: slug,
      ...(useTemporaryRepo ? {} : { siteRootDir: rootBase }),
    });
    await addDeploymentLog(deployment.deploymentId, `Deploy ${renderResult.deployId} started.`, 'ok');
    await addDeploymentLog(deployment.deploymentId, `Hosting deployment ${renderResult.deployId} started.`, 'ok', { internalProvider: 'render' });
    const updated = await updateDeploymentRecord(deployment.deploymentId, {
      ...baseUpdate,
      provider: 'render',
      // Render handoff succeeded → this is a real, billable platform deployment.
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
    // Kick off a background monitor so the record advances to live/failed
    // without waiting for the user to open the dashboard. Non-blocking.
    startPostDeployPolling(deployment.deploymentId);
    return updated;
  } catch (error) {
    await addDeploymentLog(deployment.deploymentId, error.message || 'ZIP deploy failed.', 'error', error.details || null);
    return updateDeploymentRecord(deployment.deploymentId, {
      // Never reached Render → not billable, no trial timer.
      platformDeployed: false,
      status: 'failed',
      buildStatus: 'failed',
      currentStep: stageToStep(error.stage),
      paymentStatus: 'not_billable_yet',
      subscriptionStatus: 'not_started',
      errorMessage: error.message || 'ZIP deploy failed.',
      errorDetails: error.details || null,
    });
  }
}

export async function runFromBase64(input) {
  const base64 = String(input?.fileBase64 || '').replace(/^data:.*?;base64,/, '');
  if (!base64) {
    const error = new Error('fileBase64 is required.');
    error.status = 400;
    error.stage = 'zip_upload';
    throw error;
  }
  const buffer = Buffer.from(base64, 'base64');
  return run({
    file: {
      originalname: input.fileName || 'uploaded-site.zip',
      size: buffer.length,
      buffer,
    },
    fields: {
      ...input,
      siteName: input.siteName || input.name,
      serviceName: input.serviceName || input.siteName || input.name,
    },
    userId: input.userId,
  }, { userId: input.userId || 'local-user' });
}

class ZipDeploymentPipelineService {
  async create(input = {}, context = {}) {
    return run(input, context);
  }
}

function buildRenderInput(fields, siteName, serviceType, sourceRepo, branch, targetRoot, shell, outputDirectory, detected, initialPlan = 'free') {
  return {
    serviceName: renderSafeName(siteName),
    serviceType,
    repoUrl: sourceRepo,
    repositoryUrl: sourceRepo,
    sourceReference: sourceRepo,
    branch,
    rootDirectory: targetRoot,
    buildCommand: fields.buildCommand || shell.buildCommand,
    outputDirectory,
    publishDirectory: outputDirectory,
    startCommand: fields.startCommand || detected.startCommand || detected.detectedStartCommand || '',
    runtime: fields.runtime || detected.runtime || '',
    plan: initialPlan,
    region: fields.region || 'oregon',
    framework: detected.framework,
  };
}

function buildBaseUpdate(deployment, serviceType, sourceRepo, branch, targetRoot, renderInput, detected, extracted, manifest) {
  return {
    serviceType,
    repoUrl: sourceRepo || null,
    githubRepo: sourceRepo || null,
    githubBranch: branch,
    generatedSite: {
      ...deployment.generatedSite,
      framework: detected.framework,
      projectType: detected.type,
      files: extracted.files,
      ignoredFiles: extracted.ignoredFiles,
      sourceArtifact: manifest,
    },
    environmentConfiguration: {
      sourceRepository: sourceRepo || '',
      branch,
      rootDirectory: targetRoot,
      buildCommand: renderInput.buildCommand,
      outputDirectory: renderInput.outputDirectory,
      startCommand: renderInput.startCommand || '',
      runtime: renderInput.runtime || '',
      plan: renderInput.plan,
      region: renderInput.region,
    },
  };
}

async function writeManifest(siteDir, deploymentId, uploadId, originalName, targetRoot, sourceRepo, branch, detected, extracted) {
  const manifest = {
    deploymentId,
    uploadId,
    source: 'zip-upload',
    originalName,
    targetRoot,
    sourceRepo,
    branch,
    detected,
    files: extracted.files,
    ignoredCount: extracted.ignoredFiles.length,
    createdAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(siteDir, 'glondia-upload-artifact.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function ready(deploymentId, baseUpdate, step, message) {
  await addDeploymentLog(deploymentId, message, 'warn');
  return updateDeploymentRecord(deploymentId, {
    ...baseUpdate,
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
    zip_upload: 'ZIP upload failed',
    zip_validation: 'ZIP validation failed',
    zip_extract: 'ZIP extraction failed',
    project_detection: 'Project detection failed',
    github_push: 'GitHub publish failed',
    vps_build: 'Hosting server build failed',
    vps_publish: 'Hosting server publish failed',
    render_service_create: 'Render service creation failed',
    render_deploy_trigger: 'Render deploy trigger failed',
  }[stage] || 'Failed';
}

export default new ZipDeploymentPipelineService();
