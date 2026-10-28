import { Request, Response } from "express";
import EODReport from "../model/eod.model.js";
import Task from "../model/task.model.js";
import User from "../model/user.model.js";
import {
    asObjectId, asPercent, asText, badRequest, conflict, forbidden, getAuth, isAdmin,
    isObjectId, notFound, paramId, parsePagination, queryString,
} from "../utils/http.js";
import { asDayKey, dayKey, keyToDate } from "../utils/dates.js";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const TASK_FIELDS = "title status progress";
const EMPLOYEE_FIELDS = "name email position";

const populateEOD = <T extends { populate: (...args: any[]) => T }>(query: T): T =>
    query
        .populate("employeeId", EMPLOYEE_FIELDS)
        .populate("completedTasks", TASK_FIELDS)
        .populate("inProgressTasks", TASK_FIELDS)
        .populate("reviewedBy", "name email");

// [id, id, ...] -> de-duplicated list of valid ids (invalid ids are a 400, not a 500).
const asIdList = (value: unknown, field: string): string[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw badRequest(`${field} must be an array of task ids`);
    if (value.length > 100) throw badRequest(`${field} has too many items`);
    if (!value.every(isObjectId)) throw badRequest(`${field} contains an invalid task id`);
    return [...new Set(value.map(String))];
};

// Every selected task must be assigned to the employee, and cannot be both completed and in progress.
const validateTasks = async (employeeId: string, completed: string[], inProgress: string[]): Promise<void> => {
    if (completed.some(id => inProgress.includes(id))) {
        throw badRequest("A task cannot be both completed and in progress");
    }

    const ids = [...completed, ...inProgress];
    if (ids.length === 0) return;

    const valid = await Task.countDocuments({ _id: { $in: ids }, assignedTo: employeeId });
    if (valid !== ids.length) throw badRequest("One or more selected tasks are invalid or not assigned to you");
};

// Filters shared by the "my reports" and the admin list: ?from=YYYY-MM-DD&to=YYYY-MM-DD
const applyDateRange = (filter: Record<string, unknown>, from?: string, to?: string) => {
    if (!from && !to) return;
    const range: Record<string, string> = {};
    if (from) range.$gte = asDayKey(from, "from");
    if (to) range.$lte = asDayKey(to, "to");
    if (range.$gte && range.$lte && range.$gte > range.$lte) throw badRequest("from must not be after to");
    filter.dateKey = range;
};

/* ------------------------------------------------------------------ */
/* Employee: submit / edit / list own                                  */
/* ------------------------------------------------------------------ */

// POST /api/eod
export const createEOD = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const b = req.body ?? {};

    const summary = asText(b.summary, "summary", { required: true, max: 5000 });
    const blockers = asText(b.blockers, "blockers", { max: 2000 }) ?? "";
    const tomorrowPlan = asText(b.tomorrowPlan, "tomorrowPlan", { max: 2000 }) ?? "";
    const overallProgress = b.overallProgress !== undefined ? asPercent(b.overallProgress, "overallProgress") : 0;
    const completedTasks = asIdList(b.completedTasks, "completedTasks");
    const inProgressTasks = asIdList(b.inProgressTasks, "inProgressTasks");

    await validateTasks(auth.id, completedTasks, inProgressTasks);

    const today = dayKey();

    let report;
    try {
        report = await EODReport.create({
            employeeId: auth.id,
            dateKey: today,
            date: keyToDate(today),
            summary,
            completedTasks,
            inProgressTasks,
            blockers,
            tomorrowPlan,
            overallProgress,
        });
    } catch (error) {
        // Two quick submits: the unique index is the real guard, not a find-then-create check.
        if ((error as { code?: number })?.code === 11000) throw conflict("You have already submitted today's EOD report");
        throw error;
    }

    const populated = await populateEOD(EODReport.findById(report._id));

    res.status(201).json({
        success: true,
        message: "EOD report submitted successfully",
        data: populated,
    });
};

// PATCH /api/eod/:id  - the owner can fix today's report until an admin has reviewed it
export const updateMyEOD = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const report = await EODReport.findById(paramId(req));
    if (!report) throw notFound("EOD report not found");

    if (String(report.employeeId) !== auth.id) throw forbidden();
    if (report.status === "Reviewed") throw conflict("This report has already been reviewed and can no longer be edited");
    if (report.dateKey !== dayKey()) throw conflict("Only today's report can be edited");

    const b = req.body ?? {};

    if (b.summary !== undefined) report.summary = asText(b.summary, "summary", { required: true, max: 5000 });
    if (b.blockers !== undefined) report.blockers = asText(b.blockers, "blockers", { max: 2000 }) ?? "";
    if (b.tomorrowPlan !== undefined) report.tomorrowPlan = asText(b.tomorrowPlan, "tomorrowPlan", { max: 2000 }) ?? "";
    if (b.overallProgress !== undefined) report.overallProgress = asPercent(b.overallProgress, "overallProgress");

    if (b.completedTasks !== undefined || b.inProgressTasks !== undefined) {
        const completed = b.completedTasks !== undefined
            ? asIdList(b.completedTasks, "completedTasks")
            : report.completedTasks.map(String);
        const inProgress = b.inProgressTasks !== undefined
            ? asIdList(b.inProgressTasks, "inProgressTasks")
            : report.inProgressTasks.map(String);

        await validateTasks(auth.id, completed, inProgress);
        report.set("completedTasks", completed);
        report.set("inProgressTasks", inProgress);
    }

    await report.save();
    const populated = await populateEOD(EODReport.findById(report._id));

    res.status(200).json({ success: true, message: "EOD report updated successfully", data: populated });
};

// GET /api/eod/my?from=&to=&status=&page=&limit=
export const getMyEOD = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const q = req.query;
    const filter: Record<string, unknown> = { employeeId: asObjectId(auth.id, "user id") };

    applyDateRange(filter, queryString(q.from), queryString(q.to));

    const status = queryString(q.status);
    if (status) {
        if (status !== "Submitted" && status !== "Reviewed") throw badRequest("status must be 'Submitted' or 'Reviewed'");
        filter.status = status;
    }

    const { page, limit, skip } = parsePagination(q, 30);

    const [reports, total] = await Promise.all([
        populateEOD(EODReport.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit)),
        EODReport.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        message: "EOD reports found",
        data: reports,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
};

// GET /api/eod/:id - admin, or the employee it belongs to
export const getSingleEOD = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const report = await populateEOD(EODReport.findById(paramId(req)));
    if (!report) throw notFound("EOD report not found");

    if (!isAdmin(auth)) {
        const ownerId = String((report.employeeId as any)?._id ?? report.employeeId);
        if (ownerId !== auth.id) throw forbidden();
    }

    res.status(200).json({ success: true, message: "EOD report found", data: report });
};

/* ------------------------------------------------------------------ */
/* Admin: list / missing / review                                      */
/* ------------------------------------------------------------------ */

// GET /api/eod?date=YYYY-MM-DD  (default: today)
//   or ?from=&to=   plus  &employeeId=&companyId=&status=&page=&limit=
export const getAllEOD = async (req: Request, res: Response): Promise<void> => {
    const q = req.query;
    const filter: Record<string, unknown> = {};

    const date = queryString(q.date);
    const from = queryString(q.from);
    const to = queryString(q.to);

    if (date) filter.dateKey = asDayKey(date);
    else if (from || to) applyDateRange(filter, from, to);
    else filter.dateKey = dayKey();

    const status = queryString(q.status);
    if (status) {
        if (status !== "Submitted" && status !== "Reviewed") throw badRequest("status must be 'Submitted' or 'Reviewed'");
        filter.status = status;
    }

    const employeeId = queryString(q.employeeId);
    if (employeeId) filter.employeeId = asObjectId(employeeId, "employeeId");

    const companyId = queryString(q.companyId);
    if (companyId) {
        const ids = await User.find({ companyId: asObjectId(companyId, "companyId") }).distinct("_id");
        // An explicit employeeId must also belong to that company.
        filter.employeeId = employeeId
            ? { $in: ids.filter(id => String(id) === employeeId) }
            : { $in: ids };
    }

    const { page, limit, skip } = parsePagination(q);

    const [reports, total] = await Promise.all([
        populateEOD(EODReport.find(filter).sort({ date: -1, createdAt: -1 }).skip(skip).limit(limit)),
        EODReport.countDocuments(filter),
    ]);

    res.status(200).json({
        success: true,
        message: "EOD reports found",
        data: reports,
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
};

// GET /api/eod/missing?date=YYYY-MM-DD&companyId=  - active employees who have not submitted
export const getMissingEOD = async (req: Request, res: Response): Promise<void> => {
    const q = req.query;
    const key = queryString(q.date) ? asDayKey(queryString(q.date)) : dayKey();

    const employeeFilter: Record<string, unknown> = { role: "employee", status: "active" };
    const companyId = queryString(q.companyId);
    if (companyId) employeeFilter.companyId = asObjectId(companyId, "companyId");

    const [employees, submittedIds] = await Promise.all([
        User.find(employeeFilter).select(`${EMPLOYEE_FIELDS} companyId`).sort({ name: 1 }).lean(),
        EODReport.find({ dateKey: key }).distinct("employeeId"),
    ]);

    const submitted = new Set(submittedIds.map(String));
    const missing = employees.filter(e => !submitted.has(String(e._id)));

    res.status(200).json({
        success: true,
        message: "Employees without an EOD report",
        data: {
            date: key,
            totalEmployees: employees.length,
            submitted: employees.length - missing.length,
            missingCount: missing.length,
            missing,
        },
    });
};

// PATCH /api/eod/:id/review   { reviewNote? }
export const reviewEOD = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);
    const reviewNote = asText(req.body?.reviewNote, "reviewNote", { max: 1000 }) ?? "";

    const existing = await EODReport.findById(id).select("employeeId status").lean();
    if (!existing) throw notFound("EOD report not found");
    if (String(existing.employeeId) === auth.id) throw forbidden("You cannot review your own report");

    // Atomic: only the first reviewer wins, a second click cannot overwrite them.
    const report = await populateEOD(
        EODReport.findOneAndUpdate(
            { _id: id, status: "Submitted" },
            { status: "Reviewed", reviewedBy: auth.id, reviewedAt: new Date(), reviewNote },
            { new: true }
        )
    );
    if (!report) throw conflict("This report has already been reviewed");

    res.status(200).json({
        success: true,
        message: "EOD report marked as reviewed",
        data: report,
    });
};
