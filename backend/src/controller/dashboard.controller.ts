import { Request, Response } from "express";
import Project from "../model/project.model.js"
import Expense from "../model/expense.model.js";
import User from "../model/user.model.js";

export const getDashboard = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        /*
        |--------------------------------------------------------------------------
        | Project Statistics
        |--------------------------------------------------------------------------
        */

        const totalProjects = await Project.countDocuments();

        const activeProjects =
            await Project.countDocuments({
                status: "Active",
            });

        const completedProjects =
            await Project.countDocuments({
                status: "Completed",
            });

        const planningProjects =
            await Project.countDocuments({
                status: "Planning",
            });

        const onHoldProjects =
            await Project.countDocuments({
                status: "On Hold",
            });

        /*
        |--------------------------------------------------------------------------
        | Employee Statistics
        |--------------------------------------------------------------------------
        */

        const totalEmployees =
            await User.countDocuments({
                role: "employee",
            });

        const activeEmployees =
            await User.countDocuments({
                role: "employee",
                status: "active",
            });

        /*
        | Company-wide finance figures (total and monthly expenses, total and remaining budget, spending by project)
        | are calculated in the Owner Console's Finance view from data it can unlock; the website shows
        | "Locked: view in the Owner Console" instead.
        */

        /*
        |--------------------------------------------------------------------------
        | Recent Projects
        |--------------------------------------------------------------------------
        */

        const recentProjects =
            await Project.find()
                .sort({
                    createdAt: -1,
                })
                .limit(5)
                .select(
                    "name clientName status deadline createdAt"
                )
                .lean();

        /*
        |--------------------------------------------------------------------------
        | Recent Expenses
        |--------------------------------------------------------------------------
        */

        const recentExpenses =
            await Expense.find()
                .populate(
                    "projectId",
                    "name clientName"
                )
                .populate(
                    "addedBy",
                    "name email"
                )
                .sort({
                    createdAt: -1,
                })
                .limit(5)
                .lean();

        /*
        |--------------------------------------------------------------------------
        | Response
        |--------------------------------------------------------------------------
        */

        res.status(200).json({
            success: true,
            message: "Dashboard data fetched successfully",

            data: {
                projects: {
                    total: totalProjects,
                    active: activeProjects,
                    completed: completedProjects,
                    planning: planningProjects,
                    onHold: onHoldProjects,
                },

                employees: {
                    total: totalEmployees,
                    active: activeEmployees,
                },

                finance: { locked: true },

                recentProjects,

                recentExpenses,
            },
        });
    } catch (error) {
        console.error(
            "Dashboard error:",
            error
        );

        res.status(500).json({
            success: false,
            message:
                "Failed to fetch dashboard data",
        });
    }
};