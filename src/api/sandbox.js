import { liveApiRequest } from '../api.js';

async function withSandboxFallback(primaryPath, fallbackPath, options) {
  try {
    const data = await liveApiRequest(primaryPath, options);
    if (data && typeof data === 'object' && (Array.isArray(data.services) || data.response || data.mode === 'sandbox')) return data;
    return data;
  } catch (err) {
    if (err?.status !== 404) throw err;
    return liveApiRequest(fallbackPath, options);
  }
}

export async function listSandboxServices() {
  return withSandboxFallback('/v1/sandbox/services', '/sandbox/services');
}

export async function simulateSandboxCall(scenarioId, payload = {}) {
  return withSandboxFallback('/v1/sandbox/simulate', '/sandbox/simulate', {
    method: 'POST',
    body: JSON.stringify({ scenarioId, payload }),
  });
}
