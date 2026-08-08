/**
 * generatedSiteToRender.pipeline.js
 *
 * Hosting Deploy Engine boundary for already-packaged generated sites.
 * Template AI hands off source metadata; this pipeline owns GitHub publish,
 * Render service creation, deployment records, and hosting logs.
 */

import renderApiService from '../../../services/renderApiService.js';
import { addDeploymentLog, createDeploymentRecord, renderSafeName, updateDeploymentRecord } from '../../00-SHARED/deploymentRecordStore.js';
import { buildRenderPayload } from '../04-RENDER-PAYLOAD-MOUNTAIN/renderPayloadBuilder.stage.js';
import { createAndTriggerRenderDeploy } from '../05-RENDER-DEPLOY-MOUNTAIN/renderDeploy.stage.js';
import { publishGeneratedSiteToGitHub, resolveGitHubPublisherToken } from '../03-GITHUB-SOURCE-MOUNTAIN/generatedSitesRepoPublisher.stage.js';
import { publishDirectoryToTemporaryRepo, shouldUseTemporaryRepo } from '../03-GITHUB-SOURCE-MOUNTAIN/temporaryRepoManager.stage.js';
import { startPostDeployPolling } from '../../../services/deploymentPostDeployPoller.js';
import { shouldAttachDeploymentBilling, queueDeploymentBillingAttach } from '../00-SHARED/deploymentBillingAttach.service.js';
import { publishStaticSiteToVps } from '../06-VPS-HOSTING-MOUNTAIN/vpsHostingPublisher.stage.js';

const DEFAULT_GENERATED_SITES_REPO_URL = 'https://github.com/pistion/glondia-generated-sites.git';

export async function run(input = {}, context = {}) {
  const normalized = normalizeGeneratedSiteInput(input, context);
  const requestedProvider = input.hostingTarget || input.hostingProvider || '';
  if (['vultr', 'dedicated', 'dedicated-vultr'].includes(String(requestedProvider).toLowerCase())) {
    const error = new Error('Provision the dedicated Vultr server first, then publish the generated site to it.');
    error.status = 409;
    error.code = 'DEDICATED_SERVER_REQUIRED';
    error.stage = 'provider_select';
    throw error;
  }
  const useSharedServer = !(context.isAdmin === true && String(requestedProvider).toLowerCase() === 'render');
  const deployment = await createDeploymentRecord({
    userId: normalized.userId,
    siteId: normalized.siteId,
    projectId: normalized.projectId || normalized.siteId,
    serviceName: renderSafeName(normalized.slug || normalized.siteName),
    provider: useSharedServer ? 'vps' : 'render',
    serviceType: normalized.serviceType,
    source: normalized.source,
    sourceReference: normalized.sourceReference,
    generatedSite: normalized.generatedSite,
    status: 'preparing',
    buildStatus: 'generated',
    currentStep: 'Generated source received by Hosting',
    environmentConfiguration: {
      environment: normalized.environment,
      branch: normalized.branch,
      rootDirectory: normalized.rootDirectory,
      buildCommand: normalized.buildCommand,
      outputDirectory: normalized.publishDirectory,
      framework: normalized.generatedSite.framework,
      sourceRepository: normalized.sourceRepo || null,
    },
  });

  await addDeploymentLog(deployment.deploymentId, 'Generated site handoff received from Template AI.', 'info');
  await addDeploymentLog(deployment.deploymentId, `Generated Vite source directory: ${normalized.generatedSite.siteDir}.`, 'ok');

  if (useSharedServer) {
    try {
      await updateDeploymentRecord(deployment.deploymentId, {
        provider: 'vps',
        currentStep: 'Building on Glondia shared server',
        buildStatus: 'building',
      });
      await addDeploymentLog(deployment.deploymentId, 'Selected hosting target: Glondia Shared Server.', 'info', {
        provider: 'vps',
        stage: 'provider_select',
      });
      const vpsResult = await publishStaticSiteToVps({
        deploymentId: deployment.deploymentId,
        sourceDir: normalized.generatedSite.siteDir,
        serviceType: normalized.serviceType,
        buildCommand: normalized.buildCommand,
        publishDirectory: normalized.publishDirectory,
        onLog: ({ message, level, source, stage }) =>
          addDeploymentLog(deployment.deploymentId, message, level, { source, stage }),
      });
      await addDeploymentLog(deployment.deploymentId, `Published generated site to Glondia Shared Server: ${vpsResult.liveUrl}`, 'ok', {
        provider: 'vps',
        stage: 'publish',
        publicPath: vpsResult.publicPath,
      });
      const updated = await updateDeploymentRecord(deployment.deploymentId, {
        provider: 'vps',
        platformDeployed: true,
        status: 'live',
        buildStatus: 'succeeded',
        currentStep: 'Live on Glondia shared server',
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
        environmentConfiguration: {
          ...deployment.environmentConfiguration,
          provider: 'vps',
        },
      });
      if (input.skipBillingAttach !== true) {
        queueDeploymentBillingAttach({
          deployment: updated,
          user: { id: normalized.userId },
          kind: normalized.source || 'generated-template',
        });
      }
      return updated;
    } catch (error) {
      if (!renderApiService.configured()) {
        return updateDeploymentRecord(deployment.deploymentId, {
          provider: 'vps',
          platformDeployed: false,
          status: 'failed',
          buildStatus: 'failed',
          currentStep: 'Hosting deployment failed',
          paymentStatus: 'not_billable_yet',
          subscriptionStatus: 'not_started',
          billingAttachStatus: 'not_started',
          errorMessage: 'Hosting deployment failed. Contact Glondia support.',
          errorDetails: error.details || null,
          internalProviderError: { provider: 'vps', message: error.message, stage: error.stage || 'vps_publish' },
        });
      }
      await updateDeploymentRecord(deployment.deploymentId, {
        providerFailover: {
          from: 'vps',
          to: 'render',
          reason: error.message,
          stage: error.stage || 'vps_publish',
          occurredAt: new Date().toISOString(),
        },
        currentStep: 'Retrying deployment',
        buildStatus: 'retrying',
      });
    }
  }

  let activeSourceRepo = normalized.sourceRepo;
  let activeBranch = normalized.branch;
  let renderRootDirectory = normalized.githubTargetRoot;
  let temporaryRepo = null;
  let githubPublish = { attempted: false, skippedReason: null };

  if (normalized.useTemporaryRepo) {
    const { token, error: tokenError } = resolveGitHubPublisherToken();
    if (tokenError) {
      return ready(deployment.deploymentId, 'Ready - temporary repo publish blocked', `GitHub publisher token error: ${tokenError}`, {
        generatedSite: withPublish(normalized.generatedSite, githubPublish, renderRootDirectory, temporaryRepo),
      });
    }

    temporaryRepo = await publishDirectoryToTemporaryRepo({
      directory: normalized.generatedSite.siteDir,
      slug: normalized.slug,
      branch: normalized.branch,
      token,
      owner: input.temporaryRepoOwner || input.githubOwner,
      name: input.temporaryRepoName,
      privateRepo: input.temporaryRepoPrivate !== false && input.temporaryRepoPrivate !== 'false',
    });
    githubPublish = temporaryRepo.githubPublish;
    activeSourceRepo = temporaryRepo.repoUrl;
    activeBranch = temporaryRepo.branch || normalized.branch;
    renderRootDirectory = '';
  } else if (!normalized.sourceRepo) {
    return ready(
      deployment.deploymentId,
      'Ready - missing generated-sites repository',
      'Missing RENDER_GENERATED_SITES_REPO_URL. Add it in Render Environment Variables or enter a repository URL in the handoff form.',
      { generatedSite: withPublish(normalized.generatedSite, githubPublish, renderRootDirectory, temporaryRepo) },
    );
  } else {
    githubPublish = await publishGeneratedSiteToGitHub({
      siteDir: normalized.generatedSite.siteDir,
      repoUrl: normalized.sourceRepo,
      branch: normalized.branch,
      targetRoot: normalized.githubTargetRoot,
      commitMessage: `Publish Glondia Template AI site ${normalized.slug}`,
    });
  }

  if (!githubPublish.attempted) {
    return ready(
      deployment.deploymentId,
      'Ready - GitHub publish blocked',
      githubPublish.skippedReason || 'Generated source could not be published to GitHub.',
      { generatedSite: withPublish(normalized.generatedSite, githubPublish, renderRootDirectory, temporaryRepo) },
    );
  }

  if (githubPublish.errors?.length) {
    return ready(
      deployment.deploymentId,
      'Ready - GitHub publish failed',
      `GitHub publish completed with ${githubPublish.errors.length} error(s).`,
      { generatedSite: withPublish(normalized.generatedSite, githubPublish, renderRootDirectory, temporaryRepo) },
    );
  }

  await addDeploymentLog(deployment.deploymentId, `Published ${githubPublish.publishedCount || 0} generated files to GitHub.`, 'ok', {
    repository: githubPublish.repository || githubPublish.repo,
    targetRoot: githubPublish.targetRoot,
  });

  const generatedSite = withPublish(normalized.generatedSite, githubPublish, renderRootDirectory, temporaryRepo);
  const basePatch = {
    repoUrl: activeSourceRepo,
    githubRepo: activeSourceRepo,
    githubBranch: activeBranch,
    generatedSite,
    environmentConfiguration: {
      environment: normalized.environment,
      branch: activeBranch,
      rootDirectory: renderRootDirectory,
      buildCommand: normalized.buildCommand,
      outputDirectory: normalized.publishDirectory,
      framework: normalized.generatedSite.framework,
      sourceRepository: activeSourceRepo || null,
    },
  };

  if (!renderApiService.configured()) {
    const settings = renderApiService.settings();
    return ready(deployment.deploymentId, 'Ready - missing Render credentials', `Configure ${settings.required.join(', ')} to deploy the generated site to Render.`, basePatch);
  }

  try {
    const renderPayload = buildRenderPayload({
      ...input,
      serviceName: normalized.slug,
      serviceType: normalized.serviceType,
      repoUrl: activeSourceRepo,
      repositoryUrl: activeSourceRepo,
      sourceReference: activeSourceRepo,
      branch: activeBranch,
      rootDirectory: renderRootDirectory,
      buildCommand: normalized.buildCommand,
      publishDirectory: normalized.publishDirectory,
      outputDirectory: normalized.publishDirectory,
    });
    // Launch-first rule: generated sites also start on the free plan.
    const renderResult = await createAndTriggerRenderDeploy({ ...renderPayload, renderPlanIntent: 'trial_free' });
    await addDeploymentLog(deployment.deploymentId, `Deploy ${renderResult.deployId} started for ${normalized.slug}.`, 'ok', {
      renderServiceId: renderResult.serviceId,
    });

    const updated = await updateDeploymentRecord(deployment.deploymentId, {
      ...basePatch,
      provider: 'render',
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
      liveUrl: renderResult.liveUrl || `https://${normalized.slug}.onrender.com`,
      render: {
        configured: true,
        attempted: true,
        serviceResponse: renderResult.serviceResponse,
        deployResponse: renderResult.deployResponse,
      },
      errorMessage: null,
    });

    // Billing attach (non-blocking, same as ZIP/GitHub-link pipelines).
    // The canonical Builder deploy job passes skipBillingAttach=true and queues
    // a durable BILLING_ATTACH job instead, so billing survives restarts.
    if (input.skipBillingAttach !== true) {
      queueDeploymentBillingAttach({
        deployment: updated,
        user: { id: normalized.userId },
        kind: normalized.source || 'generated-template',
      });
    }

    // Post-deploy poller (non-blocking, same as ZIP/GitHub-link pipelines).
    // The Builder deploy job uses a durable DEPLOYMENT_RECONCILE job instead.
    if (input.skipPostDeployPolling !== true) {
      startPostDeployPolling(deployment.deploymentId);
    }

    return updated;
  } catch (error) {
    await addDeploymentLog(deployment.deploymentId, error.message || 'Deploy handoff failed.', 'warn', error.details || null);
    return updateDeploymentRecord(deployment.deploymentId, {
      ...basePatch,
      platformDeployed: false,
      status: 'deployed_unverified',
      buildStatus: 'generated',
      currentStep: 'Generated and published; deploy handoff failed',
      paymentStatus: 'not_billable_yet',
      subscriptionStatus: 'not_started',
      billingAttachStatus: 'not_started',
      providerStatus: 'handoff_failed',
      liveUrl: `https://${normalized.slug}.onrender.com`,
      render: {
        configured: renderApiService.configured(),
        attempted: true,
        error: { message: error.message, status: error.status, details: error.details || null },
      },
      errorMessage: error.message || 'Deploy handoff failed.',
    });
  }
}

function normalizeGeneratedSiteInput(input = {}, context = {}) {
  if (!input.generatedSite?.siteDir) {
    const error = new Error('generatedSite.siteDir is required.');
    error.status = 400;
    error.stage = 'generated_site_package';
    throw error;
  }
  const siteName = input.siteName || input.name || input.generatedSite?.siteProfile?.siteName || input.templateId || 'glondia-site';
  const slug = slugify(input.slug || input.generatedSite?.siteProfile?.slug || siteName);
  const configuredRoot = process.env.RENDER_GENERATED_SITES_ROOT_DIR || 'generated-sites';
  const sourceRepo = String(input.repoUrl || input.repositoryUrl || process.env.RENDER_GENERATED_SITES_REPO_URL || process.env.GENERATED_SITES_REPO_URL || DEFAULT_GENERATED_SITES_REPO_URL).trim();
  const rootDirectory = input.rootDirectory || [configuredRoot, slug].filter(Boolean).join('/');
  return {
    ...input,
    userId: context.userId || input.userId || null,
    siteName,
    slug,
    serviceType: input.serviceType || 'static_site',
    plan: input.plan || 'starter',
    environment: input.environment || 'production',
    buildCommand: input.buildCommand || input.generatedSite.buildCommand || 'npm run build',
    publishDirectory: input.publishDirectory || input.outputDirectory || input.generatedSite.publishDirectory || 'dist',
    branch: input.branch || 'main',
    rootDirectory,
    githubTargetRoot: rootDirectory,
    sourceRepo,
    source: input.source || 'ai-tailored-template',
    sourceReference: input.sourceReference || 'roxanne-ai-tailored-template',
    useTemporaryRepo: shouldUseTemporaryRepo(input),
  };
}

async function ready(deploymentId, step, message, patch = {}) {
  await addDeploymentLog(deploymentId, message, 'warn');
  return updateDeploymentRecord(deploymentId, {
    ...patch,
    platformDeployed: false,
    status: 'ready',
    buildStatus: 'configuration_required',
    currentStep: step,
    paymentStatus: 'not_billable_yet',
    subscriptionStatus: 'not_started',
    billingAttachStatus: 'not_started',
    providerStatus: 'handoff_blocked',
    errorMessage: message,
    render: {
      configured: renderApiService.configured(),
      attempted: false,
      skippedReason: message,
    },
  });
}

function withPublish(generatedSite, githubPublish, githubTargetRoot, temporaryRepo) {
  return {
    ...generatedSite,
    githubPublish,
    githubTargetRoot,
    temporaryRepo,
  };
}

function slugify(value) {
  return String(value || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}
