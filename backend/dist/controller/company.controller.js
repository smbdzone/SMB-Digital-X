import Company from '../model/company.model.js';
import { withLogoUrl } from '../services/company.service.js';
import { AppError, asCurrency, asEmail, asText, badRequest, getAuth, isAdmin, notFound, paramId } from '../utils/http.js';
import { uploadToCloudinary } from '../utils/cloudinary.js';
const HEX = /^#[0-9a-fA-F]{6}$/;
// Builds a validated field set. On update only the fields that were sent are included.
const buildCompanyFields = (b, mode) => {
    const f = {};
    const name = mode === 'create'
        ? asText(b.name, 'name', { required: true, max: 100 })
        : asText(b.name, 'name', { max: 100 });
    if (name !== undefined)
        f.name = name;
    if (mode === 'create') {
        const code = asText(b.code, 'code', { required: true, max: 50 }).toLowerCase();
        if (!/^[a-z0-9-]+$/.test(code))
            throw badRequest('code may contain only lowercase letters, numbers and dashes');
        f.code = code;
    }
    for (const key of ['legalName', 'address', 'phone', 'website']) {
        if (b[key] !== undefined)
            f[key] = asText(b[key], key, { max: 300 }) ?? '';
    }
    if (b.logo !== undefined)
        f.logo = asText(b.logo, 'logo', { max: 500 }) ?? '';
    if (b.brandColor !== undefined) {
        if (typeof b.brandColor !== 'string' || !HEX.test(b.brandColor))
            throw badRequest('brandColor must look like #0136B0');
        f.brandColor = b.brandColor;
    }
    if (b.currency !== undefined)
        f.currency = asCurrency(b.currency);
    if (b.isActive !== undefined) {
        if (typeof b.isActive === 'boolean') {
            f.isActive = b.isActive;
        }
        else if (b.isActive === 'true') {
            f.isActive = true;
        }
        else if (b.isActive === 'false') {
            f.isActive = false;
        }
        else {
            throw badRequest('isActive must be true or false');
        }
    }
    if (b.email && typeof b.email === 'object') {
        if (b.email.fromName !== undefined)
            f['email.fromName'] = asText(b.email.fromName, 'email.fromName', { max: 100 }) ?? '';
        if (b.email.fromEmail !== undefined)
            f['email.fromEmail'] = asEmail(b.email.fromEmail, 'email.fromEmail') ?? '';
        if (b.email.replyTo !== undefined)
            f['email.replyTo'] = asEmail(b.email.replyTo, 'email.replyTo') ?? '';
        if (b.email.footerNote !== undefined)
            f['email.footerNote'] = asText(b.email.footerNote, 'email.footerNote', { max: 500 }) ?? '';
    }
    if (b.signatory && typeof b.signatory === 'object') {
        if (b.signatory.name !== undefined)
            f['signatory.name'] = asText(b.signatory.name, 'signatory.name', { max: 100 }) ?? '';
        if (b.signatory.title !== undefined)
            f['signatory.title'] = asText(b.signatory.title, 'signatory.title', { max: 100 }) ?? '';
        if (b.signatory.signature !== undefined)
            f['signatory.signature'] = asText(b.signatory.signature, 'signatory.signature', { max: 100 }) ?? '';
    }
    return f;
};
// GET /api/companies  (?all=true lets an admin see inactive ones too)
export const listCompanies = async (req, res) => {
    const auth = getAuth(req);
    const includeInactive = isAdmin(auth) && req.query.all === 'true';
    const companies = await Company.find(includeInactive ? {} : { isActive: true }).sort({ name: 1 }).lean();
    res.status(200).json({ success: true, data: companies.map(withLogoUrl) });
};
// GET /api/companies/:id
export const getCompany = async (req, res) => {
    const company = await Company.findById(paramId(req)).lean();
    if (!company)
        throw notFound('Company not found');
    res.status(200).json({ success: true, data: withLogoUrl(company) });
};
// POST /api/companies (admin)
export const createCompany = async (req, res) => {
    const file = req.file;
    let upload;
    if (file) {
        upload = await uploadToCloudinary(file.buffer, {
            folder: 'company_logo',
            resource_type: 'auto',
            filename: file.originalname,
        });
    }
    const fields = buildCompanyFields(req.body ? { ...req.body, logo: file ? upload.url : req.body.logo } : {}, 'create');
    const company = await Company.create(fields);
    res.status(201).json({ success: true, message: 'Company created', data: withLogoUrl(company.toObject()) });
};
// PATCH /api/companies/:id (admin) - use { isActive: false } to retire a company (history keeps working)
export const updateCompany = async (req, res) => {
    const file = req.file;
    console.log(file);
    let upload;
    if (file) {
        upload = await uploadToCloudinary(file.buffer, {
            folder: 'company_logo',
            resource_type: 'auto',
            filename: file.originalname,
        });
    }
    const fields = buildCompanyFields(req.body ? { ...req.body, logo: file ? upload.url : req.body.logo } : {}, 'update');
    delete fields.code; // the code is a stable identifier and cannot change
    const company = await Company.findByIdAndUpdate(paramId(req), { $set: fields }, { new: true, runValidators: true }).lean();
    if (!company)
        throw notFound('Company not found');
    res.status(200).json({ success: true, message: 'Company updated', data: withLogoUrl(company) });
};
export const deleteCompany = async (req, res) => {
    const id = paramId(req);
    const deleteCompany = await Company.findByIdAndDelete(id);
    if (!deleteCompany) {
        new AppError(400, 'Company not Deleted');
    }
    res.status(200).json({ success: true, message: 'Company Deleted' });
};
