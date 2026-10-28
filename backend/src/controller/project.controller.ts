import { Request, Response } from 'express'
import Project from '../model/project.model.js'

// Create Project
export const createProjectController = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const {
            name,
            clientName,
            description,
            startDate,
            deadline,
            budget,
            category,
            status,
            employees
        } = req.body

        if (!name || !clientName || !startDate || budget === undefined || !category) {
            res.status(400).json({
                success: false,
                message: 'name, clientName, startDate, category and budget are required'
            })
            return
        }

        const project = await Project.create({
            name,
            clientName,
            description,
            startDate,
            deadline,
            category,
            budget,
            status,
            employees: employees || []
        })

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            data: project
        })
    } catch (error) {
        console.error('Create project error:', error)

        res.status(500).json({
            success: false,
            message: 'Failed to create project'
        })
    }
}


// Get All Projects
export const getProjectsController = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const projects = await Project.find()
            .populate('employees', 'name email role')
            .sort({ createdAt: -1 })

        res.status(200).json({
            success: true,
            data: projects
        })
    } catch (error) {
        console.error('Get projects error:', error)

        res.status(500).json({
            success: false,
            message: 'Failed to fetch projects'
        })
    }
}


// Get Single Project
export const getProjectController = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params

        const project = await Project.findById(id)
            .populate('employees', 'name email role')

        if (!project) {
            res.status(404).json({
                success: false,
                message: 'Project not found'
            })
            return
        }

        res.status(200).json({
            success: true,
            data: project
        })
    } catch (error) {
        console.error('Get project error:', error)

        res.status(500).json({
            success: false,
            message: 'Failed to fetch project'
        })
    }
}


// Update Project
export const updateProjectController = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params

        const project = await Project.findByIdAndUpdate(
            id,
            req.body,
            {
                new: true,
                runValidators: true
            }
        ).populate('employees', 'name email role')

        if (!project) {
            res.status(404).json({
                success: false,
                message: 'Project not found'
            })
            return
        }

        res.status(200).json({
            success: true,
            message: 'Project updated successfully',
            data: project
        })
    } catch (error) {
        console.error('Update project error:', error)

        res.status(500).json({
            success: false,
            message: 'Failed to update project'
        })
    }
}


// Delete Project
export const deleteProjectController = async (
    req: Request,
    res: Response
): Promise<void> => {
    try {
        const { id } = req.params

        const project = await Project.findByIdAndDelete(id)

        if (!project) {
            res.status(404).json({
                success: false,
                message: 'Project not found'
            })
            return
        }

        res.status(200).json({
            success: true,
            message: 'Project deleted successfully'
        })
    } catch (error) {
        console.error('Delete project error:', error)

        res.status(500).json({
            success: false,
            message: 'Failed to delete project'
        })
    }
}