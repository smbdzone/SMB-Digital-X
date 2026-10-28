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
        | Dates
        |--------------------------------------------------------------------------
        */

        const now = new Date();

        const startOfMonth = new Date(
            now.getFullYear(),
            now.getMonth(),
            1
        );

        const startOfNextMonth = new Date(
            now.getFullYear(),
            now.getMonth() + 1,
            1
        );

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
        |--------------------------------------------------------------------------
        | Expense Statistics
        |--------------------------------------------------------------------------
        */

        const expenseStats =
            await Expense.aggregate([
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: "$totalAmount",
                        },
                    },
                },
            ]);

        const totalExpenses =
            expenseStats[0]?.total || 0;

        /*
        |--------------------------------------------------------------------------
        | Current Month Expenses
        |--------------------------------------------------------------------------
        */

        const monthlyExpenseStats =
            await Expense.aggregate([
                {
                    $match: {
                        date: {
                            $gte: startOfMonth,
                            $lt: startOfNextMonth,
                        },
                    },
                },
                {
                    $group: {
                        _id: null,
                        total: {
                            $sum: "$totalAmount",
                        },
                    },
                },
            ]);

        const monthlyExpenses =
            monthlyExpenseStats[0]?.total || 0;

        /*
        |--------------------------------------------------------------------------
        | Project Budget
        |--------------------------------------------------------------------------
        */

        const budgetStats =
            await Project.aggregate([
                {
                    $group: {
                        _id: null,
                        totalBudget: {
                            $sum: "$budget",
                        },
                    },
                },
            ]);

        const totalProjectBudget =
            budgetStats[0]?.totalBudget || 0;

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
                    "name clientName budget status deadline createdAt"
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
        | Expense By Project
        |--------------------------------------------------------------------------
        */

        const expenseByProject =
            await Expense.aggregate([
                {
                    $group: {
                        _id: "$projectId",
                        total: {
                            $sum: "$totalAmount",
                        },
                    },
                },

                {
                    $sort: {
                        total: -1,
                    },
                },

                {
                    $limit: 10,
                },

                {
                    $lookup: {
                        from: "projects",
                        localField: "_id",
                        foreignField: "_id",
                        as: "project",
                    },
                },

                {
                    $unwind: {
                        path: "$project",
                        preserveNullAndEmptyArrays: true,
                    },
                },

                {
                    $project: {
                        _id: 1,
                        total: 1,
                        project: {
                            _id: "$project._id",
                            name: "$project.name",
                        },
                    },
                },
            ]);

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

                expenses: {
                    total: totalExpenses,
                    monthly: monthlyExpenses,
                },

                budget: {
                    total: totalProjectBudget,
                    remaining:
                        totalProjectBudget -
                        totalExpenses,
                },

                recentProjects,

                recentExpenses,

                expenseByProject,
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