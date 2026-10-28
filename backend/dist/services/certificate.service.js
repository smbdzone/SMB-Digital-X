import { Types } from 'mongoose';
import Certificate from '../model/certificate.model.js';
import CertificateTemplate from '../model/certificateTemplate.model.js';
import Company from '../model/company.model.js';
import User from '../model/user.model.js';
import { nextSequence } from '../model/counter.model.js';
import { sendCompanyMail } from '../email/email.js';
import { generateCertificateMessage } from '../email/certificateMessage.js';
import { certificateFileName, generateCertificatePdf } from '../email/certificatePdf.js';
import { resolveActiveCompanyId, resolveLogoUrl } from './company.service.js';
import { DEFAULT_TEMPLATES, getDefaultTemplate } from './certificateDefaults.js';
import { badRequest, notFound } from '../utils/http.js';
/* ------------------------------------------------------------------ */
/* Placeholders                                                        */
/* ------------------------------------------------------------------ */
/**
 * Placeholders the system fills in by itself. Anything else used in a text, such as
 * {{courseName}}, has to be sent in `variables` when issuing.
 * Any automatic value can also be overridden through `variables` (e.g. a real joining date).
 */
export const AUTO_VARIABLES = [
    'employeeName', 'employeeEmail', 'position',
    'companyName', 'companyLegalName',
    'issueDate', 'joiningDate',
    'salary', 'currency',
    'signatoryName', 'signatoryTitle',
];
const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g;
export const findPlaceholders = (...texts) => {
    const found = new Set();
    for (const text of texts)
        for (const m of text.matchAll(PLACEHOLDER))
            found.add(m[1]);
    return [...found];
};
export const placeholderInfo = (title, body) => {
    const all = findPlaceholders(title, body);
    return {
        placeholders: all,
        // The ones the admin has to provide when issuing
        customPlaceholders: all.filter(p => !AUTO_VARIABLES.includes(p)),
    };
};
const renderText = (text, vars) => {
    const missing = new Set();
    const out = text.replace(PLACEHOLDER, (_all, key) => {
        if (Object.prototype.hasOwnProperty.call(vars, key))
            return vars[key];
        missing.add(key);
        return _all;
    });
    return { text: out, missing: [...missing] };
};
/** "Course Completion Certificate" -> "course_completion_certificate" */
export const toTypeKey = (type) => type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
const formatLongDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const formatMoney = (amount) => amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* ------------------------------------------------------------------ */
/* Saved texts (templates)                                             */
/* ------------------------------------------------------------------ */
/** The text to use for a type: this company's saved text, else the "all companies" one. */
const findSavedTemplate = async (typeKey, companyId) => {
    const found = await CertificateTemplate.find({
        typeKey,
        isActive: true,
        companyId: { $in: [companyId, null] },
    }).lean();
    return found.find(t => t.companyId && String(t.companyId) === String(companyId))
        ?? found.find(t => !t.companyId)
        ?? null;
};
/**
 * Everything the admin can pick from: saved texts first, then the built-in ones that have not
 * been customised yet. With a companyId, saved texts of that company win over "all companies" ones.
 */
export const listAvailableTypes = async (companyId) => {
    const filter = { isActive: true };
    if (companyId)
        filter.companyId = { $in: [new Types.ObjectId(companyId), null] };
    let saved = await CertificateTemplate.find(filter).sort({ typeLabel: 1 }).lean();
    if (companyId) {
        const byKey = new Map();
        for (const t of saved) {
            const current = byKey.get(t.typeKey);
            if (!current || (t.companyId && !current.companyId))
                byKey.set(t.typeKey, t);
        }
        saved = [...byKey.values()];
    }
    const savedKeys = new Set(saved.map(t => t.typeKey));
    return [
        ...saved.map(t => ({
            source: 'saved',
            templateId: String(t._id),
            companyId: t.companyId ? String(t.companyId) : null,
            typeKey: t.typeKey,
            typeLabel: t.typeLabel,
            kind: t.kind,
            title: t.title,
            body: t.body,
            timesUsed: t.timesUsed,
            lastUsedAt: t.lastUsedAt ?? null,
            ...placeholderInfo(t.title, t.body),
        })),
        ...DEFAULT_TEMPLATES.filter(d => !savedKeys.has(d.typeKey)).map(d => ({
            source: 'default',
            templateId: null,
            companyId: null,
            typeKey: d.typeKey,
            typeLabel: d.typeLabel,
            kind: d.kind,
            title: d.title,
            body: d.body,
            timesUsed: 0,
            lastUsedAt: null,
            ...placeholderInfo(d.title, d.body),
        })),
    ];
};
export const createIssueContext = async (adminId, input) => {
    const admin = await User.findById(adminId).select('name').lean();
    return { adminId, adminName: admin?.name ?? '', input, contents: new Map() };
};
const prepareContent = async (ctx, companyId) => {
    const { input } = ctx;
    const cacheKey = String(companyId);
    const cached = ctx.contents.get(cacheKey);
    if (cached)
        return cached;
    let saved = null;
    let typeKey;
    let typeLabel;
    if (input.templateId) {
        saved = await CertificateTemplate.findOne({ _id: input.templateId, isActive: true }).lean();
        if (!saved)
            throw notFound('Saved text not found');
        typeKey = saved.typeKey;
        typeLabel = saved.typeLabel;
    }
    else {
        if (!input.type)
            throw badRequest('type is required (for example "Joining Letter")');
        typeKey = toTypeKey(input.type);
        if (!typeKey)
            throw badRequest('type must contain letters or numbers');
        typeLabel = input.type;
        saved = await findSavedTemplate(typeKey, companyId);
    }
    const fallback = saved ?? getDefaultTemplate(typeKey) ?? null;
    const title = input.title ?? fallback?.title;
    const body = input.body ?? fallback?.body;
    const kind = input.kind ?? fallback?.kind ?? 'letter';
    if (!title || !body) {
        throw badRequest(`There is no saved text for "${typeLabel}" yet. Send "title" and "body" this time; they will be remembered for next time.`);
    }
    const changed = !fallback || fallback.title !== title || fallback.body !== body || fallback.kind !== kind;
    const wroteText = input.title !== undefined || input.body !== undefined || input.kind !== undefined;
    const content = {
        typeKey,
        typeLabel,
        kind,
        title,
        body,
        templateId: saved?._id,
        // Only a company's own saved text counts as "already remembered" for that company.
        pendingSave: input.saveTemplate && wroteText && changed,
        companyId,
    };
    ctx.contents.set(cacheKey, content);
    return content;
};
const rememberContent = async (ctx, content) => {
    if (!content.pendingSave)
        return;
    const saved = await CertificateTemplate.findOneAndUpdate({ typeKey: content.typeKey, companyId: content.companyId }, {
        $set: {
            typeLabel: content.typeLabel,
            kind: content.kind,
            title: content.title,
            body: content.body,
            isActive: true,
            updatedBy: new Types.ObjectId(ctx.adminId),
        },
        $setOnInsert: { createdBy: new Types.ObjectId(ctx.adminId) },
    }, { upsert: true, new: true, setDefaultsOnInsert: true });
    content.templateId = saved._id;
    content.pendingSave = false;
};
const buildVariables = (employee, company, issueDate, signatory, custom) => {
    const vars = {};
    const set = (key, value) => {
        if (value === undefined || value === null)
            return;
        const text = String(value).trim();
        if (text !== '')
            vars[key] = text;
    };
    set('employeeName', employee.name);
    set('employeeEmail', employee.email);
    set('position', employee.position);
    set('companyName', company.name);
    set('companyLegalName', company.legalName || company.name);
    set('issueDate', formatLongDate(issueDate));
    // The account creation date is the best "joining date" the system has. Send variables.joiningDate to override it.
    if (employee.createdAt)
        set('joiningDate', formatLongDate(employee.createdAt));
    if (typeof employee.salary?.amount === 'number') {
        set('salary', formatMoney(employee.salary.amount));
        set('currency', employee.salary.currency);
    }
    set('signatoryName', signatory.name);
    set('signatoryTitle', signatory.title);
    for (const [key, value] of Object.entries(custom))
        vars[key] = value;
    return vars;
};
/** Checks everything and works out the final text. Writes nothing to the database. */
const prepare = async (ctx, employeeId) => {
    const { input } = ctx;
    // Any status is allowed: relieving / experience letters go to people who already left.
    const employee = await User.findById(employeeId).select('name email position salary createdAt').lean();
    if (!employee)
        throw notFound('Employee not found');
    const companyId = await resolveActiveCompanyId(input.companyId, employeeId);
    const company = await Company.findById(companyId).lean();
    if (!company)
        throw badRequest('Company not found or inactive');
    const content = await prepareContent(ctx, companyId);
    const issueDate = input.issueDate ?? new Date();
    const signatory = {
        name: input.signatory?.name || company.signatory?.name || ctx.adminName || undefined,
        title: input.signatory?.title || company.signatory?.title || undefined,
        signature: input.signatory?.signature || company.signatory?.signature || undefined,
    };
    const variables = buildVariables(employee, company, issueDate, signatory, input.variables);
    const title = renderText(content.title, variables);
    const body = renderText(content.body, variables);
    const missing = [...new Set([...title.missing, ...body.missing])];
    if (missing.length > 0) {
        throw badRequest(`Missing values for: ${missing.join(', ')}. Send them in "variables", e.g. { "${missing[0]}": "..." }`, { missing });
    }
    return {
        employee: employee,
        company,
        content,
        issueDate,
        title: title.text.trim(),
        body: body.text.trim(),
        variables,
        signatory,
    };
};
/** Shows exactly what would be issued, without saving or sending anything. */
export const previewCertificate = async (ctx, employeeId) => {
    const p = await prepare(ctx, employeeId);
    return {
        typeKey: p.content.typeKey,
        typeLabel: p.content.typeLabel,
        kind: p.content.kind,
        title: p.title,
        body: p.body,
        issueDate: p.issueDate,
        signatory: p.signatory,
        recipient: { name: p.employee.name, email: p.employee.email, position: p.employee.position },
        companyName: p.company.name,
        willRememberWording: p.content.pendingSave,
        ...placeholderInfo(p.content.title, p.content.body),
    };
};
const nextReference = async (company, kind, issueDate) => {
    const year = issueDate.getUTCFullYear();
    const seq = await nextSequence(`cert:${company.code}:${kind}:${year}`);
    return `${company.code.toUpperCase()}-${kind === 'certificate' ? 'CRT' : 'LTR'}-${year}-${String(seq).padStart(4, '0')}`;
};
export const issueCertificate = async (ctx, employeeId) => {
    const p = await prepare(ctx, employeeId);
    await rememberContent(ctx, p.content);
    const referenceNo = await nextReference(p.company, p.content.kind, p.issueDate);
    const certificate = await Certificate.create({
        referenceNo,
        employeeId: p.employee._id,
        companyId: p.company._id,
        issuedBy: new Types.ObjectId(ctx.adminId),
        issuedByName: ctx.adminName,
        typeKey: p.content.typeKey,
        typeLabel: p.content.typeLabel,
        kind: p.content.kind,
        templateId: p.content.templateId,
        title: p.title,
        body: p.body,
        variables: p.variables,
        issueDate: p.issueDate,
        signatory: p.signatory,
        recipient: { name: p.employee.name, email: p.employee.email, position: p.employee.position },
        companyName: p.company.name,
    });
    if (p.content.templateId) {
        await CertificateTemplate.updateOne({ _id: p.content.templateId }, { $inc: { timesUsed: 1 }, $set: { lastUsedAt: new Date() } });
    }
    if (!ctx.input.sendEmail)
        return { certificate };
    const email = await sendCertificateEmail(certificate, p.employee.email, p.company);
    return { certificate, email };
};
/* ------------------------------------------------------------------ */
/* PDF + email                                                         */
/* ------------------------------------------------------------------ */
export const buildCertificatePdf = async (cert, companyDoc) => {
    const company = companyDoc !== undefined
        ? companyDoc
        : await Company.findById(cert.companyId).lean();
    const pdf = await generateCertificatePdf({
        kind: cert.kind,
        company: {
            name: company?.name ?? cert.companyName,
            legalName: company?.legalName,
            logoUrl: resolveLogoUrl(company?.logo),
            brandColor: company?.brandColor,
            address: company?.address,
            phone: company?.phone,
            website: company?.website,
            footerNote: company?.email?.footerNote,
        },
        referenceNo: cert.referenceNo,
        title: cert.title,
        body: cert.body,
        employeeName: cert.recipient.name,
        issueDate: cert.issueDate,
        signatory: cert.signatory ?? {},
        revoked: cert.status === 'revoked',
    });
    return { pdf, fileName: certificateFileName(cert.referenceNo) };
};
export const sendCertificateEmail = async (cert, toEmail, companyDoc) => {
    const record = async (patch) => {
        await Certificate.updateOne({ _id: cert._id }, { $set: patch });
    };
    try {
        const company = companyDoc !== undefined
            ? companyDoc
            : await Company.findById(cert.companyId).lean();
        if (!company)
            throw new Error('The issuing company no longer exists');
        if (!toEmail)
            throw new Error('Employee has no email address');
        const { pdf, fileName } = await buildCertificatePdf(cert, company);
        const message = generateCertificateMessage({
            companyName: company.name,
            employeeName: cert.recipient.name,
            title: cert.title,
            referenceNo: cert.referenceNo,
            brandColor: company.brandColor,
            footerNote: company.email?.footerNote,
        });
        await sendCompanyMail({
            to: toEmail,
            subject: `${company.name} – ${cert.title}`,
            html: message.html,
            text: message.text,
            attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
            company,
        });
        await record({ 'email.status': 'sent', 'email.sentAt': new Date(), 'email.lastAttemptAt': new Date(), 'email.error': '' });
        return { status: 'sent' };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown email error';
        console.error(`Failed to send certificate ${cert.referenceNo}:`, message);
        await record({ 'email.status': 'failed', 'email.lastAttemptAt': new Date(), 'email.error': message.slice(0, 500) });
        return { status: 'failed', error: message };
    }
};
