import { Types } from "mongoose";
import Salary from "../model/salary.model.js";
import { asAmount, asCurrency, asLineItems, asMonth, asObjectId, asText, forbidden, getAuth, isAdmin, isObjectId, notFound, paramId, parsePagination, queryString, badRequest, } from "../utils/http.js";
import { round2 } from "../utils/money.js";
import { resolveLogoUrl } from "../services/company.service.js";
import { bulkPaySalaries, currentMonth, generateMonthlySalaries, sendSlipEmail, updateSalaryRecord, } from "../services/salary.service.js";
/* ------------------------------------------------------------------ */
/* Response shaping                                                    */
/* ------------------------------------------------------------------ */
const EMPLOYEE_FIELDS = 'name email position';
const COMPANY_FIELDS = 'name code logo brandColor';
const populateSalary = (query) => query
    .populate('employeeId', EMPLOYEE_FIELDS)
    .populate('companyId', COMPANY_FIELDS)
    .populate('paidBy', 'name');
const mask = (value) => value ? (value.replace(/\s/g, '').length <= 4 ? value : `•••• ${value.replace(/\s/g, '').slice(-4)}`) : value;
/**
 * Adds `company` ({ id, name, code, logo(url) }) next to the populated `companyId`, so a UI that
 * used to read `salary.company.name` / `.logo` keeps working.
 */
const toDTO = (doc, opts = {}) => {
    const o = doc.toObject ? doc.toObject() : { ...doc };
    const c = o.companyId;
    if (c && typeof c === 'object' && 'name' in c) {
        o.company = { id: c._id, name: c.name, code: c.code, logo: resolveLogoUrl(c.logo), brandColor: c.brandColor };
    }
    if (opts.maskPayment && o.paymentDetails) {
        o.paymentDetails = {
            ...o.paymentDetails,
            accountNumber: mask(o.paymentDetails.accountNumber),
            iban: mask(o.paymentDetails.iban),
        };
    }
    return o;
};
/* ------------------------------------------------------------------ */
/* Admin: list                                                         */
/* ------------------------------------------------------------------ */
// GET /api/salary?month=YYYY-MM&status=&companyId=&employeeId=&page=&limit=
// (the old `date` query param is still accepted as an alias of `month`)
export const getAllSalaries = async (req, res) => {
    const q = req.query;
    const filter = {};
    const month = queryString(q.month) ?? queryString(q.date);
    if (month)
        filter.month = asMonth(month);
    const status = queryString(q.status);
    if (status) {
        if (status !== 'pending' && status !== 'paid')
            throw badRequest("status must be 'pending' or 'paid'");
        filter.status = status;
    }
    const companyId = queryString(q.companyId);
    if (companyId)
        filter.companyId = asObjectId(companyId, 'companyId');
    const employeeId = queryString(q.employeeId);
    if (employeeId)
        filter.employeeId = asObjectId(employeeId, 'employeeId');
    const { page, limit, skip } = parsePagination(q);
    const [salaries, total, grouped] = await Promise.all([
        populateSalary(Salary.find(filter).sort({ month: -1, createdAt: -1 }).skip(skip).limit(limit)),
        Salary.countDocuments(filter),
        Salary.aggregate([
            { $match: filter },
            { $group: { _id: { currency: '$currency', status: '$status' }, count: { $sum: 1 }, netPay: { $sum: '$netPay' } } },
        ]),
    ]);
    res.status(200).json({
        success: true,
        message: 'Salaries fetched successfully',
        data: salaries.map(s => toDTO(s)),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        // Totals are per currency on purpose: never add AED and USD together.
        summary: grouped.map(g => ({
            currency: g._id.currency,
            status: g._id.status,
            count: g.count,
            netPay: round2(g.netPay),
        })),
    });
};
/* ------------------------------------------------------------------ */
/* Employee: own slips                                                 */
/* ------------------------------------------------------------------ */
// GET /api/salary/my  - an employee sees only their own PAID salaries
export const getMySalaries = async (req, res) => {
    const auth = getAuth(req);
    const filter = { employeeId: new Types.ObjectId(auth.id), status: 'paid' };
    const month = queryString(req.query.month);
    if (month)
        filter.month = asMonth(month);
    const salaries = await populateSalary(Salary.find(filter).sort({ month: -1 }));
    res.status(200).json({
        success: true,
        message: 'Your salary slips',
        data: salaries.map(s => toDTO(s, { maskPayment: true })),
    });
};
// GET /api/salary/:id - admin, or the employee it belongs to (once paid)
export const getSalary = async (req, res) => {
    const auth = getAuth(req);
    const salary = await populateSalary(Salary.findById(paramId(req)));
    if (!salary)
        throw notFound('Salary record not found');
    if (!isAdmin(auth)) {
        const ownerId = String(salary.employeeId?._id ?? salary.employeeId);
        if (ownerId !== auth.id || salary.status !== 'paid')
            throw forbidden();
    }
    res.status(200).json({ success: true, data: toDTO(salary, { maskPayment: !isAdmin(auth) }) });
};
/* ------------------------------------------------------------------ */
/* Admin: generate / update / pay / resend                             */
/* ------------------------------------------------------------------ */
// POST /api/salary/generate  { month?: "YYYY-MM", companyId? }
export const generateSalaries = async (req, res) => {
    const body = req.body ?? {};
    const month = body.month !== undefined ? asMonth(body.month) : currentMonth();
    const companyId = body.companyId !== undefined ? String(asObjectId(body.companyId, 'companyId')) : undefined;
    const result = await generateMonthlySalaries(month, companyId);
    res.status(200).json({
        success: true,
        message: `Created ${result.created} salary record(s) for ${month}`,
        data: result,
    });
};
// PATCH /api/salary/:id
// Body (all optional): salary, allowances[], deductions[], currency, notes, companyId,
//   status: 'paid' (marks paid + emails the slip), and payment details either flat
//   (paymentMethod, bankName, holderName, accountNumber, iban, paymentReference) or as `payment: {...}`.
// `employeeId`, `month` and `payedBy` are ignored on purpose: the payer is always the logged-in admin.
export const updateSalary = async (req, res) => {
    const auth = getAuth(req);
    const id = paramId(req);
    const b = req.body ?? {};
    const changes = {};
    if (b.salary !== undefined)
        changes.salary = asAmount(b.salary, 'salary');
    if (b.allowances !== undefined)
        changes.allowances = asLineItems(b.allowances, 'allowances');
    if (b.deductions !== undefined)
        changes.deductions = asLineItems(b.deductions, 'deductions');
    if (b.currency !== undefined)
        changes.currency = asCurrency(b.currency);
    if (b.notes !== undefined)
        changes.notes = asText(b.notes, 'notes', { max: 1000 }) ?? '';
    if (b.companyId !== undefined) {
        if (!isObjectId(b.companyId))
            throw badRequest('companyId must be a company id from GET /api/companies');
        changes.companyId = b.companyId;
    }
    if (b.status !== undefined) {
        if (b.status !== 'pending' && b.status !== 'paid')
            throw badRequest("status must be 'pending' or 'paid'");
        changes.status = b.status;
    }
    const p = typeof b.payment === 'object' && b.payment !== null ? b.payment : {};
    const payment = {
        method: asText(b.paymentMethod ?? p.method, 'paymentMethod', { max: 50 }),
        bankName: asText(b.bankName ?? p.bankName, 'bankName', { max: 100 }),
        holderName: asText(b.holderName ?? p.holderName, 'holderName', { max: 100 }),
        accountNumber: asText(b.accountNumber ?? p.accountNumber, 'accountNumber', { max: 50 }),
        iban: asText(b.iban ?? p.iban, 'iban', { max: 50 }),
        reference: asText(b.paymentReference ?? p.reference, 'paymentReference', { max: 100 }),
    };
    if (Object.values(payment).some(v => v !== undefined))
        changes.payment = payment;
    const outcome = await updateSalaryRecord(id, changes, { id: auth.id });
    const salary = await populateSalary(Salary.findById(id));
    res.status(200).json({
        success: true,
        message: outcome.emailOutcome
            ? outcome.emailOutcome.status === 'sent'
                ? 'Salary marked as paid and slip emailed'
                : 'Salary marked as paid, but the slip email failed. You can resend it.'
            : 'Salary updated successfully',
        data: salary ? toDTO(salary) : null,
        email: outcome.emailOutcome ?? null,
    });
};
// POST /api/salary/:id/resend-email
export const resendSalarySlip = async (req, res) => {
    const outcome = await sendSlipEmail(paramId(req));
    if (outcome.status === 'failed') {
        res.status(502).json({ success: false, message: `Email failed: ${outcome.error}`, email: outcome });
        return;
    }
    res.status(200).json({ success: true, message: 'Salary slip emailed', email: outcome });
};
// POST /api/salary/bulk-pay  { month, companyId?, salaryIds?: [] }
export const bulkPaySalariesController = async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const month = asMonth(b.month);
    const companyId = b.companyId !== undefined ? String(asObjectId(b.companyId, 'companyId')) : undefined;
    let salaryIds;
    if (b.salaryIds !== undefined) {
        if (!Array.isArray(b.salaryIds) || b.salaryIds.length > 500 || !b.salaryIds.every(isObjectId)) {
            throw badRequest('salaryIds must be an array of valid ids (max 500)');
        }
        salaryIds = b.salaryIds;
    }
    const result = await bulkPaySalaries({ month, companyId, salaryIds }, { id: auth.id });
    res.status(200).json({
        success: true,
        message: `Paid ${result.paid} of ${result.total} salaries (${result.emailsSent} emails sent, ${result.emailsFailed} failed)`,
        data: result,
    });
};
