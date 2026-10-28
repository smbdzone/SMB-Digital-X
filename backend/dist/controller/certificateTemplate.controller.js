import { Types } from 'mongoose';
import CertificateTemplate from '../model/certificateTemplate.model.js';
import { placeholderInfo, toTypeKey } from '../services/certificate.service.js';
import { asText, badRequest, getAuth, isObjectId, notFound, paramId, queryString } from '../utils/http.js';
// Saved texts are normally created automatically the first time a type is issued.
// These endpoints let an admin review, edit, switch off or delete them (and create one up front).
const parseKind = (value) => {
    if (value !== 'letter' && value !== 'certificate')
        throw badRequest("kind must be 'letter' or 'certificate'");
    return value;
};
const parseCompany = (value) => {
    if (value === undefined || value === null || value === '')
        return null; // null = all companies
    if (!isObjectId(String(value)))
        throw badRequest('companyId is not a valid id');
    return new Types.ObjectId(String(value));
};
const withPlaceholders = (t) => ({ ...t, ...placeholderInfo(t.title, t.body) });
// GET /api/certificates/templates?companyId=&all=true
export const listTemplates = async (req, res) => {
    const filter = {};
    if (req.query.all !== 'true')
        filter.isActive = true;
    const companyId = queryString(req.query.companyId);
    if (companyId) {
        if (!isObjectId(companyId))
            throw badRequest('companyId is not a valid id');
        filter.companyId = { $in: [new Types.ObjectId(companyId), null] };
    }
    const data = await CertificateTemplate.find(filter).sort({ typeLabel: 1 }).lean();
    res.status(200).json({ success: true, data: data.map(withPlaceholders) });
};
// POST /api/certificates/templates   { type, title, body, kind?, companyId? }
export const createTemplate = async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const typeLabel = asText(b.type, 'type', { required: true, max: 100 });
    const typeKey = toTypeKey(typeLabel);
    if (!typeKey)
        throw badRequest('type must contain letters or numbers');
    const template = await CertificateTemplate.create({
        typeKey,
        typeLabel,
        kind: b.kind !== undefined ? parseKind(b.kind) : 'letter',
        title: asText(b.title, 'title', { required: true, max: 200 }),
        body: asText(b.body, 'body', { required: true, max: 8000 }),
        companyId: parseCompany(b.companyId),
        createdBy: new Types.ObjectId(auth.id),
        updatedBy: new Types.ObjectId(auth.id),
    });
    res.status(201).json({ success: true, message: 'Text saved', data: withPlaceholders(template.toObject()) });
};
// PATCH /api/certificates/templates/:id   { type?, title?, body?, kind?, isActive? }
export const updateTemplate = async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const template = await CertificateTemplate.findById(paramId(req));
    if (!template)
        throw notFound('Saved text not found');
    // The type (and company) of a saved text never changes: certificates already issued point to it.
    if (b.type !== undefined && toTypeKey(String(b.type)) !== template.typeKey) {
        throw badRequest('The type of a saved text cannot be changed. Create a new one instead.');
    }
    if (b.title !== undefined)
        template.title = asText(b.title, 'title', { required: true, max: 200 });
    if (b.body !== undefined)
        template.body = asText(b.body, 'body', { required: true, max: 8000 });
    if (b.kind !== undefined)
        template.kind = parseKind(b.kind);
    if (b.isActive !== undefined) {
        if (typeof b.isActive !== 'boolean')
            throw badRequest('isActive must be true or false');
        template.isActive = b.isActive;
    }
    template.updatedBy = new Types.ObjectId(auth.id);
    await template.save();
    res.status(200).json({ success: true, message: 'Saved text updated', data: withPlaceholders(template.toObject()) });
};
// DELETE /api/certificates/templates/:id
// Documents that were already issued are not affected (they keep their own copy of the text).
export const deleteTemplate = async (req, res) => {
    const deleted = await CertificateTemplate.findByIdAndDelete(paramId(req));
    if (!deleted)
        throw notFound('Saved text not found');
    res.status(200).json({ success: true, message: 'Saved text deleted' });
};
