/**
 * Hosting/domain provider capability resolver.
 *
 * Canonical provider selection for website hosting and domain/DNS operations.
 * Website deployments have two supported targets:
 *   - vps: the shared Glondia server
 *   - render: a dedicated Render service
 * Spaceship remains a domain/DNS provider only.
 */

function hasValue(value) {
  return Boolean(String(value || '').trim());
}

export function getRenderProviderStatus() {
  const apiConfigured = hasValue(process.env.RENDER_API_KEY) && hasValue(process.env.RENDER_OWNER_ID);
  const sourceRepoConfigured = hasValue(process.env.RENDER_GENERATED_SITES_REPO_URL || process.env.GENERATED_SITES_REPO_URL);
  const publisherConfigured = hasValue(process.env.GITHUB_GENERATED_SITES_TOKEN || process.env.GITHUB_TOKEN);

  return {
    id: 'render',
    label: 'Render',
    role: 'website-upload',
    uploadSupported: true,
    domainDnsSupported: false,
    configured: apiConfigured && sourceRepoConfigured && publisherConfigured,
    apiConfigured,
    sourceRepoConfigured,
    publisherConfigured,
    missing: [
      !apiConfigured ? 'RENDER_API_KEY and/or RENDER_OWNER_ID' : null,
      !sourceRepoConfigured ? 'RENDER_GENERATED_SITES_REPO_URL' : null,
      !publisherConfigured ? 'GITHUB_GENERATED_SITES_TOKEN' : null,
    ].filter(Boolean),
  };
}

export function getVpsProviderStatus() {
  const selected = resolveWebsiteHostingProvider() === 'vps';
  return {
    id: 'vps',
    label: 'Glondia Shared Server',
    role: 'website-upload',
    uploadSupported: true,
    domainDnsSupported: false,
    configured: selected,
    selected,
    publicBaseUrl: String(process.env.HOSTING_VPS_PUBLIC_BASE_URL || 'http://45.77.236.52').replace(/\/+$/, ''),
    missing: [],
  };
}

export function getVultrProviderStatus() {
  const configured = hasValue(process.env.VULTR_API_KEY) || String(process.env.VULTR_TEST_MODE || '').toLowerCase() === 'true';
  return {
    id: 'vultr',
    label: 'Dedicated Vultr Server',
    role: 'dedicated-server',
    uploadSupported: false,
    requiresProvisioning: true,
    configured,
    missing: configured ? [] : ['VULTR_API_KEY'],
  };
}

/**
 * Resolve the website target once for every intake pipeline.
 * HOSTING_PRIMARY_PROVIDER is canonical; HOSTING_UPLOAD_PROVIDER remains a
 * compatibility fallback. Explicit values win over automatic Render mode.
 */
export function resolveWebsiteHostingProvider(requestedOverride = '') {
  const override = String(requestedOverride || '').trim().toLowerCase();
  const primary = String(process.env.HOSTING_PRIMARY_PROVIDER || '').trim().toLowerCase();
  const legacy = String(process.env.HOSTING_UPLOAD_PROVIDER || 'auto').trim().toLowerCase();
  const requested = override || primary || legacy;
  if (['vps', 'glondia', 'glondia-hosting', 'shared', 'shared-server'].includes(requested)) return 'vps';
  if (['vultr', 'dedicated', 'dedicated-vultr'].includes(requested)) return 'vultr';
  return 'render';
}

export function getSpaceshipProviderStatus() {
  const apiConfigured = hasValue(process.env.SPACESHIP_API_KEY) && hasValue(process.env.SPACESHIP_API_SECRET);

  return {
    id: 'spaceship',
    label: 'Spaceship',
    role: 'domain-dns',
    uploadSupported: false,
    domainDnsSupported: true,
    configured: apiConfigured,
    apiConfigured,
    baseUrl: (process.env.SPACESHIP_API_BASE_URL || 'https://spaceship.dev/api/v1').replace(/\/+$/, ''),
    requiredScopes: [
      'domains:read',
      'domains:write',
      'dnsrecords:read',
      'dnsrecords:write',
      'asyncoperations:read',
    ],
    missing: [
      !hasValue(process.env.SPACESHIP_API_KEY) ? 'SPACESHIP_API_KEY' : null,
      !hasValue(process.env.SPACESHIP_API_SECRET) ? 'SPACESHIP_API_SECRET' : null,
    ].filter(Boolean),
  };
}

export function getProviderCapabilities() {
  const render = getRenderProviderStatus();
  const vps = getVpsProviderStatus();
  const vultr = getVultrProviderStatus();
  const spaceship = getSpaceshipProviderStatus();
  const preferredUploadProvider = String(process.env.HOSTING_PRIMARY_PROVIDER || process.env.HOSTING_UPLOAD_PROVIDER || 'auto').trim().toLowerCase();
  const preferredDomainProvider = String(process.env.HOSTING_DOMAIN_PROVIDER || 'spaceship').trim().toLowerCase();
  const uploadProvider = resolveWebsiteHostingProvider();

  return {
    mode: preferredUploadProvider,
    uploadProvider,
    uploadProviderReason: uploadProvider === 'vps'
      ? 'Websites are built and published into isolated directories on the Glondia shared hosting server.'
      : 'Websites are published to GitHub and deployed as Render services.',
    domainProvider: preferredDomainProvider === 'render' ? null : 'spaceship',
    providers: [vps, vultr, render, spaceship],
  };
}
