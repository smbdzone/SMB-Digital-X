import { Types } from "mongoose";
import Deliverable from "../model/deliverable.model.js";
import EODReport from "../model/eod.model.js";
import User from "../model/user.model.js";
import { badRequest } from "../utils/http.js";
import { asDayKey, dayKey, keyToDate } from "../utils/dates.js";

/**
 * Performance numbers per employee over a date range.
 *
 * - planned        every deliverable of a finished day (today counts only once reported in the EOD)
 * - approved       of those, approved ones
 * - completed / inProgress ("Half completed") / notStarted   by outcome; unreported counts as not started
 * - completionRate completed / planned (strict)
 * - weightedRate   (completed + 0.5 x half completed) / planned, the same formula as the EOD progress
 * - carriedOver    planned items that were carried over to a later day
 * - estimatedHours / actualHours   sums of what was filled in
 * - daysWithPlan   days with at least one deliverable; daysWithEod  days with an EOD report
 *
 * A half-completed item carried to the next day counts on both days (half on the first, its final
 * outcome on the second), so carrying work forward is visible in the numbers rather than hidden.
 */

export interface StatsRange { from: string; to: string }

export const asStatsRange = (rawFrom: string | undefined, rawTo: string | undefined): StatsRange => {
    const today = dayKey();
    const to = rawTo ? asDayKey(rawTo, "to") : today;
    const from = rawFrom ? asDayKey(rawFrom, "from") : `${to.slice(0, 8)}01`; // default: month to date
    if (from > to) throw badRequest("from must not be after to");
    const days = (keyToDate(to).getTime() - keyToDate(from).getTime()) / 86_400_000;
    if (days > 366) throw badRequest("The date range can be at most one year");
    return { from, to };
};

export interface EmployeeStats {
    planned: number;
    approved: number;
    completed: number;
    inProgress: number;
    notStarted: number;
    completionRate: number | null;
    weightedRate: number | null;
    carriedOver: number;
    estimatedHours: number;
    actualHours: number;
    daysWithPlan: number;
    daysWithEod: number;
}

const percent = (part: number, whole: number): number | null =>
    whole ? Math.round((part / whole) * 1000) / 10 : null;

const empty = (): EmployeeStats => ({
    planned: 0, approved: 0, completed: 0, inProgress: 0, notStarted: 0, completionRate: null, weightedRate: null,
    carriedOver: 0, estimatedHours: 0, actualHours: 0, daysWithPlan: 0, daysWithEod: 0,
});

export const statsFor = async (employeeIds: Types.ObjectId[], range: StatsRange): Promise<Map<string, EmployeeStats>> => {
    const result = new Map<string, EmployeeStats>(employeeIds.map(id => [String(id), empty()]));
    if (employeeIds.length === 0) return result;

    const today = dayKey();
    const inRange = { employeeId: { $in: employeeIds }, dateKey: { $gte: range.from, $lte: range.to } };

    const [items, planDays, eodDays] = await Promise.all([
        Deliverable.aggregate([
            { $match: { ...inRange, $or: [{ dateKey: { $lt: today } }, { reportedAt: { $ne: null } }] } },
            // (plain localField/foreignField form: works on MongoDB versions before 5.0 too)
            { $lookup: { from: Deliverable.collection.name, localField: "_id", foreignField: "carriedFromId", as: "copies" } },
            {
                $group: {
                    _id: "$employeeId",
                    planned: { $sum: 1 },
                    approved: { $sum: { $cond: [{ $eq: ["$approvalStatus", "approved"] }, 1, 0] } },
                    completed: { $sum: { $cond: [{ $eq: ["$outcome", "completed"] }, 1, 0] } },
                    inProgress: { $sum: { $cond: [{ $eq: ["$outcome", "in_progress"] }, 1, 0] } },
                    carriedOver: { $sum: { $cond: [{ $gt: [{ $size: "$copies" }, 0] }, 1, 0] } },
                    estimatedHours: { $sum: { $ifNull: ["$estimatedHours", 0] } },
                    actualHours: { $sum: { $ifNull: ["$actualHours", 0] } },
                },
            },
        ]),
        Deliverable.aggregate([
            { $match: inRange },
            { $group: { _id: { e: "$employeeId", d: "$dateKey" } } },
            { $group: { _id: "$_id.e", days: { $sum: 1 } } },
        ]),
        EODReport.aggregate([
            { $match: inRange },
            { $group: { _id: "$employeeId", days: { $sum: 1 } } },
        ]),
    ]);

    for (const row of items) {
        const s = result.get(String(row._id));
        if (!s) continue;
        Object.assign(s, {
            planned: row.planned,
            approved: row.approved,
            completed: row.completed,
            inProgress: row.inProgress,
            notStarted: row.planned - row.completed - row.inProgress,
            carriedOver: row.carriedOver,
            estimatedHours: Math.round(row.estimatedHours * 100) / 100,
            actualHours: Math.round(row.actualHours * 100) / 100,
            completionRate: percent(row.completed, row.planned),
            weightedRate: percent(row.completed + 0.5 * row.inProgress, row.planned),
        });
    }
    for (const row of planDays) {
        const s = result.get(String(row._id));
        if (s) s.daysWithPlan = row.days;
    }
    for (const row of eodDays) {
        const s = result.get(String(row._id));
        if (s) s.daysWithEod = row.days;
    }
    return result;
};

const EMPLOYEE_FIELDS = "name email position companyId";

/** Every active non-admin user (optionally one employee / one company), with their stats. */
export const teamStats = async (range: StatsRange, filter: { employeeId?: string; companyId?: string }) => {
    const userFilter: Record<string, unknown> = { role: { $ne: "admin" }, status: "active" };
    if (filter.employeeId) userFilter._id = new Types.ObjectId(filter.employeeId);
    if (filter.companyId) userFilter.companyId = new Types.ObjectId(filter.companyId);
    const employees = await User.find(userFilter).select(EMPLOYEE_FIELDS).sort({ name: 1 }).lean();
    const stats = await statsFor(employees.map(e => e._id), range);
    return employees.map(employee => ({ employee, stats: stats.get(String(employee._id)) ?? empty() }));
};

/** Admin dashboard card: where today's plans and EODs stand. */
export const daySummary = async (date: string) => {
    const employees = await User.find({ role: { $ne: "admin" }, status: "active" }).distinct("_id");
    const [submitted, pending, eods] = await Promise.all([
        Deliverable.distinct("employeeId", { employeeId: { $in: employees }, dateKey: date, approvalStatus: { $ne: "draft" } }),
        Deliverable.distinct("employeeId", { employeeId: { $in: employees }, dateKey: date, approvalStatus: "pending" }),
        EODReport.countDocuments({ employeeId: { $in: employees }, dateKey: date }),
    ]);
    return {
        date,
        activeEmployees: employees.length,
        plansSubmitted: submitted.length,
        plansPendingApproval: pending.length,
        eodsSubmitted: eods,
    };
};
