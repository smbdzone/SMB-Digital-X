import { Types } from 'mongoose';
import Expense, { EXPENSE_CATEGORIES, EXPENSE_STATUSES, PAYMENT_METHODS } from '../model/expense.model.js';
import Project from '../model/project.model.js';
import { resolveActiveCompanyId } from '../services/company.service.js';
import { deleteFromCloudinary, uploadToCloudinary } from '../utils/cloudinary.js';
import { asAmount, asCurrency, asDate, asObjectId, asPercent, asText, badRequest, conflict, escapeRegex, forbidden, getAuth, isAdmin, notFound, paramId, parsePagination, queryString, } from '../utils/http.js';
import { fromCents, round2, sumMoney, toCents } from '../utils/money.js';
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const POPULATE_PROJECT = 'name clientName';
const POPULATE_USER = 'name email';
const POPULATE_COMPANY = 'name code';
const oneOf = (value, allowed, field) => {
    if (typeof value !== 'string' || !allowed.includes(value)) {
        throw badRequest(`${field} must be one of: ${allowed.join(', ')}`);
    }
    return value;
};
const asTaxes = (value) => {
    if (!Array.isArray(value))
        throw badRequest('taxes must be an array');
    if (value.length > 10)
        throw badRequest('taxes has too many items');
    return value.map((t, i) => ({
        name: asText(t?.name, `taxes[${i}].name`, { required: true, max: 50 }),
        percentage: asPercent(t?.percentage, `taxes[${i}].percentage`),
    }));
};
// One place for the tax maths (it used to be copy-pasted in create and update). Uses integer cents.
const computeTaxes = (amount, taxes) => {
    const amountCents = toCents(amount);
    const calculated = taxes.map(t => ({
        name: t.name,
        percentage: t.percentage,
        amount: fromCents(Math.round((amountCents * t.percentage) / 100)),
    }));
    const totalTax = sumMoney(calculated.map(t => t.amount));
    return { taxes: calculated, totalTax, totalAmount: sumMoney([amount, totalTax]) };
};
// Employees may only use projects they are assigned to; admins may use any.
const assertProjectAccess = async (projectId, auth) => {
    const project = await Project.findById(projectId).select('employees name');
    if (!project)
        throw notFound('Project not found');
    if (!isAdmin(auth) && !project.employees.some(e => String(e) === auth.id)) {
        throw forbidden('You are not assigned to this project');
    }
    return project;
};
const canViewExpense = (expense, auth) => {
    const ownerId = String(expense.addedBy?._id ?? expense.addedBy);
    return isAdmin(auth) || ownerId === auth.id;
};
const populateExpense = (query) => query
    .populate('projectId', POPULATE_PROJECT)
    .populate('addedBy', POPULATE_USER)
    .populate('companyId', POPULATE_COMPANY);
// Totals per currency. Rejected expenses are not counted unless you filter for them explicitly.
const totalsByCurrency = async (filter) => {
    const match = filter.status ? filter : { ...filter, status: { $ne: 'rejected' } };
    const rows = await Expense.aggregate([
        { $match: match },
        { $group: { _id: '$currency', total: { $sum: '$totalAmount' }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
    ]);
    return rows.map(r => ({ currency: r._id, total: round2(r.total), count: r.count }));
};
const listResponse = async (filter, query) => {
    const { page, limit, skip } = parsePagination(query);
    const [expenses, total, totals] = await Promise.all([
        populateExpense(Expense.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit)),
        Expense.countDocuments(filter),
        totalsByCurrency(filter),
    ]);
    return {
        data: {
            expenses,
            // `totalExpense` only makes sense for a single currency; use totalsByCurrency otherwise.
            totalExpense: totals.length === 1 ? totals[0].total : totals.length === 0 ? 0 : null,
            totalsByCurrency: totals,
        },
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    };
};
/* ------------------------------------------------------------------ */
/* Create                                                              */
/* ------------------------------------------------------------------ */
// POST /api/expenses
export const createExpenseController = async (req, res) => {
    const auth = getAuth(req);
    const b = req.body ?? {};
    const description = asText(b.description, 'description', { required: true });
    const category = oneOf(b.category, EXPENSE_CATEGORIES, 'category');
    const amount = asAmount(b.amount, 'amount');
    const { taxes, totalTax, totalAmount } = computeTaxes(amount, b.taxes !== undefined ? asTaxes(b.taxes) : []);
    let projectId;
    if (b.projectId !== undefined && b.projectId !== null && b.projectId !== '') {
        projectId = asObjectId(b.projectId, 'projectId');
        await assertProjectAccess(String(projectId), auth);
    }
    const companyId = await resolveActiveCompanyId(b.companyId, auth.id);
    const expense = await Expense.create({
        companyId,
        projectId,
        addedBy: auth.id,
        description,
        category,
        vendor: asText(b.vendor, 'vendor', { max: 200 }),
        paymentMethod: b.paymentMethod !== undefined ? oneOf(b.paymentMethod, PAYMENT_METHODS, 'paymentMethod') : undefined,
        amount,
        taxes,
        totalTax,
        totalAmount,
        currency: b.currency !== undefined ? asCurrency(b.currency) : 'AED',
        date: b.date !== undefined ? asDate(b.date) : new Date(),
        notes: asText(b.notes, 'notes', { max: 2000 }),
        // An admin's own expense is approved immediately; an employee's waits for approval.
        status: isAdmin(auth) ? 'approved' : 'pending',
        ...(isAdmin(auth) ? { approvedBy: auth.id, approvedAt: new Date() } : {}),
    });
    const populated = await populateExpense(Expense.findById(expense._id));
    res.status(201).json({ success: true, message: 'Expense added successfully', data: populated });
};
/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */
// GET /api/expenses?projectId=&companyId=&category=&status=&currency=&from=&to=&search=&page=&limit=
// Admins see everything; employees only see the expenses they added.
export const getAllExpenses = async (req, res) => {
    const auth = getAuth(req);
    const q = req.query;
    const filter = {};
    if (!isAdmin(auth))
        filter.addedBy = new Types.ObjectId(auth.id);
    const projectId = queryString(q.projectId);
    if (projectId)
        filter.projectId = asObjectId(projectId, 'projectId');
    const companyId = queryString(q.companyId);
    if (companyId)
        filter.companyId = asObjectId(companyId, 'companyId');
    const category = queryString(q.category);
    if (category)
        filter.category = oneOf(category, EXPENSE_CATEGORIES, 'category');
    const status = queryString(q.status);
    if (status)
        filter.status = oneOf(status, EXPENSE_STATUSES, 'status');
    const currency = queryString(q.currency);
    if (currency)
        filter.currency = asCurrency(currency);
    const from = queryString(q.from);
    const to = queryString(q.to);
    if (from || to) {
        const range = {};
        if (from)
            range.$gte = asDate(from, 'from');
        if (to)
            range.$lte = asDate(to, 'to');
        filter.date = range;
    }
    const search = queryString(q.search);
    if (search) {
        const rx = { $regex: escapeRegex(search), $options: 'i' };
        filter.$or = [{ description: rx }, { vendor: rx }];
    }
    const { data, pagination } = await listResponse(filter, q);
    res.status(200).json({ success: true, message: 'Expenses fetched successfully', data, pagination });
};
// GET /api/expenses/project/:projectId
export const getProjectExpensesController = async (req, res) => {
    const auth = getAuth(req);
    const projectId = paramId(req, 'projectId');
    await assertProjectAccess(projectId, auth);
    const filter = { projectId: new Types.ObjectId(projectId) };
    const { data, pagination } = await listResponse(filter, req.query);
    res.status(200).json({ success: true, data, pagination });
};
// GET /api/expenses/:id
export const getExpenseController = async (req, res) => {
    const auth = getAuth(req);
    const expense = await populateExpense(Expense.findById(paramId(req)));
    if (!expense)
        throw notFound('Expense not found');
    if (!canViewExpense(expense, auth))
        throw forbidden();
    res.status(200).json({ success: true, data: expense });
};
/* ------------------------------------------------------------------ */
/* Update                                                              */
/* ------------------------------------------------------------------ */
// PATCH /api/expenses/:id
// Admin: can edit anything. Owner: can edit only while the expense is still 'pending'.
export const updateExpenseController = async (req, res) => {
    const auth = getAuth(req);
    const id = paramId(req);
    const b = req.body ?? {};
    const existing = await Expense.findById(id);
    if (!existing)
        throw notFound('Expense not found');
    if (!isAdmin(auth)) {
        if (String(existing.addedBy) !== auth.id)
            throw forbidden();
        if (existing.status !== 'pending')
            throw forbidden('Only pending expenses can be edited. Ask an admin to change it.');
        if (b.companyId !== undefined)
            throw forbidden('Only an admin can change the company of an expense');
    }
    const amount = b.amount !== undefined ? asAmount(b.amount, 'amount') : existing.amount;
    const taxInput = b.taxes !== undefined
        ? asTaxes(b.taxes)
        : existing.taxes.map(t => ({ name: t.name, percentage: t.percentage }));
    const { taxes, totalTax, totalAmount } = computeTaxes(amount, taxInput);
    const $set = { amount, taxes, totalTax, totalAmount, updatedBy: auth.id };
    if (b.description !== undefined)
        $set.description = asText(b.description, 'description', { required: true });
    if (b.category !== undefined)
        $set.category = oneOf(b.category, EXPENSE_CATEGORIES, 'category');
    if (b.vendor !== undefined)
        $set.vendor = asText(b.vendor, 'vendor', { max: 200 }) ?? '';
    if (b.paymentMethod !== undefined)
        $set.paymentMethod = oneOf(b.paymentMethod, PAYMENT_METHODS, 'paymentMethod');
    if (b.currency !== undefined)
        $set.currency = asCurrency(b.currency);
    if (b.date !== undefined)
        $set.date = asDate(b.date);
    if (b.notes !== undefined)
        $set.notes = asText(b.notes, 'notes', { max: 2000 }) ?? '';
    if (b.companyId !== undefined)
        $set.companyId = await resolveActiveCompanyId(b.companyId);
    const updated = await populateExpense(Expense.findByIdAndUpdate(id, { $set }, { new: true, runValidators: true }));
    res.status(200).json({ success: true, message: 'Expense updated successfully', data: updated });
};
// PATCH /api/expenses/:id/status  (admin)  { status: 'approved'|'rejected'|'reimbursed'|'pending', reason? }
export const updateExpenseStatusController = async (req, res) => {
    const auth = getAuth(req);
    const status = oneOf(req.body?.status, EXPENSE_STATUSES, 'status');
    const reason = asText(req.body?.reason, 'reason', { max: 500 });
    if (status === 'rejected' && !reason)
        throw badRequest('Please give a reason when rejecting an expense');
    const $set = { status, updatedBy: auth.id };
    if (status === 'pending') {
        Object.assign($set, { approvedBy: null, approvedAt: null, rejectionReason: '' });
    }
    else {
        Object.assign($set, { approvedBy: auth.id, approvedAt: new Date(), rejectionReason: status === 'rejected' ? reason : '' });
    }
    const updated = await populateExpense(Expense.findByIdAndUpdate(paramId(req), { $set }, { new: true, runValidators: true }));
    if (!updated)
        throw notFound('Expense not found');
    res.status(200).json({ success: true, message: `Expense marked as ${status}`, data: updated });
};
/* ------------------------------------------------------------------ */
/* Delete (soft)                                                       */
/* ------------------------------------------------------------------ */
// DELETE /api/expenses/:id  (admin) - kept in the database for audit, hidden from every query
export const deleteExpenseController = async (req, res) => {
    const auth = getAuth(req);
    const expense = await Expense.findByIdAndUpdate(paramId(req), {
        $set: { isDeleted: true, deletedAt: new Date(), deletedBy: auth.id },
    });
    if (!expense)
        throw notFound('Expense not found');
    res.status(200).json({ success: true, message: 'Expense deleted successfully' });
};
/* ------------------------------------------------------------------ */
/* Receipts                                                            */
/* ------------------------------------------------------------------ */
const MAX_RECEIPTS = 5;
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
// POST /api/expenses/:id/receipts  (multipart, field name "receipt")
export const uploadReceiptController = async (req, res) => {
    const auth = getAuth(req);
    const expense = await Expense.findById(paramId(req));
    if (!expense)
        throw notFound('Expense not found');
    if (!canViewExpense(expense, auth))
        throw forbidden();
    if (!isAdmin(auth) && expense.status !== 'pending')
        throw forbidden('Receipts can only be added while the expense is pending');
    const file = req.file;
    if (!file)
        throw badRequest('Attach a file in the "receipt" field');
    if (!RECEIPT_TYPES.includes(file.mimetype))
        throw badRequest('Receipt must be a JPG, PNG, WEBP or PDF file');
    if (expense.receipts.length >= MAX_RECEIPTS)
        throw conflict(`An expense can have at most ${MAX_RECEIPTS} receipts`);
    const uploaded = await uploadToCloudinary(file.buffer, {
        folder: 'expense_receipts',
        resource_type: 'auto',
        filename: file.originalname,
    });
    expense.receipts.push({
        url: uploaded.url,
        public_id: uploaded.public_id,
        resource_type: uploaded.resource_type,
        originalName: file.originalname,
    });
    expense.updatedBy = new Types.ObjectId(auth.id);
    await expense.save();
    res.status(201).json({ success: true, message: 'Receipt uploaded', data: expense.receipts });
};
// DELETE /api/expenses/:id/receipts/:receiptId
export const deleteReceiptController = async (req, res) => {
    const auth = getAuth(req);
    const expense = await Expense.findById(paramId(req));
    if (!expense)
        throw notFound('Expense not found');
    if (!canViewExpense(expense, auth))
        throw forbidden();
    if (!isAdmin(auth) && expense.status !== 'pending')
        throw forbidden('Receipts can only be removed while the expense is pending');
    const receipt = expense.receipts.find(r => String(r._id) === paramId(req, 'receiptId'));
    if (!receipt)
        throw notFound('Receipt not found');
    try {
        await deleteFromCloudinary(receipt.public_id, receipt.resource_type === 'raw' ? 'raw' : 'image');
    }
    catch (error) {
        console.error('Could not delete receipt from Cloudinary (removing the record anyway):', error);
    }
    expense.receipts = expense.receipts.filter(r => String(r._id) !== String(receipt._id));
    await expense.save();
    res.status(200).json({ success: true, message: 'Receipt removed', data: expense.receipts });
};
