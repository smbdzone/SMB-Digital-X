import { Request, Response } from 'express'
import { Types } from 'mongoose'
import Project from '../model/project.model.js'
import Task from '../model/task.model.js'
import { getAuth, isAdmin, isObjectId } from '../utils/http.js'

// What an employee may see of a project they work on: no budget, no team contact details.
const EMPLOYEE_PROJECT_FIELDS = 'name clientName description category startDate deadline status'

// What the admin sees: everything except the budget, which is set and shown only in the Owner Console (and, once
// locking has started, is a locked value only the console can read). "Locked: view in the Owner Console" instead.
const adminView = (project: any) => {
    if (!project) return project
    const { budget: _budget, ownerSeal: _seal, ...rest } = typeof project.toObject === 'function' ? project.toObject() : project
    return { ...rest, budgetLocked: true }
}

// The projects an employee may read: those they are a member of, or have at least one task in.
const employeeProjectFilter = async (employeeId: string) => {
    const id = new Types.ObjectId(employeeId)
    const withTasks = await Task.distinct('projectId', { assignedTo: id })
    return { $or: [{ employees: id }, { _id: { $in: withTasks } }] }
}

// The employee view: the safe fields plus `isMember` (members may file expenses on the project).
// The member list itself is not returned.
const employeeView = <T extends { employees?: unknown[] }>(project: T, employeeId: string) => {
    const { employees, ...rest } = project
    return { ...rest, isMember: (employees ?? []).some(e => String(e) === employeeId) }
}

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

        if (!name || !clientName || !startDate || !category) {
            res.status(400).json({
                success: false,
                message: 'name, clientName, startDate and category are required'
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
            budget: 0,   // set in the Owner Console (the guard refuses a budget here)
            status,
            employees: employees || []
        })

        res.status(201).json({
            success: true,
            message: 'Project created successfully',
            data: adminView(project)
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
        const auth = getAuth(req)
        const projects = isAdmin(auth)
            ? (await Project.find()
                .populate('employees', 'name email role')
                .sort({ createdAt: -1 })
                .lean()).map(adminView)
            : (await Project.find(await employeeProjectFilter(auth.id))
                .select(`${EMPLOYEE_PROJECT_FIELDS} employees`)
                .sort({ createdAt: -1 })
                .lean()).map(p => employeeView(p, auth.id))

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
        const auth = getAuth(req)

        if (!isObjectId(id)) {
            res.status(400).json({ success: false, message: 'Invalid project id' })
            return
        }
        // An employee gets the same 404 for a project they cannot read as for one that does not exist.
        let project
        if (isAdmin(auth)) {
            project = adminView(await Project.findById(id).populate('employees', 'name email role').lean())
        } else {
            const found = await Project.findOne({ $and: [{ _id: new Types.ObjectId(id) }, await employeeProjectFilter(auth.id)] })
                .select(`${EMPLOYEE_PROJECT_FIELDS} employees`)
                .lean()
            project = found ? employeeView(found, auth.id) : null
        }

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

        // Only the project's own fields; the budget is set in the Owner Console (the guard refuses a changed one).
        const ALLOWED = ['name', 'clientName', 'description', 'category', 'startDate', 'deadline', 'status', 'employees']
        const changes = Object.fromEntries(Object.entries(req.body ?? {}).filter(([k]) => ALLOWED.includes(k)))
        const project = await Project.findByIdAndUpdate(
            id,
            changes,
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
            data: adminView(project)
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