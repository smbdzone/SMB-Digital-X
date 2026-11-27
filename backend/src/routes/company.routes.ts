import { Router } from 'express'
import { getCompany, listCompanies } from '../controller/company.controller.js'
import { isVerified } from '../middlewares/isVerified.js'
import { ownerConsoleOnly } from '../middlewares/ownerConsoleOnly.js'

const router = Router()

router.use(isVerified)

router.get('/', listCompanies)
router.get('/:id', getCompany)
// Companies are created and changed in the Owner Console (signed and recorded): refused here for everyone.
router.post('/', ownerConsoleOnly)
router.patch('/:id', ownerConsoleOnly)
router.delete('/:id', ownerConsoleOnly)

export default router
