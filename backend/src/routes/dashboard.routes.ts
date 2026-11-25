import express from "express";

import {
    getDashboard,
} from "../controller/dashboard.controller.js";
import { isAllow } from "../middlewares/isVerified.js";

const router = express.Router();

// Company-wide finance figures (expenses, budgets): employer (admin) only.
// isVerified is applied where the router is mounted (index.ts).
router.get(
    "/",
    isAllow(["admin"]),
    getDashboard
);

export default router;
