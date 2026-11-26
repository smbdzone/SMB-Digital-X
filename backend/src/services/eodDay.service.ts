import { Types } from "mongoose";
import Deliverable, { DELIVERABLE_OUTCOMES, DeliverableOutcome, IDeliverable } from "../model/deliverable.model.js";
import Task from "../model/task.model.js";
import User from "../model/user.model.js";
import { asText, badRequest, isObjectId } from "../utils/http.js";
import { shiftDayKey } from "../utils/dates.js";
import { asHours, asIdArray, carryOverItems } from "./deliverable.service.js";

/**
 * The deliverables part of an EOD report: the outcome of each of the day's items, the Task sync and
 * "carry over to tomorrow". Split in prepare (validate only, no writes) and write, so a bad request
 * never leaves half of the changes saved.
 */

export interface OutcomeInput {
    deliverableId: string;
    outcome: DeliverableOutcome;
    outcomeNote: string;
    actualHours: number | null;
    taskProgress: number | null;
}

export interface DeliverableStats {
    planned: number;
    completed: number;
    inProgress: number;
    notStarted: number;
}

export interface PreparedDayReport {
    employeeId: string;
    date: string;
    items: IDeliverable[];
    finalOutcome: Map<string, DeliverableOutcome>;
    inputs: Map<string, OutcomeInput>;
    carryOver: string[];
    stats: DeliverableStats;
    // Completed counts 1, "Half completed" (in_progress) counts 0.5, out of every item of the day.
    overallProgress: number;
    completedTaskIds: string[];
    inProgressTaskIds: string[];
}

const asOutcomes = (value: unknown): OutcomeInput[] => {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) throw badRequest("outcomes must be an array");
    if (value.length > 100) throw badRequest("outcomes has too many items");
    const seen = new Set<string>();
    return value.map((raw, i) => {
        if (typeof raw !== "object" || raw === null) throw badRequest(`outcomes[${i}] is invalid`);
        const o = raw as Record<string, unknown>;
        if (!isObjectId(o.deliverableId)) throw badRequest(`outcomes[${i}].deliverableId is not a valid id`);
        if (seen.has(o.deliverableId)) throw badRequest("outcomes lists the same deliverable twice");
        seen.add(o.deliverableId);
        if (!DELIVERABLE_OUTCOMES.includes(o.outcome as DeliverableOutcome)) {
            throw badRequest(`outcomes[${i}].outcome must be one of ${DELIVERABLE_OUTCOMES.join(", ")}`);
        }
        let taskProgress: number | null = null;
        if (o.taskProgress !== undefined && o.taskProgress !== null && o.taskProgress !== "") {
            const n = typeof o.taskProgress === "string" ? Number(o.taskProgress) : o.taskProgress;
            if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) {
                throw badRequest(`outcomes[${i}].taskProgress must be between 0 and 100`);
            }
            taskProgress = Math.round(n);
        }
        return {
            deliverableId: o.deliverableId,
            outcome: o.outcome as DeliverableOutcome,
            outcomeNote: asText(o.outcomeNote, `outcomes[${i}].outcomeNote`, { max: 1000 }) ?? "",
            actualHours: o.actualHours === undefined ? null : asHours(o.actualHours, `outcomes[${i}].actualHours`),
            taskProgress,
        };
    });
};

/** Validates the outcomes / carry-over of `date` for one employee. Writes nothing. */
export const prepareDayReport = async (
    employeeId: string, date: string, rawOutcomes: unknown, rawCarryOver: unknown
): Promise<PreparedDayReport> => {
    const outcomes = asOutcomes(rawOutcomes);
    const carryOver = rawCarryOver === undefined || rawCarryOver === null ? [] : asIdArray(rawCarryOver, "carryOver");
    const items = await Deliverable.find({ employeeId, dateKey: date }).sort({ order: 1 });
    const byId = new Map(items.map(i => [String(i._id), i]));

    const inputs = new Map<string, OutcomeInput>();
    for (const o of outcomes) {
        if (!byId.has(o.deliverableId)) throw badRequest("outcomes contains an item that is not on your plan for today");
        inputs.set(o.deliverableId, o);
    }

    // Items without a reported outcome: keep what they have (a carried "Half completed"), else not started.
    const finalOutcome = new Map<string, DeliverableOutcome>();
    for (const item of items) {
        const id = String(item._id);
        finalOutcome.set(id, inputs.get(id)?.outcome ?? item.outcome ?? "not_started");
    }

    for (const id of carryOver) {
        if (!byId.has(id)) throw badRequest("carryOver contains an item that is not on your plan for today");
        if (finalOutcome.get(id) === "completed") throw badRequest("A completed item cannot be carried over");
    }

    const values = [...finalOutcome.values()];
    const stats: DeliverableStats = {
        planned: items.length,
        completed: values.filter(v => v === "completed").length,
        inProgress: values.filter(v => v === "in_progress").length,
        notStarted: values.filter(v => v === "not_started").length,
    };
    const overallProgress = items.length
        ? Math.round(((stats.completed + 0.5 * stats.inProgress) / items.length) * 100)
        : 0;

    const taskIdsWith = (outcome: DeliverableOutcome) => items
        .filter(i => i.taskId && finalOutcome.get(String(i._id)) === outcome)
        .map(i => String(i.taskId));

    return {
        employeeId, date, items, finalOutcome, inputs, carryOver, stats, overallProgress,
        completedTaskIds: taskIdsWith("completed"),
        inProgressTaskIds: taskIdsWith("in_progress"),
    };
};

/**
 * Task sync for a task-sourced item (only if the Task is still assigned to the employee):
 * - completed   -> Task Completed, progress 100, completedAt set (kept if already set)
 * - in progress -> Todo becomes In Progress; a Completed task is reopened; progress takes the reported %
 *                  (below 100, since 100 means Completed). A Task in Review is left alone.
 * - not started -> no change
 */
const syncTask = async (taskId: Types.ObjectId, employeeId: string, outcome: DeliverableOutcome, progress: number | null) => {
    if (outcome === "not_started") return;
    const task = await Task.findOne({ _id: taskId, assignedTo: employeeId });
    if (!task) return;

    if (outcome === "completed") {
        task.status = "Completed";
        task.progress = 100;
        if (!task.completedAt) task.completedAt = new Date();
    } else {
        if (task.status === "Review") return;
        if (task.status === "Todo" || task.status === "Completed") task.status = "In Progress";
        task.completedAt = undefined;
        task.progress = Math.min(progress ?? task.progress ?? 0, 99);
    }
    await task.save();
};

/** Saves the outcomes, syncs Tasks and carries items over to the next day. */
export const writeDayReport = async (prepared: PreparedDayReport): Promise<{ carried: number }> => {
    const now = new Date();
    for (const item of prepared.items) {
        const id = String(item._id);
        const input = prepared.inputs.get(id);
        const outcome = prepared.finalOutcome.get(id)!;
        item.outcome = outcome;
        item.reportedAt = now;
        if (input) {
            item.outcomeNote = input.outcomeNote;
            item.actualHours = input.actualHours;
            if (item.taskId) {
                if (input.taskProgress !== null) item.taskProgress = input.taskProgress;
                if (outcome === "completed") item.taskProgress = 100;
            }
        }
        await item.save();
        if (item.taskId) await syncTask(item.taskId, prepared.employeeId, outcome, item.taskProgress ?? null);

        // Finished after all (e.g. the report was edited): drop a copy that was carried over and is untouched.
        if (outcome === "completed") {
            await Deliverable.deleteMany({ carriedFromId: item._id, reportedAt: null });
        }
    }

    if (prepared.carryOver.length === 0) return { carried: 0 };
    const employee = await User.findById(prepared.employeeId).select("companyId").lean();
    const toCarry = prepared.items.filter(i => prepared.carryOver.includes(String(i._id)));
    const result = await carryOverItems(
        toCarry, prepared.employeeId, employee?.companyId ?? undefined, shiftDayKey(prepared.date, 1), prepared.employeeId
    );
    return { carried: result.added };
};
