import { Types } from 'mongoose'
import Certificate, { ICertificate } from '../model/certificate.model.js'
import CertificateTemplate, { CertificateKind, ICertificateTemplate } from '../model/certificateTemplate.model.js'
import Company, { ICompany } from '../model/company.model.js'
import User from '../model/user.model.js'
import { nextSequence } from '../model/counter.model.js'
import { sendCompanyMail } from '../email/email.js'
import { generateCertificateMessage } from '../email/certificateMessage.js'
import { certificateFileName, generateCertificatePdf } from '../email/certificatePdf.js'
import { resolveActiveCompanyId, resolveLogoUrl } from './company.service.js'
import { DEFAULT_TEMPLATES, getDefaultTemplate } from './certificateDefaults.js'
import { badRequest, notFound } from '../utils/http.js'

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
] as const

const PLACEHOLDER = /\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g

export const findPlaceholders = (...texts: string[]): string[] => {
    const found = new Set<string>()
    for (const text of texts) for (const m of text.matchAll(PLACEHOLDER)) found.add(m[1])
    return [...found]
}

export const placeholderInfo = (title: string, body: string) => {
    const all = findPlaceholders(title, body)
    return {
        placeholders: all,
        // The ones the admin has to provide when issuing
        customPlaceholders: all.filter(p => !(AUTO_VARIABLES as readonly string[]).includes(p)),
    }
}

const renderText = (text: string, vars: Record<string, string>): { text: string; missing: string[] } => {
    const missing = new Set<string>()
    const out = text.replace(PLACEHOLDER, (_all, key: string) => {
        if (Object.prototype.hasOwnProperty.call(vars, key)) return vars[key]
        missing.add(key)
        return _all
    })
    return { text: out, missing: [...missing] }
}

/** "Course Completion Certificate" -> "course_completion_certificate" */
export const toTypeKey = (type: string): string =>
    type.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60)

const formatLongDate = (date: Date): string =>
    new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

const formatMoney = (amount: number): string =>
    amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/* ------------------------------------------------------------------ */
/* Saved texts (templates)                                             */
/* ------------------------------------------------------------------ */

/** The text to use for a type: this company's saved text, else the "all companies" one. */
const findSavedTemplate = async (typeKey: string, companyId: Types.ObjectId): Promise<ICertificateTemplate | null> => {
    const found = await CertificateTemplate.find({
        typeKey,
        isActive: true,
        companyId: { $in: [companyId, null] },
    }).lean() as unknown as ICertificateTemplate[]

    return found.find(t => t.companyId && String(t.companyId) === String(companyId))
        ?? found.find(t => !t.companyId)
        ?? null
}

/**
 * Everything the admin can pick from: saved texts first, then the built-in ones that have not
 * been customised yet. With a companyId, saved texts of that company win over "all companies" ones.
 */
export const listAvailableTypes = async (companyId?: string) => {
    const filter: Record<string, unknown> = { isActive: true }
    if (companyId) filter.companyId = { $in: [new Types.ObjectId(companyId), null] }

    let saved = await CertificateTemplate.find(filter).sort({ typeLabel: 1 }).lean() as unknown as ICertificateTemplate[]

    if (companyId) {
        const byKey = new Map<string, ICertificateTemplate>()
        for (const t of saved) {
            const current = byKey.get(t.typeKey)
            if (!current || (t.companyId && !current.companyId)) byKey.set(t.typeKey, t)
        }
        saved = [...byKey.values()]
    }

    const savedKeys = new Set(saved.map(t => t.typeKey))

    return [
        ...saved.map(t => ({
            source: 'saved' as const,
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
            source: 'default' as const,
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
    ]
}

/* ------------------------------------------------------------------ */
/* Issuing                                                             */
/* ------------------------------------------------------------------ */

export interface IssueInput {
    type?: string                       // free text, e.g. "Course Completion Certificate"
    templateId?: string                 // alternative to `type`: use this saved text
    title?: string                      // omit to use the saved / built-in text for the type
    body?: string
    kind?: CertificateKind
    companyId?: string                  // default: the employee's own company
    issueDate?: Date
    variables: Record<string, string>   // values for {{placeholders}}
    signatory?: { name?: string; title?: string; signature?: string }
    sendEmail: boolean                  // default true
    saveTemplate: boolean               // default true: remember this wording for next time
}

// The text that is going to be used for one company, worked out once and shared by a bulk issue.
interface Content {
    typeKey: string
    typeLabel: string
    kind: CertificateKind
    title: string
    body: string
    templateId?: Types.ObjectId
    pendingSave: boolean     // new wording that still has to be remembered
    companyId: Types.ObjectId
}

export interface IssueContext {
    adminId: string
    adminName: string
    input: IssueInput
    contents: Map<string, Content>
}

export const createIssueContext = async (adminId: string, input: IssueInput): Promise<IssueContext> => {
    const admin = await User.findById(adminId).select('name').lean()
    return { adminId, adminName: admin?.name ?? '', input, contents: new Map() }
}

const prepareContent = async (ctx: IssueContext, companyId: Types.ObjectId): Promise<Content> => {
    const { input } = ctx
    const cacheKey = String(companyId)
    const cached = ctx.contents.get(cacheKey)
    if (cached) return cached

    let saved: ICertificateTemplate | null = null
    let typeKey: string
    let typeLabel: string

    if (input.templateId) {
        saved = await CertificateTemplate.findOne({ _id: input.templateId, isActive: true }).lean() as unknown as ICertificateTemplate | null
        if (!saved) throw notFound('Saved text not found')
        typeKey = saved.typeKey
        typeLabel = saved.typeLabel
    } else {
        if (!input.type) throw badRequest('type is required (for example "Joining Letter")')
        typeKey = toTypeKey(input.type)
        if (!typeKey) throw badRequest('type must contain letters or numbers')
        typeLabel = input.type
        saved = await findSavedTemplate(typeKey, companyId)
    }

    const fallback = saved ?? getDefaultTemplate(typeKey) ?? null
    const title = input.title ?? fallback?.title
    const body = input.body ?? fallback?.body
    const kind: CertificateKind = input.kind ?? fallback?.kind ?? 'letter'

    if (!title || !body) {
        throw badRequest(`There is no saved text for "${typeLabel}" yet. Send "title" and "body" this time; they will be remembered for next time.`)
    }

    const changed = !fallback || fallback.title !== title || fallback.body !== body || fallback.kind !== kind
    const wroteText = input.title !== undefined || input.body !== undefined || input.kind !== undefined

    const content: Content = {
        typeKey,
        typeLabel,
        kind,
        title,
        body,
        templateId: saved?._id as Types.ObjectId | undefined,
        // Only a company's own saved text counts as "already remembered" for that company.
        pendingSave: input.saveTemplate && wroteText && changed,
        companyId,
    }
    ctx.contents.set(cacheKey, content)
    return content
}

const rememberContent = async (ctx: IssueContext, content: Content): Promise<void> => {
    if (!content.pendingSave) return
    const saved = await CertificateTemplate.findOneAndUpdate(
        { typeKey: content.typeKey, companyId: content.companyId },
        {
            $set: {
                typeLabel: content.typeLabel,
                kind: content.kind,
                title: content.title,
                body: content.body,
                isActive: true,
                updatedBy: new Types.ObjectId(ctx.adminId),
            },
            $setOnInsert: { createdBy: new Types.ObjectId(ctx.adminId) },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )
    content.templateId = saved._id as Types.ObjectId
    content.pendingSave = false
}

const buildVariables = (
    employee: { name: string; email?: string; position?: string; salary?: { amount?: number; currency?: string }; createdAt?: Date },
    company: ICompany,
    issueDate: Date,
    signatory: { name?: string; title?: string },
    custom: Record<string, string>,
): Record<string, string> => {
    const vars: Record<string, string> = {}
    const set = (key: string, value: unknown) => {
        if (value === undefined || value === null) return
        const text = String(value).trim()
        if (text !== '') vars[key] = text
    }

    set('employeeName', employee.name)
    set('employeeEmail', employee.email)
    set('position', employee.position)
    set('companyName', company.name)
    set('companyLegalName', company.legalName || company.name)
    set('issueDate', formatLongDate(issueDate))
    // The account creation date is the best "joining date" the system has. Send variables.joiningDate to override it.
    if (employee.createdAt) set('joiningDate', formatLongDate(employee.createdAt))
    if (typeof employee.salary?.amount === 'number') {
        set('salary', formatMoney(employee.salary.amount))
        set('currency', employee.salary.currency)
    }
    set('signatoryName', signatory.name)
    set('signatoryTitle', signatory.title)

    for (const [key, value] of Object.entries(custom)) vars[key] = value
    return vars
}

interface Prepared {
    employee: { _id: Types.ObjectId; name: string; email?: string; position?: string }
    company: ICompany
    content: Content
    issueDate: Date
    title: string
    body: string
    variables: Record<string, string>
    signatory: { name?: string; title?: string; signature?: string }
}

/** Checks everything and works out the final text. Writes nothing to the database. */
const prepare = async (ctx: IssueContext, employeeId: string): Promise<Prepared> => {
    const { input } = ctx

    // Any status is allowed: relieving / experience letters go to people who already left.
    const employee = await User.findById(employeeId).select('name email position salary createdAt').lean()
    if (!employee) throw notFound('Employee not found')

    const companyId = await resolveActiveCompanyId(input.companyId, employeeId)
    const company = await Company.findById(companyId).lean() as unknown as ICompany | null
    if (!company) throw badRequest('Company not found or inactive')

    const content = await prepareContent(ctx, companyId)
    const issueDate = input.issueDate ?? new Date()

    const signatory = {
        name: input.signatory?.name || company.signatory?.name || ctx.adminName || undefined,
        title: input.signatory?.title || company.signatory?.title || undefined,
        signature: input.signatory?.signature || company.signatory?.signature || undefined,
    }

    const variables = buildVariables(employee as any, company, issueDate, signatory, input.variables)
    const title = renderText(content.title, variables)
    const body = renderText(content.body, variables)

    const missing = [...new Set([...title.missing, ...body.missing])]
    if (missing.length > 0) {
        throw badRequest(
            `Missing values for: ${missing.join(', ')}. Send them in "variables", e.g. { "${missing[0]}": "..." }`,
            { missing }
        )
    }

    return {
        employee: employee as any,
        company,
        content,
        issueDate,
        title: title.text.trim(),
        body: body.text.trim(),
        variables,
        signatory,
    }
}

/** Shows exactly what would be issued, without saving or sending anything. */
export const previewCertificate = async (ctx: IssueContext, employeeId: string) => {
    const p = await prepare(ctx, employeeId)
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
    }
}

const nextReference = async (company: ICompany, kind: CertificateKind, issueDate: Date): Promise<string> => {
    const year = issueDate.getUTCFullYear()
    const seq = await nextSequence(`cert:${company.code}:${kind}:${year}`)
    return `${company.code.toUpperCase()}-${kind === 'certificate' ? 'CRT' : 'LTR'}-${year}-${String(seq).padStart(4, '0')}`
}

export interface EmailOutcome {
    status: 'sent' | 'failed'
    error?: string
}

export interface IssueResult {
    certificate: ICertificate
    email?: EmailOutcome
}

export const issueCertificate = async (ctx: IssueContext, employeeId: string): Promise<IssueResult> => {
    const p = await prepare(ctx, employeeId)

    await rememberContent(ctx, p.content)

    const referenceNo = await nextReference(p.company, p.content.kind, p.issueDate)

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
    })

    if (p.content.templateId) {
        await CertificateTemplate.updateOne(
            { _id: p.content.templateId },
            { $inc: { timesUsed: 1 }, $set: { lastUsedAt: new Date() } }
        )
    }

    if (!ctx.input.sendEmail) return { certificate }

    const email = await sendCertificateEmail(certificate, p.employee.email, p.company)
    return { certificate, email }
}

/* ------------------------------------------------------------------ */
/* PDF + email                                                         */
/* ------------------------------------------------------------------ */

export const buildCertificatePdf = async (cert: ICertificate, companyDoc?: ICompany | null): Promise<{ pdf: Buffer; fileName: string }> => {
    const company = companyDoc !== undefined
        ? companyDoc
        : await Company.findById(cert.companyId).lean() as unknown as ICompany | null

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
    })
    return { pdf, fileName: certificateFileName(cert.referenceNo) }
}

export const sendCertificateEmail = async (
    cert: ICertificate,
    toEmail: string | undefined,
    companyDoc?: ICompany | null,
): Promise<EmailOutcome> => {
    const record = async (patch: Record<string, unknown>) => {
        await Certificate.updateOne({ _id: cert._id }, { $set: patch })
    }

    try {
        const company = companyDoc !== undefined
            ? companyDoc
            : await Company.findById(cert.companyId).lean() as unknown as ICompany | null
        if (!company) throw new Error('The issuing company no longer exists')
        if (!toEmail) throw new Error('Employee has no email address')

        const { pdf, fileName } = await buildCertificatePdf(cert, company)
        const message = generateCertificateMessage({
            companyName: company.name,
            employeeName: cert.recipient.name,
            title: cert.title,
            referenceNo: cert.referenceNo,
            brandColor: company.brandColor,
            footerNote: company.email?.footerNote,
        })

        await sendCompanyMail({
            to: toEmail,
            subject: `${company.name} – ${cert.title}`,
            html: message.html,
            text: message.text,
            attachments: [{ filename: fileName, content: pdf, contentType: 'application/pdf' }],
            company,
        })

        await record({ 'email.status': 'sent', 'email.sentAt': new Date(), 'email.lastAttemptAt': new Date(), 'email.error': '' })
        return { status: 'sent' }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown email error'
        console.error(`Failed to send certificate ${cert.referenceNo}:`, message)
        await record({ 'email.status': 'failed', 'email.lastAttemptAt': new Date(), 'email.error': message.slice(0, 500) })
        return { status: 'failed', error: message }
    }
}
