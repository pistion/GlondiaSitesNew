// useBuilderProject.js — load/resume a durable BuilderProject from the server.
//
// State is always reloaded from the API, so a refresh or deep-link resumes
// exactly where the customer left off. Never trusts client-cached versions.

import { useCallback, useEffect, useRef, useState } from 'react';
import { builderProjectsApi } from '../../../api/builder-projects.js';

export function useBuilderProject(projectId) {
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const reload = useCallback(async () => {
    if (!projectId) return null;
    setLoading(true);
    setError(null);
    try {
      const data = await builderProjectsApi.getProject(projectId);
      if (mounted.current) setProject(data);
      return data;
    } catch (err) {
      if (mounted.current) setError(err);
      return null;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { reload(); }, [reload]);

  return { project, setProject, loading, error, reload };
}

// useBuilderJob — poll a durable job until it settles, exposing real stages.
export function useBuilderJob(jobId, { onSettled } = {}) {
  const [job, setJob] = useState(null);
  const [events, setEvents] = useState([]);
  const settledRef = useRef(false);

  useEffect(() => {
    settledRef.current = false;
    setJob(null);
    setEvents([]);
    if (!jobId) return undefined;

    let active = true;
    let timer = null;

    const poll = async () => {
      try {
        const current = await builderProjectsApi.getJob(jobId);
        if (!active) return;
        setJob(current);
        try { setEvents(await builderProjectsApi.getJobEvents(jobId)); } catch { /* best effort */ }
        if (['SUCCEEDED', 'FAILED'].includes(current.status)) {
          if (!settledRef.current) {
            settledRef.current = true;
            onSettled?.(current);
          }
          return; // stop polling
        }
      } catch { /* transient — keep polling */ }
      if (active) timer = setTimeout(poll, 1500);
    };
    poll();

    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [jobId, onSettled]);

  return { job, events };
}
