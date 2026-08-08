import express from 'express';
import ProjectController from '../controllers/project.controller.js';
import DeploymentController from '../controllers/deployment.controller.js';
import EnvVarController from '../controllers/env-var.controller.js';
import authMiddleware from '../middleware/authMiddleware.js';

const router = express.Router({ mergeParams: true });

router.use(authMiddleware);

// Project core
router.get('/service-types', ProjectController.listServiceTypes);
router.get('/', ProjectController.listProjects);
router.post('/', ProjectController.createProject);
router.get('/:projectId', ProjectController.getProject);
router.get('/:projectId/summary', ProjectController.getProjectSummary);
router.patch('/:projectId', ProjectController.updateProject);
router.delete('/:projectId', ProjectController.archiveProject);
router.post('/:projectId/services/:serviceType/:serviceId/actions', ProjectController.manageProjectService);

// Deployments
router.get('/:projectId/deployments', DeploymentController.listDeployments);
router.post('/:projectId/deployments', DeploymentController.createDeployment);
router.get('/:projectId/deployments/:deploymentId', DeploymentController.getDeployment);
router.post('/:projectId/deployments/:deploymentId/cancel', DeploymentController.cancelDeployment);
router.post('/:projectId/deployments/:deploymentId/rollback', DeploymentController.rollbackDeployment);

// Build logs
router.get('/:projectId/deployments/:deploymentId/logs', DeploymentController.getLogs);

// Env vars
router.get('/:projectId/env-vars', EnvVarController.listEnvVars);
router.post('/:projectId/env-vars', EnvVarController.createEnvVar);
router.patch('/:projectId/env-vars/:envVarId', EnvVarController.updateEnvVar);
router.delete('/:projectId/env-vars/:envVarId', EnvVarController.deleteEnvVar);

export default router;
