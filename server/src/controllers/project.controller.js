import {
  archiveProject,
  createProject,
  getProject,
  getProjectSummary,
  listProjectServiceTypes,
  listProjects,
  manageProjectService,
  projectDto,
  updateProject,
} from '../services/projectService.js';

function scope(req) {
  return {
    userId: req.user?.id && req.user.id !== 'local-user' ? req.user.id : null,
    workspaceId: req.params?.workspaceId || req.body?.workspaceId || null,
  };
}

const ProjectController = {
  listServiceTypes: async (_req, res) => {
    res.ok(listProjectServiceTypes());
  },

  listProjects: async (req, res, next) => {
    try {
      const rows = await listProjects({
        ...scope(req),
        includeArchived: req.query?.includeArchived === 'true',
      });
      res.ok(rows.map(projectDto));
    } catch (error) {
      next(error);
    }
  },

  createProject: async (req, res, next) => {
    try {
      const project = await createProject({ ...scope(req), input: req.body || {} });
      res.created(projectDto(project));
    } catch (error) {
      next(error);
    }
  },

  getProject: async (req, res, next) => {
    try {
      const project = await getProject({ ...scope(req), projectId: req.params.projectId });
      res.ok(projectDto(project));
    } catch (error) {
      next(error);
    }
  },

  getProjectSummary: async (req, res, next) => {
    try {
      res.ok(await getProjectSummary({ ...scope(req), projectId: req.params.projectId }));
    } catch (error) {
      next(error);
    }
  },

  updateProject: async (req, res, next) => {
    try {
      const project = await updateProject({ ...scope(req), projectId: req.params.projectId, patch: req.body || {} });
      res.ok(projectDto(project));
    } catch (error) {
      next(error);
    }
  },

  archiveProject: async (req, res, next) => {
    try {
      const project = await archiveProject({ ...scope(req), projectId: req.params.projectId });
      res.ok(projectDto(project));
    } catch (error) {
      next(error);
    }
  },

  manageProjectService: async (req, res, next) => {
    try {
      const result = await manageProjectService({
        ...scope(req),
        projectId: req.params.projectId,
        serviceType: req.params.serviceType,
        serviceId: req.params.serviceId,
        action: req.body?.action,
        input: req.body || {},
      });
      res.ok(result);
    } catch (error) {
      next(error);
    }
  },
};

export default ProjectController;
