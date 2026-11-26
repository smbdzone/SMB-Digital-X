import User from "../model/user.model.js";
import Deliverable from "../model/deliverable.model.js";
import { sendPushToUsers } from "./push.service.js";

/**
 * Push notifications for daily deliverables (browser push only, no emails).
 * Everything here runs in the background and never fails the request that triggered it.
 */

const background = (work: () => Promise<unknown>): void => {
    void work().catch(error => console.error("[deliverables] push notification failed:", error));
};

// "2026-11-25" -> "25 Nov"
const shortDay = (date: string): string =>
    new Date(`${date}T00:00:00.000Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Active approvers: the admin and every user flagged with canApproveDeliverables, except `exceptId`.
const approverIds = async (exceptId: string): Promise<string[]> => {
    const ids = await User.find({
        status: "active",
        _id: { $ne: exceptId },
        $or: [{ role: "admin" }, { canApproveDeliverables: true }],
    }).distinct("_id");
    return ids.map(String);
};

const queueUrl = (date: string) => `/deliverables/approvals?date=${date}`;
const planUrl = (date: string) => `/deliverables?date=${date}`;

/** Employee submitted their plan -> approvers. */
export const notifyPlanSubmitted = (employee: { id: string; name: string }, date: string, count: number): void =>
    background(async () => {
        await sendPushToUsers(await approverIds(employee.id), {
            title: `${employee.name} submitted a plan`,
            body: `${count} deliverable${count === 1 ? "" : "s"} for ${shortDay(date)} waiting for approval`,
            url: queueUrl(date),
            tag: `deliverables-queue-${employee.id}-${date}`,
        });
    });

/** Employee added an item to a plan that was already submitted -> approvers. */
export const notifyItemAddedToSubmittedPlan = (employee: { id: string; name: string }, date: string, title: string): void =>
    background(async () => {
        await sendPushToUsers(await approverIds(employee.id), {
            title: `${employee.name} added a deliverable`,
            body: `${title} (${shortDay(date)}) is waiting for approval`,
            url: queueUrl(date),
            tag: `deliverables-queue-${employee.id}-${date}`,
        });
    });

/** Approver approved a plan -> the employee. Says so when the approver changed something. */
export const notifyPlanApproved = (approver: { name: string }, employeeId: string, date: string): void =>
    background(async () => {
        const edited = await Deliverable.exists({ employeeId, dateKey: date, editedByApprover: true });
        await sendPushToUsers([employeeId], {
            title: edited ? "Your plan was approved with changes" : "Your plan was approved",
            body: `${approver.name} approved your deliverables for ${shortDay(date)}`,
            url: planUrl(date),
            tag: `deliverables-${employeeId}-${date}`,
        });
    });

/** Approver edited, added or removed an item of an employee's plan -> the employee. */
export const notifyPlanChanged = (
    approver: { name: string },
    employeeId: string,
    date: string,
    change: "edited" | "added" | "removed",
    title: string
): void =>
    background(async () => {
        await sendPushToUsers([employeeId], {
            title: `Your plan for ${shortDay(date)} was changed`,
            body: `${approver.name} ${change} "${title}"`,
            url: planUrl(date),
            tag: `deliverables-${employeeId}-${date}`,
        });
    });
