/**
 * githubGuard.js — SSRF-safe normalization of customer-supplied GitHub URLs.
 *
 * A repo link comes from the customer, so it is a fetch target we must not let
 * point anywhere except github.com. We parse it with the WHATWG URL parser
 * (not a substring regex, which `https://evil.com/github.com/o/r` defeats) and
 * reject: non-https schemes, embedded credentials, IP literals,
 * localhost/private hosts, and any host that is not exactly github.com.
 */

const ALLOWED_HOSTS = new Set(['github.com', 'www.github.com']);
const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,150}$/;

export function githubError(code, message) {
  const err = new Error(message);
  err.status = 400;
  err.code = code;
  err.stage = 'github_repo_validate';
  err.expose = true;
  return err;
}

function isIpLiteral(host) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true; // IPv4
  if (host.includes(':')) return true;                    // IPv6 (bracketed host)
  if (/^0x[0-9a-f]+$/i.test(host) || /^\d+$/.test(host)) return true; // decimal/hex IPv4
  return false;
}

/**
 * Validate and normalize a GitHub repo URL. Returns
 * { url, owner, repo, fullName } or throws a 400.
 */
export function assertSafeGithubUrl(rawUrl) {
  const text = String(rawUrl || '').trim();
  if (!text) throw githubError('GITHUB_URL_REQUIRED', 'repoUrl is required.');
  if (text.length > 400) throw githubError('GITHUB_URL_INVALID', 'repoUrl is too long.');

  // Normalize the git@github.com:owner/repo SCP form to https for parsing.
  let candidate = text;
  const scp = text.match(/^git@github\.com:([^/]+)\/(.+)$/i);
  if (scp) candidate = `https://github.com/${scp[1]}/${scp[2]}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw githubError('GITHUB_URL_INVALID', 'A valid GitHub repository URL is required.');
  }

  if (parsed.protocol !== 'https:') {
    throw githubError('GITHUB_URL_SCHEME', 'Only https GitHub URLs are accepted.');
  }
  if (parsed.username || parsed.password) {
    throw githubError('GITHUB_URL_CREDENTIALS', 'Remove embedded credentials from the repository URL.');
  }
  const host = parsed.hostname.toLowerCase();
  if (isIpLiteral(host)) {
    throw githubError('GITHUB_URL_HOST', 'IP-address URLs are not accepted; use github.com.');
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw githubError('GITHUB_URL_HOST', 'Private/local hosts are not accepted; use github.com.');
  }
  if (!ALLOWED_HOSTS.has(host)) {
    throw githubError('GITHUB_URL_HOST', 'Only github.com repository URLs are accepted.');
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 2) {
    throw githubError('GITHUB_URL_INVALID', 'The URL must include an owner and repository.');
  }
  const owner = segments[0];
  const repo = segments[1].replace(/\.git$/i, '');
  if (!OWNER_RE.test(owner)) throw githubError('GITHUB_URL_INVALID', 'The repository owner name is invalid.');
  if (!REPO_RE.test(repo) || repo === '.' || repo === '..') {
    throw githubError('GITHUB_URL_INVALID', 'The repository name is invalid.');
  }

  return {
    url: `https://github.com/${owner}/${repo}`,
    owner,
    repo,
    fullName: `${owner}/${repo}`,
  };
}

/** Branch/ref names come from customers too — keep them shell- and path-safe. */
export function assertSafeBranch(rawBranch) {
  const branch = String(rawBranch || 'main').trim() || 'main';
  if (!BRANCH_RE.test(branch) || branch.includes('..') || branch.startsWith('/') || branch.endsWith('/')) {
    throw githubError('GITHUB_BRANCH_INVALID', 'The branch name contains unsupported characters.');
  }
  return branch;
}
