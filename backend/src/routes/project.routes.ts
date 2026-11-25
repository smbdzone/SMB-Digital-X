import { Router } from 'express'

import {
    createProjectController,
    getProjectsController,
    getProjectController,
    updateProjectController,
    deleteProjectController
} from '../controller/project.controller.js'
import { isAllow } from '../middlewares/isVerified.js'

const router = Router()

// Login is required at the mount in index.ts. Changes are employer-only; reading is checked in the
// controller (the admin sees every project, an employee only projects they have tasks in).
const adminOnly = isAllow(['admin'])

router.post('/', adminOnly, createProjectController)

router.get('/', getProjectsController)

router.get('/:id', getProjectController)

router.patch('/:id', adminOnly, updateProjectController)

router.delete('/:id', adminOnly, deleteProjectController)

export default router