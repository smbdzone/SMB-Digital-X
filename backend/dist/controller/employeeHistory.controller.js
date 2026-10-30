import { Types } from 'mongoose';
import EmployeeHistory, { HISTORY_TYPES, HISTORY_TYPE_LABELS } from '../model/employeeHistory.model.js';
import User from '../model/user.model.js';
import { asAmount, asCurrency, asDate, asText, badRequest, forbidden, getAuth, isAdmin, notFound, paramId, queryString, } from '../utils/http.js';
const isTrue = (v) => v === true || v === 'true';
const asHistoryType = (value) => {
    if (typeof value !== 'string' || !HISTORY_TYPES.includes(value)) {
        throw badRequest(`type must be one of: ${HISTORY_TYPES.join(', ')}`);
    }
    return value;
};
// Builds a validated field set. On update only the fields that were sent are included.
const buildFields = (b, mode) => {
    const f = {};
    if (mode === 'create' || b.type !== undefined)
        f.type = asHistoryType(b.type);
    if (b.title !== undefined) {
        const title = asText(b.title, 'title', { max: 150 });
        if (title !== undefined)
            f.title = title;
        else if (mode === 'update')
            throw badRequest('title cannot be empty');
    }
    // default title on create
    if (mode === 'create' && f.title === undefined)
        f.title = HISTORY_TYPE_LABELS[f.type];
    if (b.description !== undefined)
        f.description = asText(b.description, 'description', { max: 2000 }) ?? '';
    if (mode === 'create' || b.effectiveDate !== undefined) {
        f.effectiveDate = b.effectiveDate === undefined ? new Date() : asDate(b.effectiveDate, 'effectiveDate');
    }
    if (b.fromPosition !== undefined)
        f.fromPosition = asText(b.fromPosition, 'fromPosition', { max: 100 }) ?? '';
    if (b.toPosition !== undefined)
        f.toPosition = asText(b.toPosition, 'toPosition', { max: 100 }) ?? '';
    if (b.fromSalary !== undefined && b.fromSalary !== null && b.fromSalary !== '')
        f.fromSalary = asAmount(b.fromSalary, 'fromSalary');
    if (b.toSalary !== undefined && b.toSalary !== null && b.toSalary !== '')
        f.toSalary = asAmount(b.toSalary, 'toSalary');
    if (b.currency !== undefined && b.currency !== null && b.currency !== '')
        f.currency = asCurrency(b.currency);
    return f;
};
// Shared by "my history" and "employee history": employee info + summary + ordered entries.
const buildTimeline = async (employeeId, order) => {
    const employee = await User.findById(employeeId)
        .select('name email position status createdAt salary companyId')
        .lean();
    if (!employee)
        throw notFound('Employee not found');
    const entries = await EmployeeHistory.find({ employeeId })
        .populate('addedBy', 'name')
        .sort({ effectiveDate: order === 'asc' ? 1 : -1, createdAt: order === 'asc' ? 1 : -1 })
        .lean();
    const dates = entries.map(e => new Date(e.effectiveDate).getTime());
    const joinedEntries = entries.filter(e => e.type === 'joined');
    const joinedAt = joinedEntries.length
        ? new Date(Math.min(...joinedEntries.map(e => new Date(e.effectiveDate).getTime())))
        : employee.createdAt;
    return {
        employee: {
            id: employee._id,
            name: employee.name,
            email: employee.email,
            position: employee.position ?? '',
            status: employee.status,
            salary: employee.salary,
            companyId: employee.companyId,
            joinedAt,
        },
        summary: {
            totalEvents: entries.length,
            promotions: entries.filter(e => e.type === 'promotion').length,
            salaryChanges: entries.filter(e => e.type === 'salary_increase' || e.type === 'salary_decrease').length,
            firstEventDate: dates.length ? new Date(Math.min(...dates)) : null,
            lastEventDate: dates.length ? new Date(Math.max(...dates)) : null,
        },
        data: entries,
    };
};
const readOrder = (req) => (queryString(req.query.order) === 'asc' ? 'asc' : 'desc');
// GET /api/employee-history/me  (any logged-in user: their own history)
export const getMyHistory = async (req, res) => {
    const auth = getAuth(req);
    const result = await buildTimeline(auth.id, readOrder(req));
    res.status(200).json({ success: true, ...result });
};
// GET /api/employee-history/employee/:employeeId  (admin: anyone, employee: only themselves)
export const getEmployeeHistory = async (req, res) => {
    const auth = getAuth(req);
    const employeeId = paramId(req, 'employeeId');
    if (!isAdmin(auth) && employeeId !== auth.id)
        throw forbidden('You can only view your own history');
    const result = await buildTimeline(employeeId, readOrder(req));
    res.status(200).json({ success: true, ...result });
};
// GET /api/employee-history/:id  (a single entry, same access rule)
export const getHistoryEntry = async (req, res) => {
    const auth = getAuth(req);
    const entry = await EmployeeHistory.findById(paramId(req)).populate('addedBy', 'name').lean();
    if (!entry)
        throw notFound('History entry not found');
    if (!isAdmin(auth) && String(entry.employeeId) !== auth.id)
        throw forbidden('You can only view your own history');
    res.status(200).json({ success: true, data: entry });
};
// POST /api/employee-history/employee/:employeeId  (admin)
// Send `applyToProfile: true` to also update the employee's current position / salary from
// toPosition / toSalary. Without it the entry is only a record and nothing else changes.
export const createHistoryEntry = async (req, res) => {
    const auth = getAuth(req);
    const employeeId = paramId(req, 'employeeId');
    const b = req.body ?? {};
    const employee = await User.findById(employeeId);
    if (!employee)
        throw notFound('Employee not found');
    const fields = buildFields(b, 'create');
    const apply = isTrue(b.applyToProfile);
    if (apply) {
        if (fields.toPosition === undefined && fields.toSalary === undefined) {
            throw badRequest('applyToProfile needs toPosition and/or toSalary');
        }
        // Fill the "from" side from the current profile so the entry shows what changed.
        if (fields.fromPosition === undefined && employee.position)
            fields.fromPosition = employee.position;
        if (fields.fromSalary === undefined && typeof employee.salary?.amount === 'number')
            fields.fromSalary = employee.salary.amount;
        if (fields.currency === undefined && employee.salary?.currency)
            fields.currency = employee.salary.currency;
    }
    const entry = await EmployeeHistory.create({ ...fields, employeeId, addedBy: new Types.ObjectId(auth.id) });
    if (apply) {
        if (typeof fields.toPosition === 'string' && fields.toPosition)
            employee.position = fields.toPosition;
        if (typeof fields.toSalary === 'number') {
            // Same behaviour as the profile update: keep the old salary in salaryHistory.
            if (typeof employee.salary?.amount === 'number') {
                employee.salaryHistory.push({
                    amount: employee.salary.amount,
                    currency: employee.salary.currency,
                    effectiveFrom: employee.salary.effectiveFrom,
                    changedBy: new Types.ObjectId(auth.id),
                    changedAt: new Date(),
                });
            }
            employee.set('salary.amount', fields.toSalary);
            employee.set('salary.currency', fields.currency ?? employee.salary?.currency ?? 'AED');
            employee.set('salary.effectiveFrom', fields.effectiveDate);
        }
        await employee.save();
    }
    res.status(201).json({
        success: true,
        message: apply ? 'History entry added and profile updated' : 'History entry added',
        data: entry,
    });
};
// PATCH /api/employee-history/:id  (admin). Edits the record only; it never changes the profile.
export const updateHistoryEntry = async (req, res) => {
    const auth = getAuth(req);
    const fields = buildFields(req.body ?? {}, 'update');
    if (Object.keys(fields).length === 0)
        throw badRequest('Nothing to update');
    const entry = await EmployeeHistory.findByIdAndUpdate(paramId(req), { $set: { ...fields, updatedBy: new Types.ObjectId(auth.id) } }, { new: true, runValidators: true }).populate('addedBy', 'name');
    if (!entry)
        throw notFound('History entry not found');
    res.status(200).json({ success: true, message: 'History entry updated', data: entry });
};
// DELETE /api/employee-history/:id  (admin). Removes the record only; the profile is not reverted.
export const deleteHistoryEntry = async (req, res) => {
    const entry = await EmployeeHistory.findByIdAndDelete(paramId(req));
    if (!entry)
        throw notFound('History entry not found');
    res.status(200).json({ success: true, message: 'History entry deleted' });
};
// GET /api/employee-history/types  (lets the frontend build its dropdown from the server list)
export const getHistoryTypes = async (_req, res) => {
    res.status(200).json({
        success: true,
        data: HISTORY_TYPES.map(value => ({ value, label: HISTORY_TYPE_LABELS[value] })),
    });
};
