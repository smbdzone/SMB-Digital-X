import { Request, Response } from "express";
import Task from "../model/task.model.js";
import projectModel from "../model/project.model.js";
import mongoose from "mongoose";

export const assignProject = async (req: Request, res: Response): Promise<void> => {
    try {
        const {
            projectId,
            title,
            description,
            assignedTo,
            status,
            priority,
            progress,
            startDate,
            dueDate,
            completedAt,
            notes
        } = req.body;

        if (!projectId || !title || !assignedTo) {
            res.status(400).json({
                success: false,
                message: "projectId, title and assignedTo is required"
            });
            return;
        }

        const projectExist = await projectModel.findById(projectId);

        if (!projectExist) {
            res.status(404).json({
                success: false,
                message: "Project not found"
            });
            return;
        }

        // Add employee to project if not already assigned
        const employeeAlreadyAssigned = projectExist.employees.some(
            (employeeId) => employeeId.toString() === assignedTo.toString()
        );

        if (!employeeAlreadyAssigned) {
            projectExist.employees.push(assignedTo);
            await projectExist.save();
        }

        const newAssignProject = new Task({
            projectId,
            title,
            description,
            assignedTo,
            status,
            priority,
            progress,
            startDate,
            dueDate,
            completedAt,
            notes
        });

        await newAssignProject.save();

        res.status(201).json({
            success: true,
            message: "Project assigned successfully",
            data: newAssignProject
        });

    } catch (error) {
        console.error("assign project error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to assign project"
        });
    }
};

export const getSingleTask = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        const task = await Task.findById(id).populate([
            { path: 'projectId', select: 'name category clientName' },
            { path: 'assignedTo', select: 'name email' }
        ])

        if (!task) {
            res.status(400).json({
                success: false,
                message: 'Task not found'
            })
            return;
        }

        res.status(200).json({
            success: true,
            message: 'Single task',
            data: task
        })

    } catch (error) {
        console.log(`Error in get Single task`, error);
        res.status(500).json({
            success: false,
            message: 'internal server error'
        })
    }
}

export const taskByProject = async (req: Request, res: Response): Promise<void> => {
    try {
        const { projectId } = req.params
        const tasks = await Task.find({ projectId: projectId }).populate([
            { path: 'projectId', select: 'name category clientName' },
            { path: 'assignedTo', select: 'name email' }
        ]).sort('-_id').lean()

        if (!tasks) {
            res.status(400).json({
                success: false,
                message: 'Task not found'
            })
            return;
        }

        res.status(200).json({
            success: true,
            message: 'Task by projectId',
            data: tasks
        })

    } catch (error) {
        console.log(`Error in task by project`, error)
        res.status(500).send({
            success: false,
            message: 'internal server error'
        })
    }
}

export const updateTask = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params;

        // --------------------------------------------------
        // Find existing task
        // --------------------------------------------------

        const existingTask = await Task.findById(id);

        if (!existingTask) {
            res.status(404).json({
                success: false,
                message: "Task not found"
            });
            return;
        }

        const {
            projectId,
            title,
            description,
            assignedTo,
            status,
            priority,
            progress,
            startDate,
            dueDate,
            completedAt,
            notes
        } = req.body;

        // --------------------------------------------------
        // Determine final values
        // --------------------------------------------------

        const finalProjectId =
            projectId ?? existingTask.projectId;

        const finalAssignedTo =
            assignedTo ?? existingTask.assignedTo;

        const finalProgress =
            progress !== undefined
                ? Number(progress)
                : existingTask.progress;

        let finalStatus =
            status ?? existingTask.status;

        // --------------------------------------------------
        // Validate progress
        // --------------------------------------------------

        if (
            finalProgress < 0 ||
            finalProgress > 100 ||
            Number.isNaN(finalProgress)
        ) {
            res.status(400).json({
                success: false,
                message: "Progress must be between 0 and 100"
            });
            return;
        }

        // --------------------------------------------------
        // Automatically handle status
        // --------------------------------------------------

        if (finalProgress === 100) {
            finalStatus = "Completed";
        } else if (
            finalStatus === "Completed" &&
            finalProgress < 100
        ) {
            finalStatus = "In Progress";
        }

        // --------------------------------------------------
        // Check project
        // --------------------------------------------------

        const projectExist =
            await projectModel.findById(
                finalProjectId
            );

        if (!projectExist) {
            res.status(404).json({
                success: false,
                message: "Project not found"
            });
            return;
        }

        // --------------------------------------------------
        // If employee changed, make sure employee exists
        // --------------------------------------------------

        if (assignedTo) {
            // Assuming project employees are ObjectIds
            // We only need to ensure the employee is
            // connected to the project.

            const employeeAlreadyAssigned =
                projectExist.employees.some(
                    (employeeId: any) =>
                        employeeId.toString() ===
                        finalAssignedTo.toString()
                );

            if (!employeeAlreadyAssigned) {
                projectExist.employees.push(
                    finalAssignedTo
                );

                await projectExist.save();
            }
        }

        // --------------------------------------------------
        // Completed date
        // --------------------------------------------------

        let finalCompletedAt =
            existingTask.completedAt;

        if (finalStatus === "Completed") {

            // If already completed, preserve old date
            // Otherwise set current date

            if (!finalCompletedAt) {
                finalCompletedAt = new Date();
            }

        } else {

            // If task becomes incomplete again
            // remove completedAt

            finalCompletedAt = undefined;
        }

        // --------------------------------------------------
        // Build update object
        // --------------------------------------------------

        const updateData: any = {
            projectId: finalProjectId,
            assignedTo: finalAssignedTo,
            progress: finalProgress,
            status: finalStatus,
            completedAt: finalCompletedAt
        };

        if (title !== undefined) {
            updateData.title = title;
        }

        if (description !== undefined) {
            updateData.description = description;
        }

        if (priority !== undefined) {
            updateData.priority = priority;
        }

        if (startDate !== undefined) {
            updateData.startDate = startDate;
        }

        if (dueDate !== undefined) {
            updateData.dueDate = dueDate;
        }

        if (notes !== undefined) {
            updateData.notes = notes;
        }

        // --------------------------------------------------
        // Update task
        // --------------------------------------------------

        const updatedTask =
            await Task.findByIdAndUpdate(
                id,
                updateData,
                {
                    new: true,
                    runValidators: true
                }
            ).populate([
                {
                    path: "projectId",
                    select: "name category clientName"
                },
                {
                    path: "assignedTo",
                    select: "name email"
                }
            ]);

        if (!updatedTask) {
            res.status(404).json({
                success: false,
                message: "Task not found"
            });
            return;
        }

        // --------------------------------------------------
        // Response
        // --------------------------------------------------

        res.status(200).json({
            success: true,
            message: "Task updated successfully",
            data: updatedTask
        });

    } catch (error) {

        console.error(
            "Error in updating task:",
            error
        );

        res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

export const deleteTask = async (req: Request, res: Response): Promise<void> => {
    try {
        const { id } = req.params

        const deleteTask = await Task.findByIdAndDelete(id)
        if (!deleteTask) {
            res.status(401).json({
                success: false,
                message: 'Error in deleting task'
            })
            return;
        }

        res.status(200).json({
            success: true,
            message: 'Task deleted'
        })

    } catch (error) {
        console.log(`Error in delete task`, error);
        res.status(500).json({
            success: false,
            message: 'internal server error'
        })
    }
}

export const getEmployeeTasks = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const employeeId = req.user.id;
        let id = new mongoose.Types.ObjectId(employeeId)

        const tasks = await Task.find({
            assignedTo: employeeId,
            status: {
                $ne: 'Completed'
            }
        })
            .populate('projectId', 'name category')
            .sort({ dueDate: 1 })
        res.status(200).json({
            success: true,
            message: 'Tasks found',
            data: tasks
        });

    } catch (error) {
        console.log('Error in get Employee task list', error);

        res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

