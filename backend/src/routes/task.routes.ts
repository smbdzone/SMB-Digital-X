import express from "express";
import {
    assignProject,
    getSingleTask,
    taskByProject,
    updateTask,
    deleteTask,
    getEmployeeTasks
} from "../controller/task.controller.js";
import { isAllow, isVerified } from "../middlewares/isVerified.js";

const router = express.Router();
const adminOnly = isAllow(["admin"]);

// Every task route requires a logged-in user.
router.use(isVerified);

router.post("/", adminOnly, assignProject);
router.get('/employee', getEmployeeTasks)
router.get("/project/:projectId", adminOnly, taskByProject);
// Admin, or the employee the task is assigned to (checked inside the controller)
router.get("/:id", getSingleTask);
router.put("/:id", updateTask);
router.delete("/:id", adminOnly, deleteTask);


export default router;
