export function createProjectActions({
  apiRequest,
  mapApiDeployment,
  mapApiEnvVar,
  mapApiProject,
  notifyDataChanged,
  readLocalDb,
}) {
  return {
    async listProjects() {
      const projects = await apiRequest('/projects');
      return projects.map(mapApiProject);
    },

    async listProjectServiceTypes() {
      return apiRequest('/projects/service-types');
    },

    async createProject(input) {
      const project = await apiRequest('/projects', { method: 'POST', body: JSON.stringify(input) });
      notifyDataChanged();
      return mapApiProject(project);
    },

    async getProject(projectId) {
      const project = await apiRequest(`/projects/${encodeURIComponent(projectId)}`);
      return mapApiProject(project);
    },

    async getProjectSummary(projectId) {
      return apiRequest(`/projects/${encodeURIComponent(projectId)}/summary`);
    },

    async manageProjectService(projectId, serviceType, serviceId, action, input = {}) {
      const result = await apiRequest(`/projects/${encodeURIComponent(projectId)}/services/${encodeURIComponent(serviceType)}/${encodeURIComponent(serviceId)}/actions`, {
        method: 'POST',
        body: JSON.stringify({ ...input, action }),
      });
      notifyDataChanged();
      return result;
    },

    async updateProject(projectId, input) {
      const project = await apiRequest(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(input) });
      notifyDataChanged();
      return mapApiProject(project);
    },

    async archiveProject(projectId) {
      const project = await apiRequest(`/projects/${projectId}`, { method: 'DELETE' });
      notifyDataChanged();
      return mapApiProject(project);
    },

    async createDeployment(projectId, input) {
      const deployment = await apiRequest(`/projects/${projectId}/deployments`, { method: 'POST', body: JSON.stringify(input) });
      notifyDataChanged();
      return mapApiDeployment(deployment);
    },

    async cancelDeployment(deploymentId) {
      const deployment = await apiRequest(`/deployments/${deploymentId}/cancel`, { method: 'POST' });
      notifyDataChanged();
      return mapApiDeployment(deployment);
    },

    async rollbackDeployment(deploymentId) {
      const deployment = await apiRequest(`/deployments/${deploymentId}/rollback`, { method: 'POST' });
      notifyDataChanged();
      return mapApiDeployment(deployment);
    },

    async createEnvVar(projectId, input) {
      const envVar = await apiRequest(`/projects/${projectId}/env-vars`, { method: 'POST', body: JSON.stringify(input) });
      notifyDataChanged();
      return mapApiEnvVar(envVar);
    },

    async updateEnvVar(projectId, envVarId, input) {
      const envVar = await apiRequest(`/projects/${projectId}/env-vars/${envVarId}`, { method: 'PATCH', body: JSON.stringify(input) });
      notifyDataChanged();
      return mapApiEnvVar(envVar);
    },

    async deleteEnvVar(projectId, envVarId) {
      const result = await apiRequest(`/projects/${projectId}/env-vars/${envVarId}`, { method: 'DELETE' });
      notifyDataChanged();
      return result;
    },

    async exportEnvVars(projectId, environment) {
      const qs = environment ? `?environment=${encodeURIComponent(environment)}` : '';
      return apiRequest(`/projects/${projectId}/env-vars/export${qs}`);
    },

    async linkProjectRepo(projectId, input, updateProject) {
      if (!input) {
        const project = await updateProject(projectId, {
          repositoryProvider: null,
          repositoryOwner: null,
          repositoryName: null,
          repositoryId: null,
          repositoryUrl: null,
        });
        notifyDataChanged();
        return project;
      }

      const { owner, repo, branch, repoId, url } = input;
      const project = await updateProject(projectId, {
        repositoryProvider: 'github',
        repositoryOwner: owner,
        repositoryName: repo,
        repositoryId: String(repoId ?? ''),
        repositoryUrl: url || `https://github.com/${owner}/${repo}`,
        productionBranch: branch || 'main',
      });
      notifyDataChanged();
      return project;
    },

    async listRenderServices() {
      return readLocalDb().renderServices;
    },

    async linkRenderService(projectId, renderServiceId) {
      const project = await apiRequest(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify({ renderServiceId: renderServiceId || null }) });
      notifyDataChanged();
      return project;
    },
  };
}
