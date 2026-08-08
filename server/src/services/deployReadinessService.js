/**
 * deployReadinessService.js
 *
 * Non-destructive readiness probe for the deploy-critical surface: database
 * tables, Render config, GitHub publisher/controlled-repo config, and the
 * temp/data directories. Surfaced via GET /api/deployments/settings so the UI
 * (and ops) can see exactly why a ZIP/GitHub deploy would only "prepare" instead
 * of handing off to Render. Never exposes secrets — only booleans + a `missing`
 * list of env var NAMES.
 */
import { promises as fsp, constants as fsConstants } from 'node:fs';
import { prisma } from './db.js';
import renderApiService from './renderApiService.js';
import { getRuntimeConfig, hasRealValue } from '../glondia-engines/00-SHARED/runtimeConfig.js';
import { getProviderCapabilities } from '../glondia-engines/01-HOSTING-DEPLOY-ENGINE/00-SHARED/hostingProviderResolver.js';

async function canQuery(model) {
  try { await prisma[model].count(); return true; } catch { return false; }
}

async function dirWritable(dir) {
  if (!dir) return false;
  try {
    await fsp.mkdir(dir, { recursive: true });
    await fsp.access(dir, fsConstants.W_OK);
    return true;
  } catch { return false; }
}

export async function checkDeployReadiness() {
  const cfg = getRuntimeConfig();
  const capabilities = getProviderCapabilities();
  const missing = [];

  const [databaseReady, billingReady, subscriptionReady, notificationReady] = await Promise.all([
    canQuery('user'),
    canQuery('checkoutOrder'),
    canQuery('deploymentSubscription'),
    canQuery('notification'),
  ]);

  const renderReady = renderApiService.configured();
  if (!renderReady) missing.push(...(cfg.missingRender.length ? cfg.missingRender : ['RENDER_API_KEY', 'RENDER_OWNER_ID']));

  const githubPublisherReady = cfg.githubPublisherConfigured;
  if (!githubPublisherReady) missing.push(...cfg.missingGithubPublisher);

  // GitHub import (controlled repo) capability: a usable credential + a target.
  const patToken = process.env.GITHUB_GENERATED_SITES_TOKEN || process.env.GITHUB_TOKEN || '';
  const hasControlledCreds = hasRealValue(process.env.GITHUB_APP_ID) || (hasRealValue(patToken) && !patToken.includes('-----BEGIN'));
  const hasControlledTarget = hasRealValue(process.env.GITHUB_GLONDIASITES_OWNER) || hasRealValue(process.env.RENDER_GENERATED_SITES_REPO_URL);
  const githubImportReady = hasControlledCreds && hasControlledTarget;

  const dataDir = process.env.DATA_DIR || '';
  const buildTempDir = process.env.BUILD_TEMP_DIR || '';
  const [dataDirWritable, buildTempWritable] = await Promise.all([
    dirWritable(dataDir),
    buildTempDir ? dirWritable(buildTempDir) : Promise.resolve(true),
  ]);

  if (!databaseReady) missing.push('DATABASE (users table)');
  if (dataDir && !dataDirWritable) missing.push('DATA_DIR (not writable)');
  if (buildTempDir && !buildTempWritable) missing.push('BUILD_TEMP_DIR (not writable)');

  const readyForZipDeploy = Boolean(renderReady && githubPublisherReady && databaseReady && dataDirWritable);
  const readyForGithubDeploy = Boolean(renderReady && githubImportReady && databaseReady && dataDirWritable);

  return {
    providerMode: capabilities.mode,
    uploadProvider: capabilities.uploadProvider,
    domainProvider: capabilities.domainProvider,
    uploadProviderReason: capabilities.uploadProviderReason,
    providers: capabilities.providers,
    readyForZipDeploy,
    readyForGithubDeploy,
    databaseReady,
    billingReady,
    subscriptionReady,
    notificationReady,
    renderReady,
    githubPublisherReady,
    githubImportReady,
    dataDirWritable: dataDir ? dataDirWritable : null,
    buildTempWritable: buildTempDir ? buildTempWritable : null,
    missing: [...new Set(missing)],
  };
}

export default { checkDeployReadiness };
