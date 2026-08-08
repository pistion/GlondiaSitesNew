export const SERVICE_SANDBOX_EVENT = 'glondia:service-sandbox-changed';
export const SERVICE_SANDBOX_KEY = 'glondia.serviceSandbox.active.v1';
export const CLOUD_STORAGE_SANDBOX_SERVICE_KEY = 'glondia.serviceSandbox.cloudStorage.service.v1';

export function getActiveServiceSandbox() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SERVICE_SANDBOX_KEY);
    const value = raw ? JSON.parse(raw) : null;
    return value?.active ? value : null;
  } catch {
    return null;
  }
}

export function isServiceSandboxActive(service = '') {
  const active = getActiveServiceSandbox();
  if (!active) return false;
  if (!service) return true;
  return active.service === service || active.targetView === service;
}

export function activateServiceSandbox(scenario) {
  if (typeof window === 'undefined' || !scenario) return null;
  const state = {
    active: true,
    id: scenario.id,
    service: scenario.service,
    targetView: scenario.targetView || scenario.service,
    label: scenario.label,
    payload: scenario.payload || {},
    activatedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(SERVICE_SANDBOX_KEY, JSON.stringify(state));
  window.localStorage.removeItem(CLOUD_STORAGE_SANDBOX_SERVICE_KEY);
  window.dispatchEvent(new CustomEvent(SERVICE_SANDBOX_EVENT, { detail: state }));
  return state;
}

export function clearServiceSandbox() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(SERVICE_SANDBOX_KEY);
  window.localStorage.removeItem(CLOUD_STORAGE_SANDBOX_SERVICE_KEY);
  window.dispatchEvent(new CustomEvent(SERVICE_SANDBOX_EVENT, { detail: null }));
}

export function useServiceSandbox(React) {
  const { useEffect, useState } = React;
  const [state, setState] = useState(getActiveServiceSandbox);
  useEffect(() => {
    const onChange = () => setState(getActiveServiceSandbox());
    window.addEventListener(SERVICE_SANDBOX_EVENT, onChange);
    window.addEventListener('storage', onChange);
    return () => {
      window.removeEventListener(SERVICE_SANDBOX_EVENT, onChange);
      window.removeEventListener('storage', onChange);
    };
  }, []);
  return state;
}
