/**
 * deploymentStream.service.js
 *
 * SSE deployment log stream service extracted from server.js.
 *
 * Clients connect via EventSource. Immediately flushes stored Glondia events,
 * then polls Render + our DB every 3 s for new log lines and status changes.
 * Ends on terminal state or after 35-minute hard timeout.
 */

import { readHostingStore } from '../../../services/hostingStore.js';
import deploymentStatusService from '../../../services/deploymentStatusService.js';
import renderApiService from '../../../services/renderApiService.js';

const TERMINAL = new Set(['live', 'failed', 'deleted', 'suspended', 'deployed_unverified']);
const POLL_MS = 3000;

export async function streamDeploymentLogs(req, res) {
  const { deploymentId } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering on Render
  res.flushHeaders();

  let cursor = null;
  let timer = null;
  let finished = false;

  const emit = (event, payload) => {
    if (finished) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  };

  const finish = (reason = 'done') => {
    if (finished) return;
    clearInterval(timer);
    emit('done', { reason });
    finished = true;
    res.end();
  };

  req.on('close', () => { finished = true; clearInterval(timer); });

  try {
    const store = await readHostingStore();
    const dep = (store.deployments || []).find((d) => d.deploymentId === deploymentId || d.id === deploymentId);

    if (!dep) {
      emit('error', { message: 'Deployment not found.' });
      return res.end();
    }

    // Flush existing Glondia internal events (reverse so oldest is first)
    const stored = (store.logs[deploymentId] || []).slice().reverse();
    for (const log of stored) {
      emit('log', {
        id: log.id, message: log.message, level: log.level || 'info',
        timestamp: log.timestamp || log.createdAt,
        source: log.details?.source || 'glondia',
        stage: log.details?.stage,
        details: log.details,
      });
    }

    // Emit current status
    emit('status', { status: dep.status, buildStatus: dep.buildStatus, currentStep: dep.currentStep, liveUrl: dep.liveUrl, errorMessage: dep.errorMessage });

    if (TERMINAL.has(dep.status)) return finish('terminal');

    const poll = async () => {
      if (finished) return;
      try {
        let s = await readHostingStore();
        let fresh = (s.deployments || []).find((d) => d.deploymentId === deploymentId || d.id === deploymentId);
        if (!fresh) return finish('not_found');

        // Only call Render to refresh if the deployment is in an active state
        const activeStates = new Set(['preparing', 'queued', 'building', 'deploying', 'deployed', 'deployed_unverified', 'prepared']);
        if (activeStates.has(fresh.status) && fresh.renderServiceId && !String(fresh.renderServiceId).includes('_pending')) {
          try {
            fresh = await deploymentStatusService.refreshDeployment(fresh) || fresh;
            s = await readHostingStore();
          } catch { /* continue with stored status if refresh fails */ }
        }

        emit('status', { status: fresh.status, buildStatus: fresh.buildStatus, currentStep: fresh.currentStep, liveUrl: fresh.liveUrl, errorMessage: fresh.errorMessage });

        // Fetch any new Glondia log entries since last poll
        const freshLogs = (s.logs[deploymentId] || []).slice().reverse();
        const seenGlondiaCount = stored.length;
        const newGlondia = freshLogs.slice(seenGlondiaCount);
        for (const log of newGlondia) {
          emit('log', {
            id: log.id, message: log.message, level: log.level || 'info',
            timestamp: log.timestamp || log.createdAt,
            source: log.details?.source || 'glondia',
            stage: log.details?.stage,
            details: log.details,
          });
          stored.push(log);
        }

        // Fetch Render deploy logs if we have real (non-pending) IDs
        if (fresh.renderServiceId && fresh.renderDeployId
            && !String(fresh.renderServiceId).includes('_pending')
            && !String(fresh.renderDeployId).includes('_pending')) {
          try {
            const resp = await renderApiService.getDeployLogs(fresh.renderServiceId, fresh.renderDeployId, cursor);
            const lines = Array.isArray(resp) ? resp : (resp?.logs || resp?.data || []);
            for (const line of lines) {
              const msg = line.message || line.msg || line.text || String(line);
              const level = (line.type === 'error' || line.level === 'error') ? 'error' : (line.type === 'warning' || line.level === 'warn') ? 'warn' : 'info';
              emit('log', { id: line.id, message: msg, level, timestamp: line.timestamp || line.createdAt, source: 'render' });
            }
            if (lines.length > 0 && lines[lines.length - 1].id) cursor = lines[lines.length - 1].id;
          } catch {
            // Render log API unavailable — continue polling status only
          }
        }

        if (TERMINAL.has(fresh.status)) finish('terminal');
      } catch (err) {
        emit('error', { message: err.message || 'Poll failed.' });
      }
    };

    await poll();
    timer = setInterval(poll, POLL_MS);
    // Hard timeout after 35 minutes so we don't leak connections
    setTimeout(() => finish('timeout'), 35 * 60 * 1000);
  } catch (err) {
    emit('error', { message: err.message || 'Stream initialisation failed.' });
    res.end();
  }
}

export default { streamDeploymentLogs };
