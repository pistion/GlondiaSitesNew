export function mapApiProject(project) {
  const framework = project.framework || project.serviceTypeLabel || serviceTypeLabel(project.serviceType) || "Project";
  const repo = [project.repositoryOwner, project.repositoryName].filter(Boolean).join("/") || "Local workspace";
  const status = project.status === "active" ? "Ready" : project.status === "draft" ? "Draft" : project.status === "paused" ? "Paused" : project.status === "completed" ? "Completed" : "Archived";
  return {
    id: project.id,
    clientId: project.clientId || null,
    workspaceId: project.workspaceId || null,
    projectCode: project.projectCode || project.projectId || project.id,
    serviceType: project.serviceType || "website",
    serviceTypeLabel: project.serviceTypeLabel || serviceTypeLabel(project.serviceType),
    name: project.name,
    description: project.description || "",
    priority: project.priority || "normal",
    slug: project.slug || "",
    storageNamespace: project.storageNamespace || project.metadata?.storageNamespace || "",
    autoBillingEnabled: Boolean(project.autoBillingEnabled ?? project.metadata?.autoBillingEnabled),
    billingAmount: Number(project.billingAmount ?? project.metadata?.billingAmount ?? 0),
    billingCurrency: project.billingCurrency || project.metadata?.billingCurrency || "PGK",
    billingInterval: project.billingInterval || project.metadata?.billingInterval || "monthly",
    createdAt: project.createdAt || null,
    updatedAt: project.updatedAt || null,
    serviceCount: Number(project.serviceCount || project.services?.length || 0),
    framework,
    status,
    repo,
    renderServiceId: project.renderServiceId || null,
    branch: project.productionBranch || "main",
    domain: project.domain || `${project.slug}.glondia.app`,
    customDomain: project.customDomain || null,
    lastDeploy: project.updatedAt ? formatRelative(project.updatedAt) : "Not deployed yet",
    deployedBy: "Glondia",
    region: "Oregon",
    visitors30d: project.visitors30d || 0,
    bandwidth30d: project.bandwidth30d || "0 GB",
    requests30d: project.requests30d || "0",
  };
}

function serviceTypeLabel(serviceType) {
  return {
    website: "Website / Site Builder",
    hosting: "Hosting",
    domain: "Domain",
    email: "Business Email",
    vps: "VPS Hosting",
    consultation: "Consultation",
    build: "Custom Build",
    support: "Support",
    other: "Other",
  }[serviceType] || null;
}

export function mapApiDeployment(deployment) {
  const statusMap = {
    queued: "Queued",
    building: "Building",
    uploading: "Building",
    deployed: "Ready",
    failed: "Failed",
    cancelled: "Cancelled",
    rolled_back: "Rolled back",
  };
  return {
    id: deployment.id,
    commit: deployment.commitMessage || "Vite static deployment",
    branch: deployment.branch || "main",
    sha: deployment.commitSha ? deployment.commitSha.slice(0, 7) : "local",
    env: deployment.environment === "production" ? "Production" : "Preview",
    status: statusMap[deployment.status] || deployment.status,
    duration: deployment.durationMs ? `${Math.round(deployment.durationMs / 1000)}s` : "18s",
    time: deployment.createdAt ? formatRelative(deployment.createdAt) : "Recently",
    author: "Glondia",
    artifact: deployment.artifacts?.[0] ? mapApiArtifact(deployment.artifacts[0]) : null,
    provider: deployment.provider,
    providerServiceId: deployment.providerServiceId,
    providerDeployId: deployment.providerDeployId,
    providerStatus: deployment.providerStatus,
  };
}

export function mapApiDeploymentLog(log) {
  return {
    t: log.createdAt ? new Date(log.createdAt).toLocaleTimeString([], { hour12: false }) : "--:--:--",
    level: log.level === 'error' ? 'error' : log.level === 'warn' ? 'dim' : 'info',
    msg: log.message,
  };
}

export function mapApiEnvVar(envVar) {
  const label = envVar.environment === "production" ? "Production" : envVar.environment === "preview" ? "Preview" : "Development";
  return {
    id: envVar.id,
    key: envVar.key,
    value: envVar.value || "********",
    env: [label],
    updated: envVar.updatedAt ? formatRelative(envVar.updatedAt) : "Recently",
  };
}

export function mapApiDomain(domain) {
  const statusMap = {
    pending_verification: "Pending Verification",
    verified: "Verified",
    active: "Active",
    misconfigured: "Misconfigured",
    disabled: "Disabled",
    ok: "Active",
    registered: "Active",
  };
  // Workspace local shape uses hostname; registrar (Spaceship) often uses name/domain.
  const hostname = domain.hostname || domain.name || domain.domain || domain.id || '';
  const statusKey = String(domain.status || domain.lifecycleStatus || 'active').toLowerCase();
  const expiresRaw = domain.expiresAt || domain.expirationDate || domain.expires || null;
  let expiresLabel = '—';
  if (expiresRaw) {
    try {
      expiresLabel = new Date(expiresRaw).toLocaleDateString();
    } catch {
      expiresLabel = String(expiresRaw);
    }
  }
  return {
    id: domain.id || hostname,
    name: hostname,
    hostname,
    rootDomain: domain.rootDomain || hostname,
    status: statusMap[statusKey] || domain.status || 'Active',
    rawStatus: domain.status || statusKey,
    verificationToken: domain.verificationToken || null,
    verifiedAt: domain.verifiedAt || null,
    linkedProject: domain.projectId || null,
    linkedProjectName: null,
    provider: domain.provider || null,
    providers: Array.isArray(domain.providers) ? domain.providers : [],
    auto: domain.autoRenew === true || domain.auto === true,
    expires: expiresLabel,
    price: domain.price ?? null,
  };
}

export function mapApiDnsRecord(record) {
  return {
    id: record.id,
    type: record.type,
    host: record.name,
    value: record.value,
    ttl: formatTtl(record.ttl),
    ttlSeconds: record.ttl,
    priority: record.priority,
    proxy: !!record.proxied,
    status: record.status || 'active',
  };
}

export function mapApiArtifact(artifact) {
  return {
    id: artifact.id,
    bucket: artifact.bucket,
    objectKey: artifact.objectKey,
    size: formatBytes(artifact.sizeBytes),
    sizeBytes: artifact.sizeBytes,
    checksum: artifact.checksum,
    status: artifact.status,
    createdAt: artifact.createdAt,
  };
}

export function mapApiTemplate(t) {
  return {
    id: t.id,
    name: t.name,
    category: t.category,
    contentJson: t.contentJson || null,
    isActive: t.isActive !== false,
    sortOrder: t.sortOrder || 0,
  };
}

export function mapApiActivity(item) {
  return {
    id: item.id,
    who: item.actor?.name || item.actor?.email || "Glondia",
    what: item.message || item.action,
    when: item.createdAt ? formatRelative(item.createdAt) : "Recently",
    kind: activityKind(item.entityType || item.resourceType || item.action),
    action: item.action,
    entityType: item.entityType || item.resourceType,
    entityId: item.entityId || item.resourceId,
  };
}

function formatRelative(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function formatTtl(value) {
  if (!value || value === 3600) return "Auto";
  if (value === 300) return "5 min";
  if (value === 86400) return "1 day";
  return `${value}s`;
}

function formatBytes(value = 0) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function activityKind(value) {
  const text = String(value || '').toLowerCase();
  if (text.includes('deployment')) return 'deploy';
  if (text.includes('domain') || text.includes('dns')) return 'domain';
  if (text.includes('ssl')) return 'ssl';
  if (text.includes('builder')) return 'builder';
  return 'activity';
}
