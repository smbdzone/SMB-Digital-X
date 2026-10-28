import { Router } from 'express'
import { createCompany, deleteCompany, getCompany, listCompanies, updateCompany } from '../controller/company.controller.js'
import { isAllow, isVerified } from '../middlewares/isVerified.js'
import { upload } from '../middlewares/multer.js'

const router = Router()

router.use(isVerified)

router.get('/', listCompanies)
router.get('/:id', getCompany)
router.post('/', isAllow(['admin']), upload.single('logo'), createCompany)
router.patch('/:id', isAllow(['admin']), upload.single('logo'), updateCompany)
router.delete('/:id', isAllow(['admin']), deleteCompany)

export default router
