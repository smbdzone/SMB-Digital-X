import express from "express";
import {
    addTasksToDay, approve, carryOverToDay, createDeliverable, deleteDeliverable, getAccess, getApprovalQueue,
    getEmployeeDay, getLinkableProjects, getMyDay, getTeamDay, reorderMyDay, submitMyDay, updateDeliverable,
} from "../controller/deliverable.controller.js";
import { isVerified } from "../middlewares/isVerified.js";

const router = express.Router();

// Every route needs a logged-in user. Who may do what (owner / approver) is checked in the controller,
// because approver rights come from the database, not from the JWT role.
router.use(isVerified);

router.get("/access", getAccess);
router.get("/projects", getLinkableProjects);

// Employee: own plan
router.get("/my", getMyDay);
router.put("/my/order", reorderMyDay);
router.post("/from-tasks", addTasksToDay);
router.post("/carry-over", carryOverToDay);
router.post("/submit", submitMyDay);
router.post("/", createDeliverable);

// Approvers (admin or canApproveDeliverables; checked in the controller)
router.get("/approvals", getApprovalQueue);
router.post("/approve", approve);
router.get("/team", getTeamDay);
// Self, or approver
router.get("/day", getEmployeeDay);

// Owner (or approver) - checked inside the controller. Keep below the fixed paths.
router.patch("/:id", updateDeliverable);
router.delete("/:id", deleteDeliverable);

export default router;
