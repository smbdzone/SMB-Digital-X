import { Router } from 'express';
import { createProjectController, getProjectsController, getProjectController, updateProjectController, deleteProjectController } from '../controller/project.controller.js';
const router = Router();
router.post('/', createProjectController);
router.get('/', getProjectsController);
router.get('/:id', getProjectController);
router.patch('/:id', updateProjectController);
router.delete('/:id', deleteProjectController);
export default router;
