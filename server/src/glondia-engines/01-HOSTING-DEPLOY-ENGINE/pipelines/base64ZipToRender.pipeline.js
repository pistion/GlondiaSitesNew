/**
 * Deprecated compatibility only. Do not use for new ZIP deploy flow.
 */
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import { makeId, mutateHostingStore, nowIso } from '../../../services/hostingStore.js';
import renderApiService from '../../../services/renderApiService.js';
import { publishGeneratedSiteToGitHub, resolveGitHubPublisherToken, parseGitHubRepoUrl } from '../03-GITHUB-SOURCE-MOUNTAIN/generatedSitesRepoPublisher.stage.js';
import { publishDirectoryToTemporaryRepo, shouldUseTemporaryRepo } from '../03-GITHUB-SOURCE-MOUNTAIN/temporaryRepoManager.stage.js';
import { detectEnvHints } from '../02-UNZIP-AND-DETECT-MOUNTAIN/envHintDetector.stage.js';
import { resolveDeployMode } from '../02-UNZIP-AND-DETECT-MOUNTAIN/deployModeResolver.stage.js';

// ── Provider constants ──────────────────────────────────────────────────────
// ZIP uploads are website/app hosting → always Render.
// Flow: upload ZIP → validate → extract → detect project → write build script
//       → push files to GitHub (RENDER_GENERATED_SITES_REPO_URL)
//       → create Render service from that GitHub repo → trigger deploy
// GitHub publish is required so Render has a real commit to build from.
// If RENDER_GENERATED_SITES_REPO_URL or GITHUB_GENERATED_SITES_TOKEN is not set,
// the GitHub step is skipped and Render is attempted with the existing repo content.
const HOSTING_PROVIDER = 'render';
// VPS_PROVIDER = 'vultr' — lives in vps routes/services only

const rootDir = resolve(process.cwd());
const dataDir = resolve(process.env.DATA_DIR || join(rootDir, '.glondia-data'));
const uploadedRoot = join(dataDir, 'uploaded-sites');

// ── Limits (applied AFTER cleanup, not before) ─────────────────────────────
const MAX_ZIP_BYTES       = Number(process.env.ZIP_UPLOAD_MAX_BYTES       || 100 * 1024 * 1024); // 100 MB
const MAX_EXTRACTED_FILES = Number(process.env.ZIP_UPLOAD_MAX_FILES       || 5000);               // 5000 deployable files
const MAX_ENTRY_BYTES     = Number(process.env.ZIP_UPLOAD_MAX_ENTRY_BYTES || 25 * 1024 * 1024);  // 25 MB per entry

// ── Folders/files to ALWAYS ignore (dangerous, heavy, or non-deployable) ────
const IGNORED_FOLDER_PREFIXES = [
  'node_modules/',
  '.git/',
  '.next/cache/',
  '.next/server/cache/',
  '.vercel/',
  '.netlify/',
  'coverage/',
  '.cache/',
  '.parcel-cache/',
  '.turbo/',
  '.vite/',
  'dist/.vite/',
  '__MACOSX/',
  '.idea/',
  '.vscode/',
  '.pnpm-store/',
  '.yarn/cache/',
];

const IGNORED_EXACT_FILES = [
  '.DS_Store',
  'Thumbs.db',
  'npm-debug.log',
  'yarn-error.log',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
];

// Untrusted user-uploaded executable scripts — never deploy these
const UNTRUSTED_SCRIPT_EXTENSIONS = ['.sh', '.bat', '.cmd', '.ps1'];
// Exception: the generated backend shell file is always kept
const GENERATED_SHELL_FILE = 'glondia-render-build.sh';

// ── Project type enum ───────────────────────────────────────────────────────
const PROJECT_TYPE = {
  VITE_SOURCE:     'vite-source',
  NEXT_SOURCE:     'next-source',
  CRA_SOURCE:      'cra-source',
  GATSBY_SOURCE:   'gatsby-source',
  VUE_SOURCE:      'vue-source',
  SVELTE_SOURCE:   'svelte-source',
  ASTRO_SOURCE:    'astro-source',
  REMIX_SOURCE:    'remix-source',
  NODE_SERVER:     'node-server',
  NODE_SOURCE:     'node-source',
  STATIC_ROOT:     'static-root-html',
  PREBUILT_DIST:   'prebuilt-dist',
  PREBUILT_BUILD:  'prebuilt-build',
  PREBUILT_OUT:    'prebuilt-out',
  UNKNOWN:         'unknown',
};

// ── Framework presets: build cmd, output dir, service type, runtime ─────────
const FRAMEWORK_PRESETS = {
  [PROJECT_TYPE.VITE_SOURCE]:    { framework: 'Vite',          buildCommand: 'npm run build', outputDirectory: 'dist',    serviceType: 'static_site' },
  [PROJECT_TYPE.NEXT_SOURCE]:    { framework: 'Next.js',       buildCommand: 'npm run build', outputDirectory: '.next',   serviceType: 'web_service', startCommand: 'npm start' },
  [PROJECT_TYPE.CRA_SOURCE]:     { framework: 'Create React App', buildCommand: 'npm run build', outputDirectory: 'build', serviceType: 'static_site' },
  [PROJECT_TYPE.GATSBY_SOURCE]:  { framework: 'Gatsby',        buildCommand: 'npm run build', outputDirectory: 'public',  serviceType: 'static_site' },
  [PROJECT_TYPE.VUE_SOURCE]:     { framework: 'Vue CLI',       buildCommand: 'npm run build', outputDirectory: 'dist',    serviceType: 'static_site' },
  [PROJECT_TYPE.SVELTE_SOURCE]:  { framework: 'SvelteKit',     buildCommand: 'npm run build', outputDirectory: 'build',   serviceType: 'web_service', startCommand: 'node build' },
  [PROJECT_TYPE.ASTRO_SOURCE]:   { framework: 'Astro',         buildCommand: 'npm run build', outputDirectory: 'dist',    serviceType: 'static_site' },
  [PROJECT_TYPE.REMIX_SOURCE]:   { framework: 'Remix',         buildCommand: 'npm run build', outputDirectory: 'build',   serviceType: 'web_service', startCommand: 'npm start' },
  [PROJECT_TYPE.NODE_SERVER]:    { framework: 'Node.js server', buildCommand: 'npm install',  outputDirectory: '.',       serviceType: 'web_service', startCommand: 'npm start' },
  [PROJECT_TYPE.NODE_SOURCE]:    { framework: 'Node static app', buildCommand: 'npm run build', outputDirectory: 'dist',  serviceType: 'static_site' },
  [PROJECT_TYPE.STATIC_ROOT]:    { framework: 'Static HTML',   buildCommand: null,            outputDirectory: '.',       serviceType: 'static_site' },
  [PROJECT_TYPE.PREBUILT_DIST]:  { framework: 'Prebuilt (dist)', buildCommand: null,          outputDirectory: 'dist',    serviceType: 'static_site' },
  [PROJECT_TYPE.PREBUILT_BUILD]: { framework: 'Prebuilt (build)', buildCommand: null,         outputDirectory: 'build',   serviceType: 'static_site' },
  [PROJECT_TYPE.PREBUILT_OUT]:   { framework: 'Prebuilt (out)', buildCommand: null,           outputDirectory: 'out',     serviceType: 'static_site' },
  [PROJECT_TYPE.UNKNOWN]:        { framework: 'Unknown',       buildCommand: null,            outputDirectory: 'dist',    serviceType: 'static_site' },
};

// ─────────────────────────────────────────────────────────────────────────────
// Helper functions: ignore / safety checks
// ─────────────────────────────────────────────────────────────────────────────

function shouldIgnoreZipEntry(relativeName) {
  const normalized = cleanZipPath(relativeName);
  const lower = normalized.toLowerCase();

  for (const prefix of IGNORED_FOLDER_PREFIXES) {
    if (lower.startsWith(prefix) || lower.includes(`/${prefix}`)) {
      return { ignore: true, reason: `ignored-folder: ${prefix}` };
    }
  }

  const baseName = lower.split('/').pop();
  for (const exact of IGNORED_EXACT_FILES) {
    if (baseName === exact.toLowerCase()) {
      return { ignore: true, reason: `ignored-file: ${exact}` };
    }
  }

  if (isUnsafeExecutable(relativeName)) {
    return { ignore: true, reason: 'untrusted-script' };
  }

  return { ignore: false, reason: '' };
}

function isUnsafeExecutable(relativeName) {
  const normalized = cleanZipPath(relativeName);
  const baseName = normalized.split('/').pop().toLowerCase();
  if (baseName === GENERATED_SHELL_FILE) return false;
  const ext = baseName.substring(baseName.lastIndexOf('.')).toLowerCase();
  return UNTRUSTED_SCRIPT_EXTENSIONS.includes(ext);
}

// ─────────────────────────────────────────────────────────────────────────────
// Source repo resolution — single source of truth
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the Render source repo URL from input or environment.
 * This is the repo Render will deploy FROM — the user must configure it.
 */
function resolveRenderSourceRepo(input = {}) {
  return (
    input.repoUrl ||
    input.repositoryUrl ||
    process.env.RENDER_GENERATED_SITES_REPO_URL ||
    process.env.GENERATED_SITES_REPO_URL ||
    ''
  ).trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Config diagnostics — used by GET /api/template-ai/zip/settings
// ─────────────────────────────────────────────────────────────────────────────

export function getZipDeployConfigStatus() {
  const renderApiConfigured = renderApiService.configured();
  const sourceRepo = (process.env.RENDER_GENERATED_SITES_REPO_URL || process.env.GENERATED_SITES_REPO_URL || '').trim();
  const renderSourceRepoConfigured = Boolean(sourceRepo);
  const { token: ghToken, error: ghTokenError } = resolveGitHubPublisherToken();
  const githubPublisherConfigured = Boolean(ghToken && !ghTokenError);

  const missing = [];
  if (!renderApiConfigured) missing.push('RENDER_API_KEY and/or RENDER_OWNER_ID');
  if (!renderSourceRepoConfigured) missing.push('RENDER_GENERATED_SITES_REPO_URL');
  if (!githubPublisherConfigured) missing.push('GITHUB_GENERATED_SITES_TOKEN');

  return {
    provider: HOSTING_PROVIDER,
    renderApiConfigured,
    renderSourceRepoConfigured,
    githubPublisherConfigured,
    githubTokenError: ghTokenError || null,
    missing,
    expectedEnv: [
      'RENDER_API_KEY',
      'RENDER_OWNER_ID',
      'RENDER_GENERATED_SITES_REPO_URL',
      'GITHUB_GENERATED_SITES_TOKEN',
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

export async function deployZipSite(input = {}) {
  const fileName = sanitizeFileName(input.fileName || 'uploaded-site.zip');
  const userId = input.userId || input.user_id || 'local-user';
  const base64 = String(input.fileBase64 || '').replace(/^data:.*?;base64,/, '');
  if (!base64) throw badRequest('fileBase64 is required.', 'ZIP_NO_DATA');

  const zipBuffer = Buffer.from(base64, 'base64');
  if (!zipBuffer.length) throw badRequest('Uploaded ZIP is empty.', 'ZIP_EMPTY');
  if (zipBuffer.length > MAX_ZIP_BYTES) throw badRequest(`ZIP is too large. Max size is ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB.`, 'ZIP_TOO_LARGE');

  const siteName = String(input.siteName || fileName.replace(/\.zip$/i, '') || 'uploaded-site').trim();
  const finalSlug = slugify(input.slug || siteName);
  const branch = input.branch || 'main';
  // serviceType resolved after detection — placeholder here, overridden below
  let serviceType = input.serviceType || null;
  // Launch-first rule: every new deployment starts on the free plan. Defaulting
  // to a paid plan ('starter') here made Render reject the create when billing
  // wasn't set up — surfacing as an "unexpected" ZIP deploy failure.
  const plan = input.plan || process.env.RENDER_INITIAL_PLAN || 'free';
  const region = input.region || null;
  const environment = input.environment || 'production';
  const runtime = input.runtime || null;
  const healthCheckPath = input.healthCheckPath || null;
  const pullRequestPreviewsEnabled = input.pullRequestPreviewsEnabled || 'no';
  // envVars: array of { key, value } — validated and sanitised below
  const envVars = Array.isArray(input.envVars)
    ? input.envVars.filter((v) => v && String(v.key || '').trim())
    : [];
  // disk: { name, mountPath, sizeGB } — web services only
  const disk = input.disk && typeof input.disk === 'object' && input.disk.mountPath
    ? { name: String(input.disk.name || 'data'), mountPath: String(input.disk.mountPath), sizeGB: Number(input.disk.sizeGB || 1) }
    : null;
  const deploymentId = makeId('dep');
  const uploadId = makeId('zip');
  const siteDir = join(uploadedRoot, uploadId);
  const now = nowIso();

  console.log(`[zip-deploy] ZIP received: ${fileName}, size=${formatBytes(zipBuffer.length)}`);

  await rm(siteDir, { recursive: true, force: true });
  await mkdir(siteDir, { recursive: true });

  // 1. Extract safely — filter FIRST, count AFTER
  const extracted = await extractZipSafely(zipBuffer, siteDir);
  console.log(`[zip-deploy] Raw entries: ${extracted.rawEntryCount}, ignored: ${extracted.ignoredFiles.length}, deployable: ${extracted.files.length}`);
  if (extracted.ignoredFolderExamples.length > 0) {
    console.log(`[zip-deploy] Ignored folder examples: ${extracted.ignoredFolderExamples.join(', ')}`);
  }

  // 2. Detect project type (deep package.json analysis)
  const detected = detectProject(extracted.files, siteDir);
  console.log(`[zip-deploy] Detected: ${detected.type} | framework=${detected.framework} | pm=${detected.packageManager} | serviceType=${detected.detectedServiceType}`);

  // 3. Auto-resolve deployment settings from detection
  serviceType = resolveServiceType(detected, serviceType);
  const publishDirectory = resolvePublishDirectory(detected, input.publishDirectory);
  const startCommand = detected.detectedStartCommand || input.startCommand || null;
  console.log(`[zip-deploy] Resolved: serviceType=${serviceType} publishDir=${publishDirectory}${startCommand ? ` startCmd=${startCommand}` : ''}`);

  // 4. Write the deterministic Render build shell file
  const shellFile = await writeRenderShellFile(siteDir, { detected, publishDirectory, requestedBuildCommand: input.buildCommand || '' });
  console.log(`[zip-deploy] Shell file written: ${shellFile.relativePath}`);

  // 5. Create source artifact record
  const sourceArtifact = await createSourceArtifactRecord({
    uploadId, fileName, zipBuffer, extracted, detected, shellFile,
    siteName, finalSlug, publishDirectory, siteDir, now,
  });

  // 6. GitHub publish step — push extracted files to the generated-sites repo
  // so Render can build from a real commit. This is required for the ZIP→GitHub→Render flow.
  const sourceRepo = resolveRenderSourceRepo(input);
  const buildCommand = 'bash glondia-render-build.sh';
  // targetRoot is the subdirectory in the generated-sites repo where this
  // site's files live. Always include the site slug so each upload gets its
  // own directory and doesn't overwrite others.
  // If the caller provides a full rootDirectory path, use it as-is.
  // Otherwise combine the base dir (env or default) with the slug.
  const rootBase = (process.env.RENDER_GENERATED_SITES_ROOT_DIR || 'uploaded-sites').replace(/\/+$/, '');
  const targetRoot = input.rootDirectory || `${rootBase}/${finalSlug}`;
  const useTemporaryRepo = shouldUseTemporaryRepo(input);
  let activeSourceRepo = sourceRepo;
  let activeTargetRoot = targetRoot;
  let activeBranch = branch;
  let temporaryRepo = null;

  let githubPublish = { attempted: false, skippedReason: null };
  const { token: ghToken, error: ghTokenError } = resolveGitHubPublisherToken();
  const parsedRepo = parseGitHubRepoUrl(sourceRepo);

  if (useTemporaryRepo && ghTokenError) {
    githubPublish.skippedReason = `GitHub publisher token error: ${ghTokenError}`;
    activeSourceRepo = '';
    console.log(`[zip-deploy] GitHub publish skipped: ${githubPublish.skippedReason}`);
  } else if (useTemporaryRepo) {
    try {
      console.log(`[zip-deploy] Creating temporary GitHub repo for ${finalSlug}...`);
      temporaryRepo = await publishDirectoryToTemporaryRepo({
        directory: siteDir,
        slug: finalSlug,
        branch,
        token: ghToken,
        owner: input.temporaryRepoOwner || input.githubOwner,
        name: input.temporaryRepoName,
        privateRepo: input.temporaryRepoPrivate !== false && input.temporaryRepoPrivate !== 'false',
      });
      activeSourceRepo = temporaryRepo.repoUrl;
      activeTargetRoot = '';
      activeBranch = temporaryRepo.branch || branch;
      githubPublish = temporaryRepo.githubPublish;
      console.log(`[zip-deploy] Temporary GitHub repo publish: ${githubPublish.published?.length ?? 0} files published`);
    } catch (ghError) {
      githubPublish.attempted = true;
      githubPublish.error = { message: ghError.message, status: ghError.status, details: ghError.details || null };
      activeSourceRepo = '';
      console.warn(`[zip-deploy] Temporary GitHub repo publish failed (non-fatal): ${ghError.message}`);
    }
  } else if (!sourceRepo || !parsedRepo) {
    githubPublish.skippedReason = 'Missing or invalid RENDER_GENERATED_SITES_REPO_URL — GitHub publish skipped.';
    console.log(`[zip-deploy] GitHub publish skipped: ${githubPublish.skippedReason}`);
  } else if (ghTokenError) {
    githubPublish.skippedReason = `GitHub publisher token error: ${ghTokenError}`;
    console.log(`[zip-deploy] GitHub publish skipped: ${githubPublish.skippedReason}`);
  } else {
    try {
      console.log(`[zip-deploy] Publishing extracted files to GitHub ${parsedRepo.owner}/${parsedRepo.repo} at ${targetRoot}...`);
      githubPublish = await publishGeneratedSiteToGitHub({
        siteDir,
        repoUrl: sourceRepo,
        branch,
        targetRoot,
        commitMessage: `Glondiasites: publish ZIP upload ${finalSlug} (${fileName})`,
      });
      console.log(`[zip-deploy] GitHub publish: ${githubPublish.publishedCount ?? 0} files published, ${githubPublish.errors?.length ?? 0} errors`);
    } catch (ghError) {
      githubPublish.attempted = true;
      githubPublish.error = { message: ghError.message, status: ghError.status, details: ghError.details || null };
      console.warn(`[zip-deploy] GitHub publish failed (non-fatal): ${ghError.message}`);
    }
  }

  // 7. Render handoff — create service from GitHub repo, then trigger deploy
  let renderServiceId = makeId('render_svc_pending');
  let renderDeployId = makeId('render_deploy_pending');
  let render = { configured: renderApiService.configured(), attempted: false, skippedReason: null };
  let providerStatus = 'prepared';
  let status = 'prepared';
  let buildStatus = 'uploaded';
  let currentStep = 'ZIP extracted and stored';
  let liveUrl = `https://${finalSlug}.onrender.com`;
  let errorMessage = null;

  if (!renderApiService.configured()) {
    render.skippedReason = 'Render API credentials are missing. Set RENDER_API_KEY and RENDER_OWNER_ID.';
  } else if (!activeSourceRepo) {
    render.skippedReason = 'Missing source repository URL. Set RENDER_GENERATED_SITES_REPO_URL in environment or enter a repository URL in the deploy form.';
  } else {
    // Attempt Render deploy regardless of GitHub publish outcome.
    // If GitHub push failed, Render will build from the existing repo content.
    if (githubPublish.errors?.length) {
      console.warn('[zip-deploy] GitHub publish had errors — proceeding to Render with existing repo content.');
    }
    try {
      console.log(`[zip-deploy] Starting Render handoff for ${finalSlug}...`);
      render.attempted = true;
      const serviceResponse = await renderApiService.createService({
        // ── Identity ─────────────────────────────────────────────────────
        serviceName: finalSlug,
        serviceType,
        // ── Infrastructure ───────────────────────────────────────────────
        // Launch-first rule: a user ZIP upload always launches on the free plan.
        // The trusted intent — not raw `plan` — is what the payload builder honours.
        renderPlanIntent: 'trial_free',
        plan,
        region: region || undefined,
        // ── Source ───────────────────────────────────────────────────────
        repoUrl: activeSourceRepo,
        branch: activeBranch,
        // rootDirectory must match targetRoot so Render cds into the right
        // subdirectory and finds glondia-render-build.sh.
        rootDirectory: activeTargetRoot,
        sourceReference: activeSourceRepo,
        framework: detected.framework,
        // ── Build / runtime ──────────────────────────────────────────────
        buildCommand,
        outputDirectory: publishDirectory,
        startCommand: startCommand || undefined,
        runtime: runtime || (detected.detectedServiceType === 'web_service' ? 'node' : undefined),
        healthCheckPath: healthCheckPath || undefined,
        pullRequestPreviewsEnabled,
        // ── Environment variables (user-provided + GLONDIA_SITE_SLUG) ────
        envVars: envVars.length ? envVars : undefined,
        // ── Persistent disk (web services only) ──────────────────────────
        disk: disk || undefined,
        // Fallback env var — root dispatcher reads this if rootDir is dropped
        siteSlug: finalSlug,
      });
      renderServiceId = serviceResponse?.service?.id || serviceResponse?.id || renderServiceId;
      const deployResponse = await renderApiService.triggerDeploy(renderServiceId, { deployMode: 'build_and_deploy' });
      renderDeployId = deployResponse?.deploy?.id || deployResponse?.id || renderDeployId;
      providerStatus = deployResponse?.deploy?.status || deployResponse?.status || 'accepted';
      status = renderDeployId ? 'building' : 'preparing';
      buildStatus = renderDeployId ? 'queued' : 'accepted';
      currentStep = renderDeployId ? 'Queued in Render' : 'Sent to Render';
      liveUrl = serviceResponse?.service?.serviceDetails?.url || serviceResponse?.service?.url || serviceResponse?.url || liveUrl;
      render.serviceResponse = serviceResponse;
      render.deployResponse = deployResponse;
      console.log(`[zip-deploy] Render deploy ${renderDeployId} started`);
    } catch (error) {
      providerStatus = 'handoff_failed';
      status = 'deployed_unverified';
      buildStatus = 'uploaded';
      currentStep = 'ZIP extracted and stored; Render handoff failed';
      errorMessage = error.message || 'Render handoff failed.';
      render.error = { message: error.message, status: error.status, details: error.details || null };
      console.log(`[zip-deploy] Render handoff failed: ${errorMessage}`);
    }
  }

  if (render.skippedReason) {
    console.log(`[zip-deploy] Render handoff skipped: ${render.skippedReason}`);
  }

  const generatedSite = {
    siteDir,
    sourceType: 'uploaded-zip-source-artifact',
    projectType: detected.type,
    framework: detected.framework,
    packageManager: detected.packageManager,
    buildCommand,
    publishDirectory,
    shellFile: shellFile.relativePath,
    files: extracted.files,
    ignoredFiles: extracted.ignoredFiles,
    uploadedFileName: fileName,
    uploadedAt: now,
    sourceArtifact,
    githubTargetRoot: activeTargetRoot,
    sourceRepository: activeSourceRepo || null,
    temporaryRepo: temporaryRepo ? {
      repoUrl: temporaryRepo.repoUrl,
      fullName: temporaryRepo.fullName,
      private: temporaryRepo.private,
      archived: temporaryRepo.archived,
    } : null,
    githubPublish: githubPublish || null,
  };

  // 8. Persist deployment record + logs
  await mutateHostingStore((store) => {
    if (!store.uploadedSiteArtifacts) store.uploadedSiteArtifacts = [];
    store.uploadedSiteArtifacts.push({
      uploadId,
      deploymentId,
      originalFileName: fileName,
      originalZipBytes: zipBuffer.length,
      extractedPath: siteDir,
      rawEntryCount: extracted.rawEntryCount,
      deployableFiles: extracted.files,
      ignoredFiles: extracted.ignoredFiles,
      detectedProjectType: detected.type,
      chosenBuildCommand: buildCommand,
      chosenPublishDirectory: publishDirectory,
      generatedShellFilePath: shellFile.relativePath,
      createdAt: now,
    });

    store.deployments.unshift({
      id: deploymentId,
      deploymentId,
      userId,
      platformDeployed: true,
      siteId: uploadId,
      serviceName: finalSlug,
      siteName,
      serviceType,
      plan,
      provider: HOSTING_PROVIDER,
      providerStatus,
      status,
      buildStatus,
      currentStep,
      source: 'zip-upload',
      sourceReference: fileName,
      renderServiceId,
      renderDeployId,
      liveUrl,
      verifiedUrl: null,
      urlReachable: false,
      errorMessage,
      deploymentLogsReference: deploymentId,
      generatedSite,
      render,
      environmentConfiguration: {
        environment,
        branch,
        rootDirectory: activeTargetRoot,
        buildCommand,
        outputDirectory: publishDirectory,
        startCommand: startCommand || null,
        runtime: runtime || null,
        region: region || null,
        healthCheckPath: healthCheckPath || null,
        pullRequestPreviewsEnabled,
        framework: detected.framework,
        detectedProjectType: detected.type,
        packageManager: detected.packageManager,
        nodeVersion: detected.nodeVersion || null,
        sourceRepository: activeSourceRepo || null,
        providerTarget: HOSTING_PROVIDER,
        envVarsCount: envVars.length,
        hasDisk: Boolean(disk),
      },
      environmentVariablesMetadata: [],
      diskMetadata: [],
      domainMetadata: [],
      createdAt: now,
      updatedAt: now,
      lastDeployedAt: null,
    });

    const logs = [
      makeLog(`ZIP upload received: ${fileName} (${formatBytes(zipBuffer.length)}).`, 'info'),
      makeLog(`Raw ZIP entries: ${extracted.rawEntryCount}. Ignored: ${extracted.ignoredFiles.length}. Deployable: ${extracted.files.length}.`, 'info'),
      ...(extracted.ignoredFolderExamples.length > 0
        ? [makeLog(`Ignored folder examples: ${extracted.ignoredFolderExamples.join(', ')}.`, 'info')]
        : []),
      makeLog(`Extracted ${extracted.files.length} deployable files into ${siteDir}.`, 'ok'),
      makeLog(`Detected: ${detected.type} | framework=${detected.framework} | pm=${detected.packageManager}${detected.nodeVersion ? ` | node=${detected.nodeVersion}` : ''}.`, 'info'),
      makeLog(`Auto-resolved: serviceType=${serviceType} | publishDir=${publishDirectory}${startCommand ? ` | startCmd=${startCommand}` : ''}.`, 'info'),
      makeLog(`Render build command: ${buildCommand}.`, 'info'),
      makeLog(`Shell file written: ${shellFile.relativePath}.`, 'ok'),
      makeLog(`Source artifact manifest stored at ${sourceArtifact.manifestPath}.`, 'ok'),
    ];

    // GitHub publish log
    if (githubPublish.attempted && githubPublish.publishedCount > 0 && !githubPublish.errors?.length) {
      logs.push(makeLog(`Published ${githubPublish.publishedCount} files to GitHub at ${githubPublish.repository}/${activeTargetRoot}.`, 'ok'));
    } else if (githubPublish.attempted && githubPublish.errors?.length) {
      logs.push(makeLog(`GitHub publish completed with ${githubPublish.errors.length} error(s). First: ${githubPublish.errors[0]?.message}`, 'warn'));
    } else if (githubPublish.skippedReason) {
      logs.push(makeLog(`GitHub publish skipped: ${githubPublish.skippedReason}`, 'warn'));
    }

    if (render.attempted && !errorMessage) logs.push(makeLog(`Render deploy ${renderDeployId} started for ${finalSlug}.`, 'ok'));
    if (render.attempted && errorMessage) logs.push(makeLog(`Render handoff failed: ${errorMessage}`, 'warn'));
    if (!render.attempted) logs.push(makeLog(render.skippedReason || 'Render handoff skipped.', 'warn'));
    store.logs[deploymentId] = logs;
  });

  return {
    status,
    deploymentId,
    siteId: uploadId,
    generatedSite,
    render,
    githubPublish,
    liveUrl,
    message: render.attempted && !errorMessage
      ? 'ZIP extracted, stored, pushed to GitHub, and Render deployment started.'
      : 'ZIP extracted and stored. Hosting record created. Check Hosting logs for Render configuration status.',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validate-only endpoint (no deployment)
// ─────────────────────────────────────────────────────────────────────────────

export async function validateZipSite(input = {}) {
  const fileName = sanitizeFileName(input.fileName || 'uploaded-site.zip');
  const base64 = String(input.fileBase64 || '').replace(/^data:.*?;base64,/, '');
  if (!base64) throw badRequest('fileBase64 is required.', 'ZIP_NO_DATA');

  const zipBuffer = Buffer.from(base64, 'base64');
  if (!zipBuffer.length) throw badRequest('Uploaded ZIP is empty.', 'ZIP_EMPTY');
  if (zipBuffer.length > MAX_ZIP_BYTES) throw badRequest(`ZIP is too large. Max size is ${Math.round(MAX_ZIP_BYTES / 1024 / 1024)} MB.`, 'ZIP_TOO_LARGE');

  const tmpDir = join(dataDir, 'zip-validate-tmp', makeId('val'));
  await mkdir(tmpDir, { recursive: true });

  try {
    const extracted = await extractZipSafely(zipBuffer, tmpDir);
    const detected = detectProject(extracted.files, tmpDir);
    const publishDirectory = resolvePublishDirectory(detected);
    const serviceType = resolveServiceType(detected);

    // Advisory env-variable hints so the preview can warn about missing config.
    const envHints = await detectEnvHints(tmpDir, extracted.files).catch(() => ({
      requiredEnv: [], optionalEnv: [], publicEnv: [], databaseHints: [], riskLevel: 'low', messages: [],
    }));

    // Deploy-mode preview: the recommended (auto) mode plus the alternatives the
    // user can pick on the upload screen.
    const resolved = resolveDeployMode({
      detected: { ...detected, serviceType, publishDirectory, startCommand: detected.detectedStartCommand },
      files: extracted.files,
      selectedMode: 'auto',
    });

    return {
      valid: true,
      fileName,
      zipBytes: zipBuffer.length,
      rawEntryCount: extracted.rawEntryCount,
      fileCount: extracted.files.length,
      ignoredFileCount: extracted.ignoredFiles.length,
      detectedProjectType: detected.type,
      framework: detected.framework,
      packageManager: detected.packageManager,
      serviceType,
      publishDirectory,
      buildCommand: detected.detectedBuildCommand || null,
      startCommand: detected.detectedStartCommand || null,
      runtime: detected.detectedServiceType === 'web_service' ? 'node' : null,
      nodeVersion: detected.nodeVersion || null,
      deployableFiles: extracted.files,
      ignoredFiles: extracted.ignoredFiles,
      ignoredFolderExamples: extracted.ignoredFolderExamples,
      envHints,
      recommendedMode: resolved.mode,
      alternatives: resolved.alternatives,
      warnings: resolved.warnings,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZIP extraction — filter FIRST, count AFTER, keeps dist/build/public/assets
// ─────────────────────────────────────────────────────────────────────────────

async function extractZipSafely(zipBuffer, destination) {
  const zip = new AdmZip(zipBuffer);
  const allEntries = zip.getEntries().filter(entry => !entry.isDirectory);
  const rawEntryCount = allEntries.length;

  if (rawEntryCount === 0) throw badRequest('ZIP does not contain any files.', 'ZIP_NO_FILES');

  console.log(`[zip-extract] Raw ZIP file entries (before filtering): ${rawEntryCount}`);

  const rootPrefix = detectRootPrefix(allEntries.map(entry => entry.entryName));
  const files = [];
  const ignoredFiles = [];
  const ignoredFolderSet = new Set();

  for (const entry of allEntries) {
    const relativeName = cleanZipPath(rootPrefix ? entry.entryName.slice(rootPrefix.length) : entry.entryName);
    if (!relativeName || relativeName.endsWith('/')) continue;

    const ignoreCheck = shouldIgnoreZipEntry(relativeName);
    if (ignoreCheck.ignore) {
      ignoredFiles.push({ path: relativeName, reason: ignoreCheck.reason });
      const folderMatch = ignoreCheck.reason.match(/^ignored-folder: (.+)/);
      if (folderMatch) ignoredFolderSet.add(folderMatch[1]);
      continue;
    }

    if (entry.header.size > MAX_ENTRY_BYTES) {
      throw badRequest(
        `ZIP entry is too large: ${entry.entryName} (${formatBytes(entry.header.size)}). Max per file is ${formatBytes(MAX_ENTRY_BYTES)}.`,
        'ZIP_ENTRY_TOO_LARGE',
      );
    }

    const outputPath = resolve(destination, relativeName);
    if (!outputPath.startsWith(destination)) {
      throw badRequest(`Unsafe ZIP path detected: ${entry.entryName}`, 'ZIP_PATH_TRAVERSAL');
    }

    await mkdir(join(outputPath, '..'), { recursive: true });
    await writeFile(outputPath, entry.getData());
    files.push(relativeName);
  }

  console.log(`[zip-extract] After filtering: ${files.length} deployable, ${ignoredFiles.length} ignored`);

  if (files.length > MAX_EXTRACTED_FILES) {
    const err = badRequest(
      `ZIP has too many deployable files after cleanup. Deployable files: ${files.length}. Max: ${MAX_EXTRACTED_FILES}.`,
      'ZIP_TOO_MANY_DEPLOYABLE_FILES',
    );
    err.details = {
      rawEntries: rawEntryCount,
      ignoredFiles: ignoredFiles.length,
      deployableFiles: files.length,
      maxDeployableFiles: MAX_EXTRACTED_FILES,
    };
    throw err;
  }

  const hasDeployableEntry = files.some(name =>
    name === 'package.json' ||
    name === 'index.html' ||
    name === 'dist/index.html' ||
    name === 'build/index.html' ||
    name === 'public/index.html'
  );
  if (!hasDeployableEntry) {
    throw badRequest(
      'ZIP must contain package.json, index.html, dist/index.html, build/index.html, or public/index.html.',
      'ZIP_NO_DEPLOYABLE_ENTRY',
    );
  }

  const ignoredFolderExamples = Array.from(ignoredFolderSet).slice(0, 10);

  return { files, ignoredFiles, rawEntryCount, ignoredFolderExamples };
}

// ─────────────────────────────────────────────────────────────────────────────
// Project type detection
// ─────────────────────────────────────────────────────────────────────────────

function detectProject(files, siteDir) {
  const hasPackage     = files.some(n => n === 'package.json');
  const hasViteConfig  = files.some(n => /^vite\.config\.(js|ts|mjs|mts|cjs)$/i.test(n));
  const hasNextConfig  = files.some(n => /^next\.config\.(js|ts|mjs|mts|cjs)$/i.test(n));
  const hasGatsbyConf  = files.some(n => /^gatsby-config\.(js|ts|mjs)$/i.test(n));
  const hasAstroConf   = files.some(n => /^astro\.config\.(js|ts|mjs)$/i.test(n));
  const hasSvelteConf  = files.some(n => /^svelte\.config\.(js|ts)$/i.test(n));
  const hasRemixConf   = files.some(n => /^remix\.config\.(js|ts)$/i.test(n));
  const hasRootIndex   = files.some(n => n === 'index.html');
  const hasDistIndex   = files.some(n => n === 'dist/index.html');
  const hasBuildIndex  = files.some(n => n === 'build/index.html');
  const hasOutIndex    = files.some(n => n === 'out/index.html');
  const hasNpmLock     = files.some(n => n === 'package-lock.json');
  const hasYarnLock    = files.some(n => n === 'yarn.lock');
  const hasPnpmLock    = files.some(n => n === 'pnpm-lock.yaml');
  const hasNvmrc       = files.some(n => n === '.nvmrc');
  const hasNodeVersion = files.some(n => n === '.node-version');

  const packageManager = hasPnpmLock ? 'pnpm' : hasYarnLock ? 'yarn' : 'npm';
  const hasLockFile = hasNpmLock || hasYarnLock || hasPnpmLock;

  let pkg = null;
  if (hasPackage && siteDir) {
    try { pkg = JSON.parse(readFileSync(join(siteDir, 'package.json'), 'utf8')); } catch { /* ignored */ }
  }

  const allDeps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const scripts = pkg?.scripts || {};
  const nodeVersion = pkg?.engines?.node || null;

  const base = { packageManager, hasLockFile, nodeVersion, hasNvmrc, hasNodeVersion, pkg: pkg ? { name: pkg.name, scripts: Object.keys(scripts), engines: pkg.engines } : null };

  if (hasPackage) {
    // Config-file detection takes priority — most specific first
    if (hasNextConfig || allDeps['next'])
      return { type: PROJECT_TYPE.NEXT_SOURCE, ...presetFor(PROJECT_TYPE.NEXT_SOURCE), ...base };

    if (hasGatsbyConf || allDeps['gatsby'])
      return { type: PROJECT_TYPE.GATSBY_SOURCE, ...presetFor(PROJECT_TYPE.GATSBY_SOURCE), ...base };

    if (hasAstroConf || allDeps['astro'])
      return { type: PROJECT_TYPE.ASTRO_SOURCE, ...presetFor(PROJECT_TYPE.ASTRO_SOURCE), ...base };

    if (hasSvelteConf || allDeps['@sveltejs/kit'])
      return { type: PROJECT_TYPE.SVELTE_SOURCE, ...presetFor(PROJECT_TYPE.SVELTE_SOURCE), ...base };

    if (hasRemixConf || allDeps['@remix-run/node'] || allDeps['@remix-run/react'])
      return { type: PROJECT_TYPE.REMIX_SOURCE, ...presetFor(PROJECT_TYPE.REMIX_SOURCE), ...base };

    if (hasViteConfig || allDeps['vite'])
      return { type: PROJECT_TYPE.VITE_SOURCE, ...presetFor(PROJECT_TYPE.VITE_SOURCE), ...base };

    if (allDeps['react-scripts'])
      return { type: PROJECT_TYPE.CRA_SOURCE, ...presetFor(PROJECT_TYPE.CRA_SOURCE), ...base };

    if (allDeps['vue'] && (allDeps['@vue/cli-service'] || hasViteConfig))
      return { type: PROJECT_TYPE.VUE_SOURCE, ...presetFor(PROJECT_TYPE.VUE_SOURCE), ...base };

    // Server detection — Express, Fastify, Hapi, Koa, NestJS
    const serverDeps = ['express', 'fastify', '@hapi/hapi', 'koa', '@nestjs/core'];
    const isServer = serverDeps.some(d => allDeps[d]) || scripts.start;
    const hasNoBuild = !scripts.build;
    if (isServer && hasNoBuild)
      return { type: PROJECT_TYPE.NODE_SERVER, ...presetFor(PROJECT_TYPE.NODE_SERVER), ...base };

    // Generic Node project with a build script
    return { type: PROJECT_TYPE.NODE_SOURCE, ...presetFor(PROJECT_TYPE.NODE_SOURCE), ...base };
  }

  // No package.json — prebuilt or static
  if (hasDistIndex) return { type: PROJECT_TYPE.PREBUILT_DIST, ...presetFor(PROJECT_TYPE.PREBUILT_DIST), ...base };
  if (hasBuildIndex) return { type: PROJECT_TYPE.PREBUILT_BUILD, ...presetFor(PROJECT_TYPE.PREBUILT_BUILD), ...base };
  if (hasOutIndex) return { type: PROJECT_TYPE.PREBUILT_OUT, ...presetFor(PROJECT_TYPE.PREBUILT_OUT), ...base };
  if (hasRootIndex) return { type: PROJECT_TYPE.STATIC_ROOT, ...presetFor(PROJECT_TYPE.STATIC_ROOT), ...base };
  return { type: PROJECT_TYPE.UNKNOWN, ...presetFor(PROJECT_TYPE.UNKNOWN), ...base };
}

function presetFor(type) {
  const p = FRAMEWORK_PRESETS[type] || FRAMEWORK_PRESETS[PROJECT_TYPE.UNKNOWN];
  return { framework: p.framework, detectedBuildCommand: p.buildCommand, detectedOutputDirectory: p.outputDirectory, detectedServiceType: p.serviceType, detectedStartCommand: p.startCommand || null };
}

function resolvePublishDirectory(detected, userOverride) {
  if (userOverride && String(userOverride).trim()) return String(userOverride).trim();
  return detected.detectedOutputDirectory || FRAMEWORK_PRESETS[detected.type]?.outputDirectory || 'dist';
}

function resolveServiceType(detected, userOverride) {
  if (userOverride && String(userOverride).trim()) return String(userOverride).trim();
  return detected.detectedServiceType || FRAMEWORK_PRESETS[detected.type]?.serviceType || 'static_site';
}

// ─────────────────────────────────────────────────────────────────────────────
// Render build shell file — deterministic, never trusts user scripts
// ─────────────────────────────────────────────────────────────────────────────

async function writeRenderShellFile(siteDir, { detected, publishDirectory, requestedBuildCommand }) {
  const relativePath = 'glondia-render-build.sh';
  const userBuild = String(requestedBuildCommand || '').trim();
  const buildCmd = userBuild || defaultBuildCommand(detected);
  const pm = detected.packageManager || 'npm';

  // Package lifecycle scripts (preinstall/install/postinstall/prepare) are
  // never executed for customer source — installs run with --ignore-scripts.
  const installCmd = pm === 'pnpm'
    ? (detected.hasLockFile ? 'pnpm install --frozen-lockfile --ignore-scripts' : 'pnpm install --ignore-scripts')
    : pm === 'yarn'
      ? (detected.hasLockFile ? 'yarn install --frozen-lockfile --ignore-scripts' : 'yarn install --ignore-scripts')
      : (detected.hasLockFile ? 'npm ci --ignore-scripts' : 'npm install --ignore-scripts');

  const runBuild = pm === 'pnpm' ? buildCmd.replace(/^npm run /, 'pnpm run ') : pm === 'yarn' ? buildCmd.replace(/^npm run /, 'yarn ') : buildCmd;

  // Node version setup block — uses .nvmrc, .node-version, or engines.node
  let nodeSetup = '';
  if (detected.hasNvmrc || detected.hasNodeVersion || detected.nodeVersion) {
    nodeSetup = `
# Auto-detected Node version requirement
if command -v nvm &>/dev/null; then
  ${detected.hasNvmrc ? 'nvm install && nvm use' : detected.hasNodeVersion ? 'nvm install $(cat .node-version) && nvm use $(cat .node-version)' : detected.nodeVersion ? `nvm install "${detected.nodeVersion}" && nvm use "${detected.nodeVersion}"` : ''}
  echo "Node version: $(node --version)"
elif [ -n "$NODE_VERSION" ]; then
  echo "Node version set by environment: $NODE_VERSION"
else
  echo "Node version: $(node --version) (Render default)"
fi
`;
  }

  // pnpm needs corepack enable on Render
  let pmSetup = '';
  if (pm === 'pnpm') {
    pmSetup = `
echo "Enabling pnpm via corepack..."
corepack enable
corepack prepare pnpm@latest --activate 2>/dev/null || true
`;
  } else if (pm === 'yarn') {
    pmSetup = `
echo "Ensuring yarn is available..."
corepack enable 2>/dev/null || true
`;
  }

  let scriptBody;
  const isSourceProject = [
    PROJECT_TYPE.VITE_SOURCE, PROJECT_TYPE.NEXT_SOURCE, PROJECT_TYPE.CRA_SOURCE,
    PROJECT_TYPE.GATSBY_SOURCE, PROJECT_TYPE.VUE_SOURCE, PROJECT_TYPE.SVELTE_SOURCE,
    PROJECT_TYPE.ASTRO_SOURCE, PROJECT_TYPE.REMIX_SOURCE, PROJECT_TYPE.NODE_SOURCE,
    PROJECT_TYPE.NODE_SERVER,
  ].includes(detected.type);

  if (isSourceProject) {
    scriptBody = `
echo "Source project detected (${detected.framework}, ${pm})"
${nodeSetup}${pmSetup}
if [ -f package.json ]; then
  echo "Installing dependencies with ${pm}..."
  ${installCmd}
  echo "Running build: ${runBuild}"
  ${runBuild}
else
  echo "ERROR: package.json expected but not found"
  exit 1
fi
`;
  } else if (detected.type === PROJECT_TYPE.STATIC_ROOT) {
    scriptBody = `
echo "Static HTML site detected (no package.json)"
mkdir -p "${publishDirectory}"
shopt -s extglob dotglob
cp -R !("${publishDirectory}"|"glondia-render-build.sh"|"glondia-upload-artifact.json") "${publishDirectory}/" 2>/dev/null || true
shopt -u dotglob
echo "Static files copied to ${publishDirectory}/"
`;
  } else if (detected.type === PROJECT_TYPE.PREBUILT_DIST) {
    scriptBody = `
echo "Prebuilt site detected in dist/"
if [ ! -f dist/index.html ]; then
  echo "ERROR: dist/index.html not found"
  exit 1
fi
echo "dist/index.html confirmed — nothing to build"
`;
  } else if (detected.type === PROJECT_TYPE.PREBUILT_BUILD) {
    scriptBody = `
echo "Prebuilt site detected in build/"
if [ ! -f build/index.html ]; then
  echo "ERROR: build/index.html not found"
  exit 1
fi
echo "build/index.html confirmed — nothing to build"
`;
  } else if (detected.type === PROJECT_TYPE.PREBUILT_OUT) {
    scriptBody = `
echo "Prebuilt site detected in out/"
if [ ! -f out/index.html ]; then
  echo "ERROR: out/index.html not found"
  exit 1
fi
echo "out/index.html confirmed — nothing to build"
`;
  } else {
    scriptBody = `
echo "Unknown project type — attempting static copy"
mkdir -p "${publishDirectory}"
shopt -s extglob dotglob
cp -R !("${publishDirectory}"|"glondia-render-build.sh"|"glondia-upload-artifact.json") "${publishDirectory}/" 2>/dev/null || true
shopt -u dotglob
`;
  }

  const content = `#!/usr/bin/env bash
set -euo pipefail

echo "=== Glondia ZIP source artifact build ==="
echo "Project type: ${detected.type}"
echo "Framework: ${detected.framework}"
echo "Package manager: ${pm}"
echo "Publish directory: ${publishDirectory}"
${scriptBody.trim()}

echo "=== Glondia build finished ==="
`;
  await writeFile(join(siteDir, relativePath), content, 'utf8');
  return { relativePath, command: 'bash glondia-render-build.sh' };
}

function defaultBuildCommand(detected) {
  return detected.detectedBuildCommand || FRAMEWORK_PRESETS[detected.type]?.buildCommand || 'echo "No build step needed"';
}

// ─────────────────────────────────────────────────────────────────────────────
// Source artifact record
// ─────────────────────────────────────────────────────────────────────────────

async function createSourceArtifactRecord({
  uploadId, fileName, zipBuffer, extracted, detected, shellFile,
  siteName, finalSlug, publishDirectory, siteDir, now,
}) {
  const manifest = {
    uploadId,
    fileName,
    siteName,
    slug: finalSlug,
    sourceType: 'zip-upload-extracted-source',
    storageMode: 'database-artifact-record',
    extractedRoot: siteDir,
    originalZipBytes: zipBuffer.length,
    rawEntryCount: extracted.rawEntryCount,
    deployableFileCount: extracted.files.length,
    ignoredFileCount: extracted.ignoredFiles.length,
    deployableFiles: extracted.files,
    ignoredFiles: extracted.ignoredFiles,
    ignoredFolderExamples: extracted.ignoredFolderExamples,
    projectType: detected.type,
    framework: detected.framework,
    packageManager: detected.packageManager,
    publishDirectory,
    shellFile: shellFile.relativePath,
    createdAt: now,
  };
  const manifestPath = join(siteDir, 'glondia-upload-artifact.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  const shellContent = await readFile(join(siteDir, shellFile.relativePath), 'utf8');
  return { ...manifest, manifestPath, shellContent };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function detectRootPrefix(names) {
  const firstParts = names.map(name => cleanZipPath(name).split('/')[0]).filter(Boolean);
  if (!firstParts.length) return '';
  const first = firstParts[0];
  if (!firstParts.every(part => part === first)) return '';
  // Only strip the prefix when ALL entries actually live inside a subdirectory
  // (i.e. at least one path has a '/' separator). If the single shared first
  // part is a flat filename (like index.html) we must NOT treat it as a folder.
  const allNested = names.every(name => cleanZipPath(name).includes('/'));
  return allNested ? `${first}/` : '';
}

function cleanZipPath(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}

function sanitizeFileName(value = '') {
  return String(value || 'upload.zip').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'upload.zip';
}

function slugify(value) {
  return String(value || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'site';
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeLog(message, level = 'info') {
  return { id: makeId('log'), level, message, timestamp: nowIso(), createdAt: nowIso() };
}

function badRequest(message, code = 'ZIP_BAD_REQUEST') {
  const error = new Error(message);
  error.status = 400;
  error.code = code;
  error.expose = true;
  return error;
}
