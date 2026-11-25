import { Types } from "mongoose";
import EODReport from "../model/eod.model.js";
import Deliverable, {
    DELIVERABLE_PRIORITIES, DeliverablePriority, IDeliverable,
} from "../model/deliverable.model.js";
import Project from "../model/project.model.js";
import Task from "../model/task.model.js";
import User from "../model/user.model.js";
import { AuthUser, asText, badRequest, conflict, forbidden, isObjectId, notFound } from "../utils/http.js";
import { asDayKey, dayKey, shiftDayKey } from "../utils/dates.js";

/* ------------------------------------------------------------------ */
/* Who is asking                                                       */
/* ------------------------------------------------------------------ */

export interface Viewer {
    id: string;
    name: string;
    admin: boolean;
    // admin, or an employee the admin flagged with canApproveDeliverables
    canApprove: boolean;
    companyId?: Types.ObjectId;
}

// Read from the database on every request (not from the JWT), so taking approver rights away works at once.
export const loadViewer = async (auth: AuthUser): Promise<Viewer> => {
    const user = await User.findById(auth.id).select("name role status canApproveDeliverables companyId").lean();
    if (!user) throw notFound("User not found");
    if (user.status === "inactive") throw forbidden("Inactive account");
    const admin = user.role === "admin";
    return {
        id: String(user._id),
        name: user.name,
        admin,
        canApprove: admin || user.canApproveDeliverables === true,
        companyId: user.companyId ?? undefined,
    };
};

export const requireApprover = (viewer: Viewer): void => {
    if (!viewer.canApprove) throw forbidden("Only approvers can do this");
};

/* ------------------------------------------------------------------ */
/* Days                                                                */
/* ------------------------------------------------------------------ */

// Employees plan today and tomorrow. Past days are a record and cannot be changed by them.
export const plannableDays = (): string[] => {
    const today = dayKey();
    return [today, shiftDayKey(today, 1)];
};

export const asPlanDay = (value: unknown, field = "date"): string => {
    const key = value === undefined || value === null || value === "" ? dayKey() : asDayKey(value, field);
    if (!plannableDays().includes(key)) throw badRequest(`${field} must be today or tomorrow`);
    return key;
};

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export const asPriority = (value: unknown): DeliverablePriority => {
    if (!DELIVERABLE_PRIORITIES.includes(value as DeliverablePriority)) {
        throw badRequest(`priority must be one of ${DELIVERABLE_PRIORITIES.join(", ")}`);
    }
    return value as DeliverablePriority;
};

// Hours: null/"" clears the value, otherwise 0..24 in quarter hours.
export const asHours = (value: unknown, field: string): number | null => {
    if (value === null || value === "") return null;
    const n = typeof value === "string" ? Number(value) : value;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 24) {
        throw badRequest(`${field} must be a number of hours between 0 and 24`);
    }
    return Math.round(n * 4) / 4;
};

export interface ItemFields {
    title?: string;
    description?: string;
    priority?: DeliverablePriority;
    estimatedHours?: number | null;
    projectId?: Types.ObjectId | null;
}

/**
 * The editable fields of a deliverable. Only the keys that were sent are returned.
 * A project link must be a project the employee works on, unless an approver sets it.
 */
export const parseItemFields = async (
    body: Record<string, unknown>,
    opts: { requireTitle: boolean; employeeId: string; byApprover: boolean }
): Promise<ItemFields> => {
    const out: ItemFields = {};
    if (opts.requireTitle || body.title !== undefined) {
        out.title = asText(body.title, "title", { required: true, max: 200 });
    }
    if (body.description !== undefined) out.description = asText(body.description, "description", { max: 2000 }) ?? "";
    if (body.priority !== undefined) out.priority = asPriority(body.priority);
    if (body.estimatedHours !== undefined) out.estimatedHours = asHours(body.estimatedHours, "estimatedHours");
    if (body.projectId !== undefined) {
        if (body.projectId === null || body.projectId === "") {
            out.projectId = null;
        } else {
            if (!isObjectId(body.projectId)) throw badRequest("projectId is not a valid id");
            const filter: Record<string, unknown> = { _id: body.projectId };
            if (!opts.byApprover) filter.employees = opts.employeeId;
            if (!(await Project.exists(filter))) {
                throw badRequest(opts.byApprover ? "Project not found" : "You can only link projects you work on");
            }
            out.projectId = new Types.ObjectId(body.projectId);
        }
    }
    return out;
};

export const asIdArray = (value: unknown, field: string, max = 100): string[] => {
    if (!Array.isArray(value)) throw badRequest(`${field} must be an array of ids`);
    if (value.length > max) throw badRequest(`${field} has too many items`);
    if (!value.every(isObjectId)) throw badRequest(`${field} contains an invalid id`);
    const ids = value.map(String);
    if (new Set(ids).size !== ids.length) throw badRequest(`${field} contains the same id twice`);
    return ids;
};

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

export const populateItems = <T extends { populate: (...args: any[]) => T }>(query: T): T =>
    query
        .populate("projectId", "name")
        .populate("taskId", "title status progress")
        .populate("approvedBy", "name")
        .populate("editedBy", "name")
        .populate("createdBy", "name");

export const dayItems = (employeeId: string, date: string) =>
    populateItems(Deliverable.find({ employeeId, dateKey: date }).sort({ order: 1, createdAt: 1 })).lean();

export type PlanState = "empty" | "draft" | "pending" | "approved";

// Plan state of one employee-day, from its items' approval statuses.
export const planState = (items: { approvalStatus: string }[]): PlanState => {
    if (items.length === 0) return "empty";
    if (items.some(i => i.approvalStatus === "draft")) return "draft";
    if (items.some(i => i.approvalStatus === "pending")) return "pending";
    return "approved";
};

const nextOrder = async (employeeId: string, date: string): Promise<number> => {
    const last = await Deliverable.findOne({ employeeId, dateKey: date }).sort({ order: -1 }).select("order").lean();
    return (last?.order ?? -1) + 1;
};

// Once a plan was submitted, new items the employee adds go straight to the approval queue.
const newItemStatus = async (employeeId: string, date: string): Promise<"draft" | "pending"> => {
    const submitted = await Deliverable.exists({ employeeId, dateKey: date, approvalStatus: { $in: ["pending", "approved"] } });
    return submitted ? "pending" : "draft";
};

/* ------------------------------------------------------------------ */
/* Employee actions                                                    */
/* ------------------------------------------------------------------ */

export const createOwnItem = async (viewer: Viewer, date: string, fields: ItemFields): Promise<IDeliverable> => {
    const status = await newItemStatus(viewer.id, date);
    return Deliverable.create({
        ...fields,
        employeeId: viewer.id,
        companyId: viewer.companyId,
        dateKey: date,
        source: "self",
        order: await nextOrder(viewer.id, date),
        createdBy: viewer.id,
        approvalStatus: status,
        submittedAt: status === "pending" ? new Date() : null,
    });
};

// The owner can change or remove an item until it is approved, and only on days they can still plan.
export const assertOwnerCanChange = (item: IDeliverable, viewer: Viewer, action: "edit" | "remove"): void => {
    if (String(item.employeeId) !== viewer.id) throw forbidden();
    if (!plannableDays().includes(item.dateKey)) throw conflict(`Past days can no longer be changed`);
    if (item.reportedAt) throw conflict("This item was already reported in an EOD report");
    // A task picked by mistake can still be removed; it was only pre-approved because the admin assigned the task.
    if (action === "remove" && item.source === "task") return;
    if (item.approvalStatus === "approved") {
        throw conflict("This item is approved. Only an approver can change it now");
    }
};

export const reorderOwnDay = async (viewer: Viewer, date: string, ids: string[]): Promise<void> => {
    const existing = await Deliverable.find({ employeeId: viewer.id, dateKey: date }).select("_id").lean();
    const known = new Set(existing.map(i => String(i._id)));
    if (ids.length !== known.size || !ids.every(id => known.has(id))) {
        throw badRequest("ids must list every item of that day exactly once");
    }
    await Deliverable.bulkWrite(ids.map((id, order) => ({
        updateOne: { filter: { _id: id, employeeId: viewer.id }, update: { $set: { order } } },
    })));
};

const isDuplicateKey = (error: unknown) => (error as { code?: number })?.code === 11000;

// Adds open project Tasks assigned to the employee. They are approved already: the admin assigned them.
export const addFromTasks = async (viewer: Viewer, date: string, taskIds: string[]) => {
    const tasks = await Task.find({ _id: { $in: taskIds }, assignedTo: viewer.id, status: { $ne: "Completed" } }).lean();
    if (tasks.length !== taskIds.length) throw badRequest("One or more tasks are invalid, completed, or not assigned to you");

    let order = await nextOrder(viewer.id, date);
    const added: string[] = [];
    const skipped: string[] = [];
    for (const task of tasks) {
        try {
            const item = await Deliverable.create({
                employeeId: viewer.id,
                companyId: viewer.companyId,
                dateKey: date,
                title: String(task.title).slice(0, 200),
                description: String(task.description ?? "").slice(0, 2000),
                projectId: task.projectId,
                taskId: task._id,
                priority: task.priority,
                source: "task",
                order: order++,
                createdBy: viewer.id,
                approvalStatus: "approved",
                approvedAt: new Date(),
                taskProgress: task.progress ?? null,
            });
            added.push(String(item._id));
        } catch (error) {
            if (!isDuplicateKey(error)) throw error;
            skipped.push(String(task._id)); // already on that day
        }
    }
    return { added: added.length, skipped: skipped.length };
};

/**
 * Copies unfinished items to `date`. A "Half completed" item keeps that outcome (and its task %) on the
 * new day; anything else starts as not reported. Task items stay approved; the rest join the day's plan
 * (draft, or pending if that plan was already submitted). Items that were carried before are skipped.
 */
export const carryOverItems = async (
    items: IDeliverable[] | any[],
    employeeId: string,
    companyId: Types.ObjectId | undefined,
    date: string,
    actorId: string
) => {
    const unfinished = items.filter(i => i.outcome !== "completed");
    if (unfinished.length === 0) return { added: 0, skipped: 0 };

    const status = await newItemStatus(employeeId, date);
    let order = await nextOrder(employeeId, date);
    let added = 0;
    let skipped = 0;

    for (const item of unfinished) {
        const fromTask = !!item.taskId;
        const half = item.outcome === "in_progress";
        try {
            await Deliverable.create({
                employeeId,
                companyId,
                dateKey: date,
                title: item.title,
                description: item.description ?? "",
                projectId: item.projectId?._id ?? item.projectId ?? null,
                taskId: item.taskId?._id ?? item.taskId ?? null,
                priority: item.priority,
                estimatedHours: item.estimatedHours ?? null,
                source: "carried_over",
                carriedFromId: item._id,
                order: order++,
                createdBy: actorId,
                approvalStatus: fromTask ? "approved" : status,
                approvedAt: fromTask ? new Date() : null,
                submittedAt: !fromTask && status === "pending" ? new Date() : null,
                outcome: half ? "in_progress" : null,
                taskProgress: half ? item.taskProgress ?? null : null,
            });
            added++;
        } catch (error) {
            if (!isDuplicateKey(error)) throw error;
            skipped++; // carried already, or that task is already on the target day
        }
    }
    return { added, skipped };
};

// "Carry over unfinished" on the Today page: from the most recent earlier day that had a plan,
// so Friday's leftovers show up on Monday.
export const carryOverFromPreviousDay = async (viewer: Viewer, date: string) => {
    const previous = await Deliverable.findOne({ employeeId: viewer.id, dateKey: { $lt: date } })
        .sort({ dateKey: -1 }).select("dateKey").lean();
    if (!previous) return { from: null, added: 0, skipped: 0 };

    const items = await Deliverable.find({ employeeId: viewer.id, dateKey: previous.dateKey }).sort({ order: 1 }).lean();
    const result = await carryOverItems(items, viewer.id, viewer.companyId, date, viewer.id);
    return { from: previous.dateKey, ...result };
};

// draft -> pending for the whole day.
export const submitOwnDay = async (viewer: Viewer, date: string): Promise<number> => {
    const result = await Deliverable.updateMany(
        { employeeId: viewer.id, dateKey: date, approvalStatus: "draft" },
        { $set: { approvalStatus: "pending", submittedAt: new Date() } }
    );
    if (result.modifiedCount === 0) throw conflict("There is nothing to submit for this day");
    return result.modifiedCount;
};

// Projects the user can link an item to: their own projects, or every project for approvers.
export const linkableProjects = async (viewer: Viewer) => {
    const filter = viewer.canApprove ? {} : { employees: viewer.id };
    return Project.find(filter).select("name status").sort({ name: 1 }).lean();
};

/* ------------------------------------------------------------------ */
/* Approver actions                                                    */
/* ------------------------------------------------------------------ */

// Nobody approves or edits (as approver) their own plan. The team lead's plan is approved by the admin.
export const assertNotOwnPlan = (employeeId: unknown, viewer: Viewer): void => {
    if (String(employeeId) === viewer.id) throw forbidden("You cannot approve or change your own plan as an approver");
};

const EDIT_TRACKED = ["title", "description", "priority", "estimatedHours"] as const;

/** Applies an approver's changes. The employee's own wording is kept the first time anything changes. */
export const applyApproverEdit = (item: IDeliverable, fields: ItemFields, viewer: Viewer): boolean => {
    const changed = (Object.keys(fields) as (keyof ItemFields)[]).filter(key => {
        const before = key === "projectId" ? (item.projectId ? String(item.projectId) : null) : (item as any)[key] ?? null;
        const after = key === "projectId" ? (fields.projectId ? String(fields.projectId) : null) : fields[key] ?? null;
        return before !== after;
    });
    if (changed.length === 0) return false;

    if (!item.original && changed.some(k => (EDIT_TRACKED as readonly string[]).includes(k))) {
        item.original = {
            title: item.title,
            description: item.description,
            priority: item.priority,
            estimatedHours: item.estimatedHours ?? null,
        };
    }
    item.set(fields);
    item.editedByApprover = true;
    item.editedBy = new Types.ObjectId(viewer.id);
    item.editedAt = new Date();
    return true;
};

// The employee an approver adds an item for: an active, existing user who is not the approver.
export const loadPlanOwner = async (employeeId: unknown, viewer: Viewer) => {
    if (!isObjectId(employeeId)) throw badRequest("employeeId is not a valid id");
    assertNotOwnPlan(employeeId, viewer);
    const employee = await User.findById(employeeId).select("name status companyId role").lean();
    if (!employee || employee.status === "inactive") throw notFound("Employee not found");
    return employee;
};

export const createItemForEmployee = async (
    viewer: Viewer, employee: { _id: Types.ObjectId; companyId?: Types.ObjectId | null }, date: string, fields: ItemFields
): Promise<IDeliverable> => {
    const employeeId = String(employee._id);
    return Deliverable.create({
        ...fields,
        employeeId,
        companyId: employee.companyId ?? undefined,
        dateKey: date,
        source: "approver",
        order: await nextOrder(employeeId, date),
        createdBy: viewer.id,
        // Added by an approver, so approved by definition.
        approvalStatus: "approved",
        approvedBy: viewer.id,
        approvedAt: new Date(),
    });
};

export interface PlanRef { employeeId: string; date: string }

export const asPlanRefs = (value: unknown): PlanRef[] => {
    if (!Array.isArray(value) || value.length === 0) throw badRequest("plans must be a non-empty array of { employeeId, date }");
    if (value.length > 200) throw badRequest("plans has too many items");
    return value.map((p, i) => {
        if (typeof p !== "object" || p === null) throw badRequest(`plans[${i}] is invalid`);
        const employeeId = (p as any).employeeId;
        if (!isObjectId(employeeId)) throw badRequest(`plans[${i}].employeeId is not a valid id`);
        return { employeeId: String(employeeId), date: asDayKey((p as any).date, `plans[${i}].date`) };
    });
};

/** pending -> approved for each plan. Own plans are skipped (and reported), never approved. */
export const approvePlans = async (viewer: Viewer, plans: PlanRef[]) => {
    const results: { employeeId: string; date: string; approved: number; skipped?: "own plan" }[] = [];
    const now = new Date();
    for (const plan of plans) {
        if (plan.employeeId === viewer.id) {
            results.push({ ...plan, approved: 0, skipped: "own plan" });
            continue;
        }
        // Filter on "pending": a second approver clicking at the same time approves nothing twice.
        const r = await Deliverable.updateMany(
            { employeeId: plan.employeeId, dateKey: plan.date, approvalStatus: "pending" },
            { $set: { approvalStatus: "approved", approvedBy: viewer.id, approvedAt: now } }
        );
        results.push({ ...plan, approved: r.modifiedCount });
    }
    return results;
};

const EMPLOYEE_FIELDS = "name email position companyId";

/**
 * Approval queue: every employee-day with pending items (not the viewer's own), newest day first.
 * Each group has all submitted items of that day so the approver sees the whole plan.
 */
export const approvalQueue = async (viewer: Viewer, filter: { date?: string; from?: string; to?: string; employeeId?: string }) => {
    const match: Record<string, unknown> = {
        approvalStatus: "pending",
        employeeId: { $ne: new Types.ObjectId(viewer.id) },
    };
    if (filter.date) match.dateKey = filter.date;
    else if (filter.from || filter.to) {
        match.dateKey = { ...(filter.from ? { $gte: filter.from } : {}), ...(filter.to ? { $lte: filter.to } : {}) };
    }
    if (filter.employeeId) {
        if (filter.employeeId === viewer.id) return [];
        match.employeeId = new Types.ObjectId(filter.employeeId);
    }

    const pairs: { _id: { employeeId: Types.ObjectId; dateKey: string }; pending: number }[] = await Deliverable.aggregate([
        { $match: match },
        { $group: { _id: { employeeId: "$employeeId", dateKey: "$dateKey" }, pending: { $sum: 1 } } },
        { $sort: { "_id.dateKey": -1 } },
        { $limit: 200 },
    ]);
    if (pairs.length === 0) return [];

    const [items, employees] = await Promise.all([
        populateItems(Deliverable.find({
            $or: pairs.map(p => ({ employeeId: p._id.employeeId, dateKey: p._id.dateKey })),
            approvalStatus: { $ne: "draft" },
        }).sort({ order: 1, createdAt: 1 })).lean(),
        User.find({ _id: { $in: pairs.map(p => p._id.employeeId) } }).select(EMPLOYEE_FIELDS).lean(),
    ]);
    const byEmployee = new Map(employees.map(e => [String(e._id), e]));

    return pairs.map(p => ({
        employee: byEmployee.get(String(p._id.employeeId)) ?? { _id: p._id.employeeId, name: "Unknown" },
        date: p._id.dateKey,
        pending: p.pending,
        items: items.filter(i => String(i.employeeId) === String(p._id.employeeId) && i.dateKey === p._id.dateKey),
    }));
};

/**
 * Team day view (for the EOD meeting): every active employee with their items, plan state and EOD of that day.
 * Admin accounts are left out; they do not plan.
 */
export const teamDay = async (date: string, companyId?: string) => {
    const userFilter: Record<string, unknown> = { role: { $ne: "admin" }, status: "active" };
    if (companyId) userFilter.companyId = new Types.ObjectId(companyId);
    const employees = await User.find(userFilter).select(EMPLOYEE_FIELDS).sort({ name: 1 }).lean();
    const ids = employees.map(e => e._id);

    const [items, reports] = await Promise.all([
        populateItems(Deliverable.find({ employeeId: { $in: ids }, dateKey: date }).sort({ order: 1, createdAt: 1 })).lean(),
        EODReport.find({ employeeId: { $in: ids }, dateKey: date })
            .select("employeeId summary blockers tomorrowPlan overallProgress deliverableStats status createdAt").lean(),
    ]);

    return employees.map(employee => {
        const own = items.filter(i => String(i.employeeId) === String(employee._id));
        const eod = reports.find(r => String(r.employeeId) === String(employee._id)) ?? null;
        return { employee, state: planState(own), items: own, eod };
    });
};
