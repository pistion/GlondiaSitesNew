/**
 * githubLink.intake.js
 *
 * Normalizes a direct GitHub repository link for Render handoff.
 * This path is intentionally separate from ZIP -> GitHub -> Render.
 */

import { assertSafeGithubUrl, assertSafeBranch } from '../../../builder/security/githubGuard.js';

export function normalizeGithubLinkInput(input = {}, context = {}) {
  const rawUrl = String(input.repoUrl || input.repositoryUrl || input.sourceRepository || input.sourceReference || '').trim();
  if (!rawUrl) throw requestError('repoUrl is required.', 400, 'github_repo_validate');
  // SSRF-safe: reject non-github.com hosts, credentials, IP literals, and
  // http. The normalized https URL is the ONLY thing we forward downstream.
  const parsedRepo = assertSafeGithubUrl(rawUrl);
  const branch = assertSafeBranch(input.branch || input.githubBranch || 'main');
  const siteName = input.serviceName || input.name || input.siteName || parsedRepo.repo || 'glondia-github-site';

  return {
    input,
    context,
    userId: context.userId || input.userId || null,
    siteId: input.siteId || null,
    projectId: input.projectId || input.siteId || null,
    repoUrl: parsedRepo.url,
    parsedRepo,
    branch,
    siteName,
    sourceReference: parsedRepo.url,
  };
}

export function parseGithubRepoUrl(url = '') {
  const match = String(url || '').trim().match(/github\.com[:/]([^/]+)\/([^/#?]+?)(?:\.git)?(?:[/?#].*)?$/i);
  if (!match) return null;
  const owner = match[1].trim();
  const repo = match[2].trim().replace(/\.git$/i, '');
  if (!owner || !repo || repo === '.' || repo === '..') return null;
  return {
    owner,
    repo,
    fullName: `${owner}/${repo}`,
  };
}

function requestError(message, status, stage) {
  const error = new Error(message);
  error.status = status;
  error.stage = stage;
  error.expose = true;
  return error;
}
