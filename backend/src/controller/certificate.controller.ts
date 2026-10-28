import { Request, Response } from 'express'
import { Types } from 'mongoose'
import Certificate from '../model/certificate.model.js'
import { CertificateKind } from '../model/certificateTemplate.model.js'
import User from '../model/user.model.js'
import {
    IssueInput, buildCertificatePdf, createIssueContext, issueCertificate as issueOne,
    listAvailableTypes, previewCertificate as previewOne, sendCertificateEmail, toTypeKey,
} from '../services/certificate.service.js'
import {
    asDate, asText, badRequest, conflict, escapeRegex, forbidden, getAuth, isAdmin, isObjectId,
    notFound, paramId, parsePagination, queryString,
} from '../utils/http.js'

/* ------------------------------------------------------------------ */
/* Input parsing                                                       */
/* ------------------------------------------------------------------ */

const asKind = (value: unknown): CertificateKind | undefined => {
    if (value === undefined || value === null || value === '') return undefined
    if (value !== 'letter' && value !== 'certificate') throw badRequest("kind must be 'letter' or 'certificate'")
    return value
}

const asBool = (value: unknown, field: string, fallback: boolean): boolean => {
    if (value === undefined || value === null) return fallback
    if (typeof value !== 'boolean') throw badRequest(`${field} must be true or false`)
    return value
}

// { "courseName": "React Fundamentals" } -> values for {{courseName}}
export const parseVariables = (value: unknown): Record<string, string> => {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('variables must be an object')
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length > 30) throw badRequest('variables has too many entries (max 30)')

    const out: Record<string, string> = {}
    for (const [key, raw] of entries) {
        if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw badRequest(`variables.${key}: names may contain only letters, numbers and _`)
        if (typeof raw !== 'string' && typeof raw !== 'number') throw badRequest(`variables.${key} must be text or a number`)
        const text = String(raw).trim()
        if (text.length > 500) throw badRequest(`variables.${key} must be at most 500 characters`)
        out[key] = text
    }
    return out
}

const parseSignatory = (value: unknown): IssueInput['signatory'] => {
    if (value === undefined || value === null) return undefined
    if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('signatory must be an object')
    const v = value as Record<string, unknown>
    return {
        name: asText(v.name, 'signatory.name', { max: 100 }),
        title: asText(v.title, 'signatory.title', { max: 100 }),
        signature: asText(v.signature, 'signatory.signature', { max: 100 }),
    }
}

const parseIssueInput = (b: any): IssueInput => {
    const templateId = b.templateId ? String(b.templateId) : undefined
    if (templateId && !isObjectId(templateId)) throw badRequest('templateId is not a valid id')
    if (b.companyId && !isObjectId(String(b.companyId))) throw badRequest('companyId is not a valid id')

    return {
        type: asText(b.type, 'type', { max: 100 }),
        templateId,
        title: asText(b.title, 'title', { max: 200 }),
        body: asText(b.body, 'body', { max: 8000 }),
        kind: asKind(b.kind),
        companyId: b.companyId ? String(b.companyId) : undefined,
        issueDate: b.issueDate !== undefined && b.issueDate !== null && b.issueDate !== '' ? asDate(b.issueDate, 'issueDate') : undefined,
        variables: parseVariables(b.variables),
        signatory: parseSignatory(b.signatory),
        sendEmail: asBool(b.sendEmail, 'sendEmail', true),
        saveTemplate: asBool(b.saveTemplate, 'saveTemplate', true),
    }
}

/* ------------------------------------------------------------------ */
/* Admin: issue                                                        */
/* ------------------------------------------------------------------ */

// GET /api/certificates/types?companyId=   (admin)
// Everything the admin can choose from: saved texts + built-in ones.
export const listTypes = async (req: Request, res: Response): Promise<void> => {
    const companyId = queryString(req.query.companyId)
    if (companyId && !isObjectId(companyId)) throw badRequest('companyId is not a valid id')

    res.status(200).json({ success: true, data: await listAvailableTypes(companyId) })
}

// POST /api/certificates/preview   (admin)
// Same body as issuing. Returns the final text without saving or emailing anything.
export const previewCertificate = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const b = req.body ?? {}
    if (!isObjectId(b.employeeId)) throw badRequest('employeeId is required')

    const ctx = await createIssueContext(auth.id, parseIssueInput(b))
    res.status(200).json({ success: true, data: await previewOne(ctx, b.employeeId) })
}

// POST /api/certificates   (admin)
// {
//   employeeId, type: "Course Completion Certificate",
//   title?, body?,                    // first time: required. After that: optional, the saved text is used
//   variables?: { courseName: "..." },
//   companyId?, issueDate?, kind?, signatory?,
//   sendEmail? (default true), saveTemplate? (default true)
// }
export const issueCertificate = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const b = req.body ?? {}
    if (!isObjectId(b.employeeId)) throw badRequest('employeeId is required')

    const ctx = await createIssueContext(auth.id, parseIssueInput(b))
    const { certificate, email } = await issueOne(ctx, b.employeeId)

    const emailFailed = email?.status === 'failed'
    res.status(201).json({
        success: true,
        message: emailFailed
            ? 'Issued, but the email could not be sent. You can resend it.'
            : email ? 'Issued and emailed to the employee' : 'Issued',
        data: certificate,
        email: email ?? { status: 'not_sent' },
    })
}

// POST /api/certificates/bulk   (admin)   { employeeIds: [...], ...same fields as above }
// The same text goes to everyone; {{employeeName}}, {{position}} ... are filled in per person.
export const bulkIssueCertificates = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const b = req.body ?? {}

    if (!Array.isArray(b.employeeIds) || b.employeeIds.length === 0) throw badRequest('employeeIds must be a non-empty array')
    if (b.employeeIds.length > 50) throw badRequest('You can issue to at most 50 employees at once')
    if (!b.employeeIds.every((id: unknown) => isObjectId(id))) throw badRequest('employeeIds contains an invalid id')
    const ids: string[] = [...new Set<string>(b.employeeIds)]

    const ctx = await createIssueContext(auth.id, parseIssueInput(b))

    const results: { employeeId: string; success: boolean; referenceNo?: string; certificateId?: string; email?: string; error?: string }[] = []
    for (const employeeId of ids) {
        try {
            const { certificate, email } = await issueOne(ctx, employeeId)
            results.push({
                employeeId,
                success: true,
                referenceNo: certificate.referenceNo,
                certificateId: String(certificate._id),
                email: email?.status ?? 'not_sent',
            })
        } catch (error) {
            results.push({ employeeId, success: false, error: error instanceof Error ? error.message : 'Unknown error' })
        }
    }

    const issued = results.filter(r => r.success).length
    res.status(200).json({
        success: true,
        message: `Issued ${issued} of ${ids.length}`,
        summary: { requested: ids.length, issued, failed: ids.length - issued },
        data: results,
    })
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

// GET /api/certificates   (admin)
// ?employeeId= &companyId= &type= &kind= &status= &search= &from= &to= &page= &limit=
export const listCertificates = async (req: Request, res: Response): Promise<void> => {
    const q = req.query
    const filter: Record<string, unknown> = {}

    const employeeId = queryString(q.employeeId)
    if (employeeId) {
        if (!isObjectId(employeeId)) throw badRequest('employeeId is not a valid id')
        filter.employeeId = new Types.ObjectId(employeeId)
    }
    const companyId = queryString(q.companyId)
    if (companyId) {
        if (!isObjectId(companyId)) throw badRequest('companyId is not a valid id')
        filter.companyId = new Types.ObjectId(companyId)
    }
    const type = queryString(q.type)
    if (type) filter.typeKey = toTypeKey(type)
    const kind = queryString(q.kind)
    if (kind) filter.kind = asKind(kind)
    const status = queryString(q.status)
    if (status) {
        if (status !== 'issued' && status !== 'revoked') throw badRequest("status must be 'issued' or 'revoked'")
        filter.status = status
    }

    const from = queryString(q.from)
    const to = queryString(q.to)
    if (from || to) {
        const range: Record<string, Date> = {}
        if (from) range.$gte = asDate(from, 'from')
        if (to) range.$lte = asDate(to, 'to')
        filter.issueDate = range
    }

    const search = queryString(q.search)
    if (search) {
        const rx = new RegExp(escapeRegex(search), 'i')
        filter.$or = [{ 'recipient.name': rx }, { referenceNo: rx }, { title: rx }, { typeLabel: rx }]
    }

    const { page, limit, skip } = parsePagination(q)
    const [data, total] = await Promise.all([
        Certificate.find(filter).sort({ issueDate: -1, createdAt: -1 }).skip(skip).limit(limit).lean(),
        Certificate.countDocuments(filter),
    ])

    res.status(200).json({
        success: true,
        message: 'Certificates fetched successfully',
        data,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
}

// GET /api/certificates/my   (any logged-in user: their own issued documents)
export const getMyCertificates = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const data = await Certificate.find({ employeeId: auth.id, status: 'issued' })
        .select('-variables')
        .sort({ issueDate: -1 })
        .limit(200)
        .lean()
    res.status(200).json({ success: true, data })
}

// Admin can open anything; an employee only their own, and only while it is not revoked.
const loadAccessible = async (req: Request) => {
    const auth = getAuth(req)
    const cert = await Certificate.findById(paramId(req))
    if (!cert) throw notFound('Certificate not found')

    if (!isAdmin(auth)) {
        if (String(cert.employeeId) !== auth.id) throw forbidden('You can only view your own certificates')
        if (cert.status === 'revoked') throw notFound('Certificate not found')
    }
    return cert
}

// GET /api/certificates/:id
export const getCertificate = async (req: Request, res: Response): Promise<void> => {
    const cert = await loadAccessible(req)
    res.status(200).json({ success: true, data: cert })
}

// GET /api/certificates/:id/pdf   (?inline=true to open in the browser instead of downloading)
export const downloadCertificatePdf = async (req: Request, res: Response): Promise<void> => {
    const cert = await loadAccessible(req)
    const { pdf, fileName } = await buildCertificatePdf(cert)

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Length', String(pdf.length))
    res.setHeader('Content-Disposition', `${req.query.inline === 'true' ? 'inline' : 'attachment'}; filename="${fileName}"`)
    res.status(200).end(pdf)
}

/* ------------------------------------------------------------------ */
/* Admin: resend / revoke                                              */
/* ------------------------------------------------------------------ */

// POST /api/certificates/:id/resend-email   (admin)
export const resendCertificateEmail = async (req: Request, res: Response): Promise<void> => {
    const cert = await Certificate.findById(paramId(req))
    if (!cert) throw notFound('Certificate not found')
    if (cert.status === 'revoked') throw badRequest('A revoked certificate cannot be emailed')

    // Use the employee's current address if they have one, else the one saved at issue time.
    const employee = await User.findById(cert.employeeId).select('email').lean()
    const outcome = await sendCertificateEmail(cert, employee?.email || cert.recipient.email)

    res.status(200).json({
        success: outcome.status === 'sent',
        message: outcome.status === 'sent' ? 'Email sent' : `Email failed: ${outcome.error}`,
        email: outcome,
    })
}

// PATCH /api/certificates/:id/revoke   (admin)   { reason? }
export const revokeCertificate = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req)
    const cert = await Certificate.findById(paramId(req))
    if (!cert) throw notFound('Certificate not found')
    if (cert.status === 'revoked') throw conflict('This certificate is already revoked')

    cert.status = 'revoked'
    cert.revokedAt = new Date()
    cert.revokedBy = new Types.ObjectId(auth.id)
    cert.revokeReason = asText(req.body?.reason, 'reason', { max: 500 })
    await cert.save()

    res.status(200).json({ success: true, message: 'Certificate revoked', data: cert })
}
