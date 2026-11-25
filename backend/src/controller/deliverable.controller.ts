import { Request, Response } from "express";
import { Types } from "mongoose";
import Deliverable from "../model/deliverable.model.js";
import { asStatsRange, daySummary, statsFor, teamStats } from "../services/deliverableStats.service.js";
import { asObjectId, badRequest, conflict, forbidden, getAuth, notFound, paramId, queryString } from "../utils/http.js";
import {
    addFromTasks, applyApproverEdit, approvalQueue, approvePlans, asIdArray, asPlanDay, asPlanRefs, assertNotOwnPlan,
    assertOwnerCanChange, carryOverFromPreviousDay, createItemForEmployee, createOwnItem, dayItems, linkableProjects,
    loadPlanOwner, loadViewer, parseItemFields, planState, populateItems, reorderOwnDay, requireApprover, submitOwnDay,
    teamDay,
} from "../services/deliverable.service.js";
import { asDayKey, dayKey } from "../utils/dates.js";
import {
    notifyItemAddedToSubmittedPlan, notifyPlanApproved, notifyPlanChanged, notifyPlanSubmitted,
} from "../services/deliverableNotify.js";

/* ------------------------------------------------------------------ */
/* Employee: own plan                                                  */
/* ------------------------------------------------------------------ */

// GET /api/deliverables/my?date=YYYY-MM-DD   (default today; any day can be read)
export const getMyDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const date = queryString(req.query.date) ? asDayKey(queryString(req.query.date)) : dayKey();
    const items = await dayItems(viewer.id, date);
    res.status(200).json({
        success: true,
        message: "Deliverables found",
        data: { date, today: dayKey(), state: planState(items), items },
    });
};

// POST /api/deliverables   { date?, title, description?, priority?, estimatedHours?, projectId?, employeeId? }
// employeeId (someone else) = an approver adding to that employee's plan; the item is approved at once.
export const createDeliverable = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const b = req.body ?? {};
    const date = asPlanDay(b.date);

    const forOther = b.employeeId !== undefined && String(b.employeeId) !== viewer.id;
    let item;
    if (forOther) {
        requireApprover(viewer);
        const employee = await loadPlanOwner(b.employeeId, viewer);
        const fields = await parseItemFields(b, { requireTitle: true, employeeId: String(employee._id), byApprover: true });
        item = await createItemForEmployee(viewer, employee, date, fields);
        notifyPlanChanged(viewer, String(employee._id), date, "added", item.title);
    } else {
        const fields = await parseItemFields(b, { requireTitle: true, employeeId: viewer.id, byApprover: false });
        item = await createOwnItem(viewer, date, fields);
        if (item.approvalStatus === "pending") notifyItemAddedToSubmittedPlan(viewer, date, item.title);
    }

    const data = await populateItems(Deliverable.findById(item._id)).lean();
    res.status(201).json({ success: true, message: "Deliverable added", data });
};

// PATCH /api/deliverables/:id   owner until approved; approvers on other people's items at any time
export const updateDeliverable = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const item = await Deliverable.findById(paramId(req));
    if (!item) throw notFound("Deliverable not found");

    let notifyEmployee = false;
    if (String(item.employeeId) === viewer.id) {
        assertOwnerCanChange(item, viewer, "edit");
        const fields = await parseItemFields(req.body ?? {}, { requireTitle: false, employeeId: viewer.id, byApprover: false });
        item.set(fields);
    } else {
        if (!viewer.canApprove) throw forbidden();
        assertNotOwnPlan(item.employeeId, viewer);
        const fields = await parseItemFields(req.body ?? {}, { requireTitle: false, employeeId: String(item.employeeId), byApprover: true });
        // Changes to a pending plan are announced when it is approved; changes after approval right away.
        notifyEmployee = applyApproverEdit(item, fields, viewer) && item.approvalStatus === "approved";
    }
    await item.save();
    if (notifyEmployee) notifyPlanChanged(viewer, String(item.employeeId), item.dateKey, "edited", item.title);

    const data = await populateItems(Deliverable.findById(item._id)).lean();
    res.status(200).json({ success: true, message: "Deliverable updated", data });
};

// DELETE /api/deliverables/:id   owner until approved; approvers on other people's items until reported
export const deleteDeliverable = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const item = await Deliverable.findById(paramId(req));
    if (!item) throw notFound("Deliverable not found");

    const byApprover = String(item.employeeId) !== viewer.id;
    if (!byApprover) {
        assertOwnerCanChange(item, viewer, "remove");
    } else {
        if (!viewer.canApprove) throw forbidden();
        assertNotOwnPlan(item.employeeId, viewer);
        if (item.reportedAt) throw conflict("This item was already reported in an EOD report");
    }
    await item.deleteOne();
    if (byApprover) notifyPlanChanged(viewer, String(item.employeeId), item.dateKey, "removed", item.title);
    res.status(200).json({ success: true, message: "Deliverable removed" });
};

// PUT /api/deliverables/my/order   { date?, ids: [...] }  (every item of the day, in the new order)
export const reorderMyDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const b = req.body ?? {};
    const date = asPlanDay(b.date);
    await reorderOwnDay(viewer, date, asIdArray(b.ids, "ids"));
    res.status(200).json({ success: true, message: "Order saved", data: await dayItems(viewer.id, date) });
};

// POST /api/deliverables/from-tasks   { date?, taskIds: [...] }
export const addTasksToDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const b = req.body ?? {};
    const date = asPlanDay(b.date);
    const result = await addFromTasks(viewer, date, asIdArray(b.taskIds, "taskIds", 50));
    res.status(201).json({
        success: true,
        message: `${result.added} task${result.added === 1 ? "" : "s"} added`,
        data: { ...result, items: await dayItems(viewer.id, date) },
    });
};

// POST /api/deliverables/carry-over   { date? }
export const carryOverToDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const date = asPlanDay(req.body?.date);
    const result = await carryOverFromPreviousDay(viewer, date);
    res.status(200).json({
        success: true,
        message: result.from
            ? `${result.added} unfinished item${result.added === 1 ? "" : "s"} carried over from ${result.from}`
            : "No earlier plan to carry over from",
        data: { ...result, items: await dayItems(viewer.id, date) },
    });
};

// POST /api/deliverables/submit   { date? }
export const submitMyDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const date = asPlanDay(req.body?.date);
    const submitted = await submitOwnDay(viewer, date);
    notifyPlanSubmitted(viewer, date, submitted);
    res.status(200).json({
        success: true,
        message: "Plan submitted for approval",
        data: { submitted, items: await dayItems(viewer.id, date) },
    });
};

// GET /api/deliverables/projects  - projects that can be linked to an item
export const getLinkableProjects = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    res.status(200).json({ success: true, message: "Projects found", data: await linkableProjects(viewer) });
};

// GET /api/deliverables/access  - lets the frontend refresh the approver flag
export const getAccess = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    res.status(200).json({ success: true, message: "Access", data: { canApprove: viewer.canApprove, admin: viewer.admin } });
};

/* ------------------------------------------------------------------ */
/* Approvers                                                           */
/* ------------------------------------------------------------------ */

// GET /api/deliverables/day?employeeId=&date=   - one employee's day (self, or approver/admin)
export const getEmployeeDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const employeeId = String(asObjectId(queryString(req.query.employeeId), "employeeId"));
    if (employeeId !== viewer.id && !viewer.canApprove) throw forbidden();
    const date = queryString(req.query.date) ? asDayKey(queryString(req.query.date)) : dayKey();
    const items = await dayItems(employeeId, date);
    res.status(200).json({ success: true, message: "Deliverables found", data: { date, state: planState(items), items } });
};

// GET /api/deliverables/approvals?date= | from=&to=  &employeeId=
export const getApprovalQueue = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    requireApprover(viewer);
    const q = req.query;
    const date = queryString(q.date) ? asDayKey(queryString(q.date)) : undefined;
    const from = queryString(q.from) ? asDayKey(queryString(q.from), "from") : undefined;
    const to = queryString(q.to) ? asDayKey(queryString(q.to), "to") : undefined;
    if (from && to && from > to) throw badRequest("from must not be after to");
    const employeeId = queryString(q.employeeId) ? String(asObjectId(queryString(q.employeeId), "employeeId")) : undefined;

    const plans = await approvalQueue(viewer, { date, from, to, employeeId });
    res.status(200).json({ success: true, message: "Plans waiting for approval", data: plans });
};

// POST /api/deliverables/approve   { plans: [{ employeeId, date }] }   (one plan, or bulk)
export const approve = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    requireApprover(viewer);
    const results = await approvePlans(viewer, asPlanRefs(req.body?.plans));
    for (const r of results) {
        if (r.approved > 0) notifyPlanApproved(viewer, r.employeeId, r.date);
    }
    const approved = results.reduce((n, r) => n + r.approved, 0);
    const skippedOwn = results.some(r => r.skipped === "own plan");
    res.status(200).json({
        success: true,
        message: `${approved} item${approved === 1 ? "" : "s"} approved${skippedOwn ? "; your own plan was skipped" : ""}`,
        data: results,
    });
};

// GET /api/deliverables/team?date=&companyId=   - everyone's day, for the EOD meeting
export const getTeamDay = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    requireApprover(viewer);
    const date = queryString(req.query.date) ? asDayKey(queryString(req.query.date)) : dayKey();
    const companyId = queryString(req.query.companyId) ? String(asObjectId(queryString(req.query.companyId), "companyId")) : undefined;
    res.status(200).json({ success: true, message: "Team day", data: { date, employees: await teamDay(date, companyId) } });
};

/* ------------------------------------------------------------------ */
/* Performance                                                         */
/* ------------------------------------------------------------------ */

// GET /api/deliverables/stats/me?from=&to=   (default: month to date)
export const getMyStats = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const range = asStatsRange(queryString(req.query.from), queryString(req.query.to));
    const stats = await statsFor([new Types.ObjectId(viewer.id)], range);
    res.status(200).json({ success: true, message: "Your performance", data: { ...range, stats: stats.get(viewer.id) } });
};

// GET /api/deliverables/stats?from=&to=&employeeId=&companyId=   (approvers)
export const getTeamStats = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    requireApprover(viewer);
    const q = req.query;
    const range = asStatsRange(queryString(q.from), queryString(q.to));
    const employeeId = queryString(q.employeeId) ? String(asObjectId(queryString(q.employeeId), "employeeId")) : undefined;
    const companyId = queryString(q.companyId) ? String(asObjectId(queryString(q.companyId), "companyId")) : undefined;
    res.status(200).json({ success: true, message: "Team performance", data: { ...range, employees: await teamStats(range, { employeeId, companyId }) } });
};

// GET /api/deliverables/summary?date=   (approvers; dashboard card)
export const getDaySummary = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    requireApprover(viewer);
    const date = queryString(req.query.date) ? asDayKey(queryString(req.query.date)) : dayKey();
    res.status(200).json({ success: true, message: "Today's plans", data: await daySummary(date) });
};
