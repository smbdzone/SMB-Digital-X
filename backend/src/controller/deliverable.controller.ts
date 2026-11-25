import { Request, Response } from "express";
import Deliverable from "../model/deliverable.model.js";
import { getAuth, notFound, paramId, queryString } from "../utils/http.js";
import {
    addFromTasks, asIdArray, asPlanDay, assertOwnerCanChange, carryOverFromPreviousDay, createOwnItem, dayItems,
    linkableProjects, loadViewer, parseItemFields, planState, populateItems, reorderOwnDay, submitOwnDay,
} from "../services/deliverable.service.js";
import { asDayKey, dayKey } from "../utils/dates.js";

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

// POST /api/deliverables   { date?, title, description?, priority?, estimatedHours?, projectId? }
export const createDeliverable = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const b = req.body ?? {};
    const date = asPlanDay(b.date);
    const fields = await parseItemFields(b, { requireTitle: true, employeeId: viewer.id, byApprover: false });
    const item = await createOwnItem(viewer, date, fields);

    const data = await populateItems(Deliverable.findById(item._id)).lean();
    res.status(201).json({ success: true, message: "Deliverable added", data });
};

// PATCH /api/deliverables/:id   (owner, until approved)
export const updateDeliverable = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const item = await Deliverable.findById(paramId(req));
    if (!item) throw notFound("Deliverable not found");

    assertOwnerCanChange(item, viewer, "edit");
    const fields = await parseItemFields(req.body ?? {}, { requireTitle: false, employeeId: viewer.id, byApprover: false });
    item.set(fields);
    await item.save();

    const data = await populateItems(Deliverable.findById(item._id)).lean();
    res.status(200).json({ success: true, message: "Deliverable updated", data });
};

// DELETE /api/deliverables/:id   (owner, until approved)
export const deleteDeliverable = async (req: Request, res: Response): Promise<void> => {
    const viewer = await loadViewer(getAuth(req));
    const item = await Deliverable.findById(paramId(req));
    if (!item) throw notFound("Deliverable not found");

    assertOwnerCanChange(item, viewer, "remove");
    await item.deleteOne();
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
