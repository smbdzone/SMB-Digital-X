import express from "express";
import {
    assignProject,
    getSingleTask,
    taskByProject,
    updateTask,
    deleteTask,
    getEmployeeTasks
} from "../controller/task.controller.js";
import { isVerified } from "../middlewares/isVerified.js";

const router = express.Router();

router.post("/", assignProject);
router.get('/employee', isVerified, getEmployeeTasks)
router.get("/project/:projectId", taskByProject);
router.get("/:id", getSingleTask);
router.put("/:id", updateTask);
router.delete("/:id", deleteTask);


export default router;