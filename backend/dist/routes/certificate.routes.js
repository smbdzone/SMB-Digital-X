import { Router } from 'express';
import { bulkIssueCertificates, downloadCertificatePdf, getCertificate, getMyCertificates, issueCertificate, listCertificates, listTypes, previewCertificate, resendCertificateEmail, revokeCertificate, } from '../controller/certificate.controller.js';
import { createTemplate, deleteTemplate, listTemplates, updateTemplate } from '../controller/certificateTemplate.controller.js';
import { isAllow, isVerified } from '../middlewares/isVerified.js';
const router = Router();
const adminOnly = isAllow(['admin']);
// Every route needs a logged-in user.
router.use(isVerified);
// Anyone logged in: their own documents
router.get('/my', getMyCertificates);
// Admin: what can be issued + saved texts. (Fixed paths must stay above "/:id".)
router.get('/types', adminOnly, listTypes);
router.get('/templates', adminOnly, listTemplates);
router.post('/templates', adminOnly, createTemplate);
router.patch('/templates/:id', adminOnly, updateTemplate);
router.delete('/templates/:id', adminOnly, deleteTemplate);
// Admin: issue
router.post('/preview', adminOnly, previewCertificate);
router.post('/bulk', adminOnly, bulkIssueCertificates);
router.post('/', adminOnly, issueCertificate);
router.get('/', adminOnly, listCertificates);
// Admin, or the owner (checked inside the controller)
router.get('/:id', getCertificate);
router.get('/:id/pdf', downloadCertificatePdf);
// Admin
router.post('/:id/resend-email', adminOnly, resendCertificateEmail);
router.patch('/:id/revoke', adminOnly, revokeCertificate);
export default router;
