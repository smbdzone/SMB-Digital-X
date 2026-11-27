import express, { Router } from 'express'
import {
    bulkIssueCertificates, downloadCertificatePdf, getCertificate, getMyCertificates, issueCertificate,
    listCertificates, listTypes, previewCertificate, previewCertificatePdf, resendCertificateEmail, revokeCertificate,
} from '../controller/certificate.controller.js'
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '../controller/certificateTemplate.controller.js'
import { isAllow, isVerified } from '../middlewares/isVerified.js'
import { ownerConsoleOnly } from '../middlewares/ownerConsoleOnly.js'

const router = Router()
const adminOnly = isAllow(['admin'])

// Body parser for the routes that may carry the signature image (base64, max 1 MB). It runs after adminOnly, so
// nobody else can even send a large body. index.ts skips its default 100 KB parser for exactly these routes.
const signatureJson = express.json({ limit: '2mb' })

// Every route needs a logged-in user.
router.use(isVerified)

// Anyone logged in: their own documents
router.get('/my', getMyCertificates)

// Admin: what can be issued + saved texts. (Fixed paths must stay above "/:id".)
router.get('/types', adminOnly, listTypes)
router.get('/templates', adminOnly, listTemplates)
router.post('/templates', adminOnly, createTemplate)
router.patch('/templates/:id', adminOnly, updateTemplate)
router.delete('/templates/:id', adminOnly, deleteTemplate)

// Admin: issue
// Previewing, issuing (single and bulk), revoking and resending letters are done in the Owner Console (signed, with the
// one-time signature as a signed attachment): refused here for everyone. Saved texts (templates) stay on the website.
router.post('/preview', ownerConsoleOnly)
router.post('/preview/pdf', ownerConsoleOnly)
router.post('/bulk', ownerConsoleOnly)
router.post('/', ownerConsoleOnly)
router.get('/', adminOnly, listCertificates)

// Admin, or the owner (checked inside the controller)
router.get('/:id', getCertificate)
router.get('/:id/pdf', downloadCertificatePdf)

// Admin
router.post('/:id/resend-email', ownerConsoleOnly)
router.patch('/:id/revoke', ownerConsoleOnly)

export default router
