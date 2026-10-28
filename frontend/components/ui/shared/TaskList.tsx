import React from 'react'
import { FiCheckCircle, FiClock } from 'react-icons/fi'

interface Task { _id: string; title: string }

export const TaskList = ({ title, tasks, type }: { title: string; tasks: Task[]; type: 'completed' | 'progress' }) => (
    <div>
        <h4 className="mb-3 text-sm font-semibold">{title}</h4>
        {tasks?.length ? (
            <div className="space-y-2">
                {tasks.map(task => (
                    <div key={task._id} className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${type === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                        {type === 'completed' ? <FiCheckCircle className="size-4" /> : <FiClock className="size-4" />}
                        {task.title}
                    </div>
                ))}
            </div>
        ) : (
            <p className="text-sm text-charcoal/40">No {title.toLowerCase()}.</p>
        )}
    </div>
)