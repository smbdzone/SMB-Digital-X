import { Router } from 'express'

import {
    createProjectController,
    getProjectsController,
    getProjectController,
    updateProjectController,
    deleteProjectController
} from '../controller/project.controller.js'
import { isAllow } from '../middlewares/isVerified.js'
import { projectCreateGuard, projectDeleteGuard, projectUpdateGuard } from '../middlewares/moneyGuards.js'

const router = Router()

// Login is required at the mount in index.ts. Changes are employer-only; reading is checked in the
// controller (the admin sees every project, an employee only projects they have tasks in).
const adminOnly = isAllow(['admin'])

router.post('/', adminOnly, projectCreateGuard, createProjectController)   // budget: Owner Console

router.get('/', getProjectsController)

router.get('/:id', getProjectController)

router.patch('/:id', adminOnly, projectUpdateGuard, updateProjectController)

router.delete('/:id', adminOnly, projectDeleteGuard, deleteProjectController)

export default router