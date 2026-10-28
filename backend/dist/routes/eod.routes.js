import express from "express";
import { createEOD, getMyEOD, getSingleEOD, getAllEOD, getMissingEOD, updateMyEOD, reviewEOD } from "../controller/eod.controller.js";
import { isAllow, isVerified } from "../middlewares/isVerified.js";
const router = express.Router();
const adminOnly = isAllow(["admin"]);
// Every EOD route requires a logged-in user.
router.use(isVerified);
// Employee
router.post("/", createEOD);
router.get("/my", getMyEOD);
// Admin (must stay above "/:id")
router.get("/", adminOnly, getAllEOD);
router.get("/missing", adminOnly, getMissingEOD);
router.patch("/:id/review", adminOnly, reviewEOD);
// Owner (or admin for GET) - checked inside the controller
router.get("/:id", getSingleEOD);
router.patch("/:id", updateMyEOD);
export default router;
