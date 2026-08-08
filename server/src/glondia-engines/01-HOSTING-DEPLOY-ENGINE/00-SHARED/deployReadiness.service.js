/**
 * deployReadiness.service.js - engine-local deployment readiness/config.
 */
import renderApiService from '../../../services/renderApiService.js';
import { resolveGitHubPublisherToken } from '../03-GITHUB-SOURCE-MOUNTAIN/generatedSitesRepoPublisher.stage.js';
import { getProviderCapabilities } from './hostingProviderResolver.js';

export { checkDeployReadiness } from '../../../services/deployReadinessService.js';

export function getZipDeployConfigStatus() {
  const capabilities = getProviderCapabilities();
  const vpsHostingConfigured = capabilities.uploadProvider === 'vps';
  const renderApiConfigured = renderApiService.configured();
  const sourceRepo = (process.env.RENDER_GENERATED_SITES_REPO_URL || process.env.GENERATED_SITES_REPO_URL || '').trim();
  const renderSourceRepoConfigured = Boolean(sourceRepo);
  const { token: ghToken, error: ghTokenError } = resolveGitHubPublisherToken();
  const githubPublisherConfigured = Boolean(ghToken && !ghTokenError);

  const missing = [];
  if (!vpsHostingConfigured) {
    if (!renderApiConfigured) missing.push('RENDER_API_KEY and/or RENDER_OWNER_ID');
    if (!renderSourceRepoConfigured) missing.push('RENDER_GENERATED_SITES_REPO_URL');
    if (!githubPublisherConfigured) missing.push('GITHUB_GENERATED_SITES_TOKEN');
  }

  return {
    provider: capabilities.uploadProvider,
    providerMode: capabilities.mode,
    uploadProvider: capabilities.uploadProvider,
    domainProvider: capabilities.domainProvider,
    uploadProviderReason: vpsHostingConfigured
      ? 'Glondia Hosting is the primary website publishing lane for ZIP and repository uploads.'
      : capabilities.uploadProviderReason,
    providers: capabilities.providers,
    glondiaHostingConfigured: vpsHostingConfigured,
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
