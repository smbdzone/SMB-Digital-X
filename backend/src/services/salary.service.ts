import mongoose, { Types } from 'mongoose'
import Salary, { ILineItem, IPaymentDetails } from '../model/salary.model.js'
import User from '../model/user.model.js'
import Company, { ICompany } from '../model/company.model.js'
import { sendSalarySlip } from '../email/email.js'
import { SalarySlipData, formatMonthLabel } from '../email/emailTemplate.js'
import { generateSalarySlipPdf, slipFileName } from '../email/salarySlipPdf.js'
import { generateSlipMessage } from '../email/slipMessage.js'
import { resolveLogoUrl, resolveActiveCompanyId } from './company.service.js'
import { AppError, conflict, notFound } from '../utils/http.js'
import { round2, sumMoney } from '../utils/money.js'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Current "YYYY-MM" in the payroll timezone (defaults to Asia/Dubai, override with PAYROLL_TIMEZONE). */
export const currentMonth = (timeZone: string = process.env.PAYROLL_TIMEZONE || 'Asia/Dubai'): string => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).formatToParts(new Date())
    const year = parts.find(p => p.type === 'year')?.value
    const month = parts.find(p => p.type === 'month')?.value
    return `${year}-${month}`
}

export const computeTotals = (input: { salary: number; allowances?: ILineItem[]; deductions?: ILineItem[] }) => {
    const totalAllowances = sumMoney((input.allowances ?? []).map(a => a.amount))
    const totalDeductions = sumMoney((input.deductions ?? []).map(d => d.amount))
    const grossAmount = sumMoney([input.salary, totalAllowances])
    const netPay = round2(grossAmount - totalDeductions)
    if (netPay < 0) throw new AppError(400, 'Deductions cannot be more than the gross pay')
    return { totalAllowances, totalDeductions, grossAmount, netPay }
}

/* ------------------------------------------------------------------ */
/* Monthly generation (used by the cron job and POST /salary/generate) */
/* ------------------------------------------------------------------ */

export interface GenerateResult {
    month: string
    created: number
    alreadyExisted: number
    skipped: { employeeId: string; name: string; reason: string }[]
}

/**
 * Creates the pending salary record for every active employee for `month`.
 * Safe to run any number of times: existing records are never touched (upsert + $setOnInsert),
 * so double runs, multiple server instances and catch-up runs cannot create duplicates.
 */
export const generateMonthlySalaries = async (month: string, companyId?: string): Promise<GenerateResult> => {
    const filter: Record<string, unknown> = { status: 'active', role: 'employee' }
    if (companyId) filter.companyId = new Types.ObjectId(companyId)

    const [employees, companies] = await Promise.all([
        User.find(filter).select('name salary companyId').lean(),
        Company.find({ isActive: true }).select('_id').lean(),
    ])
    const activeCompanyIds = new Set(companies.map(c => String(c._id)))

    const skipped: GenerateResult['skipped'] = []
    const ops: mongoose.AnyBulkWriteOperation<any>[] = []

    for (const e of employees) {
        const amount = e.salary?.amount
        let reason: string | undefined

        if (!(typeof amount === 'number' && amount > 0)) reason = 'No salary amount set'
        else if (!e.companyId) reason = 'No company assigned'
        else if (!activeCompanyIds.has(String(e.companyId))) reason = 'Assigned company is inactive'

        if (reason || typeof amount !== 'number') {
            skipped.push({ employeeId: String(e._id), name: e.name, reason: reason ?? 'Invalid salary' })
            continue
        }

        ops.push({
            updateOne: {
                filter: { employeeId: e._id, month },
                update: {
                    $setOnInsert: {
                        companyId: e.companyId,
                        currency: e.salary?.currency || 'AED',
                        salary: amount,
                        allowances: [],
                        deductions: [],
                        totalAllowances: 0,
                        totalDeductions: 0,
                        grossAmount: amount,
                        netPay: amount,
                        status: 'pending',
                        email: { status: 'not_sent', attempts: 0 },
                        notes: '',
                    },
                },
                upsert: true,
            },
        })
    }

    let created = 0
    if (ops.length) {
        const result = await Salary.bulkWrite(ops, { ordered: false })
        created = result.upsertedCount
    }

    if (skipped.length) {
        console.warn(`[payroll ${month}] skipped ${skipped.length} employee(s):`, skipped.map(s => `${s.name} (${s.reason})`).join(', '))
    }

    return { month, created, alreadyExisted: ops.length - created, skipped }
}

/* ------------------------------------------------------------------ */
/* Salary slip email (company branded)                                 */
/* ------------------------------------------------------------------ */

export interface EmailOutcome {
    status: 'sent' | 'failed'
    error?: string
}

const recordEmail = (id: Types.ObjectId | string, outcome: EmailOutcome) =>
    Salary.updateOne(
        { _id: id },
        {
            $set: {
                'email.status': outcome.status,
                'email.lastError': outcome.error ?? '',
                ...(outcome.status === 'sent' ? { 'email.sentAt': new Date() } : {}),
            },
            $inc: { 'email.attempts': 1 },
        }
    )

/**
 * Builds the slip using the PAYING company's logo, name, address, colour, signatory and sender,
 * sends it, and records the result on the salary document. Never throws for delivery problems,
 * so a mail outage cannot undo a payment; the outcome is stored and returned instead.
 */
export const sendSlipEmail = async (salaryId: string | Types.ObjectId): Promise<EmailOutcome> => {
    const doc = await Salary.findById(salaryId)
        .populate('employeeId', 'name email position')
        .populate('companyId')
        .populate('paidBy', 'name')

    if (!doc) throw notFound('Salary record not found')
    if (doc.status !== 'paid') throw conflict('A salary slip can only be sent after the salary is marked as paid')

    const employee = doc.employeeId as unknown as { name?: string; email?: string; position?: string } | null
    const company = doc.companyId as unknown as ICompany | null
    const payer = doc.paidBy as unknown as { name?: string } | null

    try {
        if (!company || !('name' in company)) throw new Error('The paying company no longer exists')
        if (!employee?.email) throw new Error('Employee has no email address')

        const approvedBy = company.signatory?.name || doc.paidByName || payer?.name || company.name

        const slip: SalarySlipData = {
            company: {
                name: company.name,
                legalName: company.legalName,
                logoUrl: resolveLogoUrl(company.logo),
                brandColor: company.brandColor,
                address: company.address,
                phone: company.phone,
                website: company.website,
                footerNote: company.email?.footerNote,
            },
            employeeName: employee.name || 'Employee',
            role: employee.position || '',
            month: doc.month,
            currency: doc.currency,
            salary: doc.salary,
            allowances: doc.allowances,
            deductions: doc.deductions,
            totalAllowances: doc.totalAllowances,
            totalDeductions: doc.totalDeductions,
            grossAmount: doc.grossAmount,
            netPay: doc.netPay,
            payment: doc.paymentDetails
                ? { ...doc.paymentDetails, holderName: doc.paymentDetails.holderName || employee.name }
                : undefined,
            paidOn: doc.paidOn,
            approvedBy,
            approvedByTitle: company.signatory?.name ? company.signatory?.title : undefined,
            signature: company.signatory?.signature,
        }

        // The slip is sent as a PDF attachment; the email body is only a short message.
        const pdf = await generateSalarySlipPdf(slip)
        const message = generateSlipMessage({
            companyName: company.name,
            employeeName: employee.name || 'Employee',
            month: doc.month,
            brandColor: company.brandColor,
            footerNote: company.email?.footerNote,
        })

        await sendSalarySlip({
            to: employee.email,
            subject: `${company.name} – Salary Slip for ${formatMonthLabel(doc.month)}`,
            html: message.html,
            text: message.text,
            attachments: [{
                filename: slipFileName(employee.name || 'Employee', doc.month),
                content: pdf,
                contentType: 'application/pdf',
            }],
            company,
        })

        await recordEmail(doc._id, { status: 'sent' })
        return { status: 'sent' }
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown email error'
        console.error(`Failed to send salary slip for ${String(doc._id)}:`, message)
        await recordEmail(doc._id, { status: 'failed', error: message.slice(0, 500) })
        return { status: 'failed', error: message }
    }
}

/* ------------------------------------------------------------------ */
/* Update / pay                                                        */
/* ------------------------------------------------------------------ */

export interface SalaryChanges {
    salary?: number
    allowances?: ILineItem[]
    deductions?: ILineItem[]
    currency?: string
    notes?: string
    companyId?: string
    status?: 'pending' | 'paid'
    payment?: IPaymentDetails
}

export interface UpdateOutcome {
    salaryId: string
    emailOutcome?: EmailOutcome
}

/**
 * Applies edits and (optionally) marks the salary as paid in ONE atomic update, then sends the slip.
 *
 * Rules:
 *  - A paid salary is locked: only `notes` can still be edited (it was already emailed).
 *  - The write is conditional on the status we read, so two admins (or a double click) cannot both
 *    "mark as paid" and trigger two emails.
 */
export const updateSalaryRecord = async (id: string, changes: SalaryChanges, actor: { id: string }): Promise<UpdateOutcome> => {
    const existing = await Salary.findById(id)
    if (!existing) throw notFound('Salary record not found')

    const wantsPaid = changes.status === 'paid'

    if (existing.status === 'paid') {
        const touchesLockedField = (Object.keys(changes) as (keyof SalaryChanges)[])
            .some(key => key !== 'notes' && changes[key] !== undefined)
        if (touchesLockedField) {
            throw conflict('This salary is already paid and locked. Only the notes can be edited.')
        }
    }

    const $set: Record<string, unknown> = {}

    if (changes.notes !== undefined) $set.notes = changes.notes
    if (changes.currency !== undefined) $set.currency = changes.currency
    if (changes.companyId !== undefined) $set.companyId = await resolveActiveCompanyId(changes.companyId)

    if (existing.status === 'pending') {
        const basic = changes.salary ?? existing.salary
        const allowances = changes.allowances ?? existing.allowances.map(a => ({ name: a.name, amount: a.amount }))
        const deductions = changes.deductions ?? existing.deductions.map(d => ({ name: d.name, amount: d.amount }))

        Object.assign($set, { salary: basic, allowances, deductions, ...computeTotals({ salary: basic, allowances, deductions }) })
    }

    if (wantsPaid && existing.status === 'pending') {
        const [actorUser, employee] = await Promise.all([
            User.findById(actor.id).select('name').lean(),
            User.findById(existing.employeeId).select('+bankDetails').lean(),
        ])

        // Payment details: what the admin typed now, otherwise the employee's saved bank details.
        const saved = employee?.bankDetails
        const payment: IPaymentDetails | undefined = changes.payment ?? (saved ? { ...saved } : undefined)

        Object.assign($set, {
            status: 'paid',
            paidOn: new Date(),
            paidBy: actor.id,
            paidByName: actorUser?.name,
            ...(payment ? { paymentDetails: payment } : {}),
        })
    }

    const updated = await Salary.findOneAndUpdate(
        { _id: id, status: existing.status },
        { $set },
        { new: true, runValidators: true }
    )
    if (!updated) throw conflict('This salary was changed by someone else. Please refresh and try again.')

    const outcome: UpdateOutcome = { salaryId: String(updated._id) }
    if (wantsPaid && existing.status === 'pending') {
        outcome.emailOutcome = await sendSlipEmail(updated._id)
    }
    return outcome
}

/* ------------------------------------------------------------------ */
/* Bulk pay                                                            */
/* ------------------------------------------------------------------ */

export interface BulkPayResult {
    total: number
    paid: number
    failed: number
    emailsSent: number
    emailsFailed: number
    results: { salaryId: string; ok: boolean; emailStatus?: 'sent' | 'failed'; error?: string }[]
}

/** Marks every pending salary for a month (optionally one company / a chosen list) as paid, one by one. */
export const bulkPaySalaries = async (
    input: { month: string; companyId?: string; salaryIds?: string[] },
    actor: { id: string }
): Promise<BulkPayResult> => {
    const filter: Record<string, unknown> = { status: 'pending', month: input.month }
    if (input.companyId) filter.companyId = new Types.ObjectId(input.companyId)
    if (input.salaryIds?.length) filter._id = { $in: input.salaryIds.map(i => new Types.ObjectId(i)) }

    const ids = (await Salary.find(filter).select('_id').lean()).map(d => String(d._id))
    const summary: BulkPayResult = { total: ids.length, paid: 0, failed: 0, emailsSent: 0, emailsFailed: 0, results: [] }

    // Sequential on purpose: keeps us under SMTP rate limits and makes failures easy to trace.
    for (const id of ids) {
        try {
            const outcome = await updateSalaryRecord(id, { status: 'paid' }, actor)
            summary.paid++
            if (outcome.emailOutcome?.status === 'sent') summary.emailsSent++
            else summary.emailsFailed++
            summary.results.push({ salaryId: id, ok: true, emailStatus: outcome.emailOutcome?.status })
        } catch (error) {
            summary.failed++
            summary.results.push({ salaryId: id, ok: false, error: error instanceof Error ? error.message : 'Unknown error' })
        }
    }
    return summary
}
