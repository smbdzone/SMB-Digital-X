'use client';

import React, { useState } from 'react';
import Input from '../ui/Input';
import ButtonEmerald from '../ui/ButtonEmerald';
import { FiArrowLeft, FiCheck } from 'react-icons/fi';
import { useAuth } from '@/context/AuthContext';

interface Employee {
    _id: string;
    name: string;
    email: string;
}

interface Props {
    type: 'individual' | 'group';
    employees: Employee[];
    currentUserId?: string;
    loading?: boolean;
    onBack: () => void;
    onSubmit: (ids: string[], type: 'individual' | 'group', name?: string) => void;
}

const ConversationForm = ({
    type,
    employees,
    currentUserId,
    loading,
    onBack,
    onSubmit,
}: Props) => {
    const [groupName, setGroupName] = useState('');
    const [selected, setSelected] = useState<string[]>([]);

    const toggleEmployee = (id: string) => {
        if (type === 'individual') {
            setSelected([id]);
            return;
        }
        setSelected((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
    };

    const handleSubmit = () => {
        if (!selected.length) return;
        if (type === 'group' && !groupName.trim()) return;
        onSubmit(selected, type, type === 'group' ? groupName : undefined);
    };

    return (
        <div className="space-y-5">
            <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-2 text-sm font-medium text-charcoal/60 hover:text-charcoal"
            >
                <FiArrowLeft />
                Back
            </button>

            {type === 'group' && (
                <Input
                    label="Group Name"
                    value={groupName}
                    handleChange={(e) => setGroupName(e.target.value)}
                    placeholder="Enter group name"
                />
            )}

            <div>
                <p className="mb-3 text-sm font-semibold">
                    {type === 'group' ? 'Select Employees' : 'Select Employee'}
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto">
                    {employees
                        .filter((employee) => employee._id !== currentUserId)
                        .map((employee) => {
                            const active = selected.includes(employee._id);
                            return (
                                <button
                                    type="button"
                                    key={employee._id}
                                    onClick={() => toggleEmployee(employee._id)}
                                    className={`flex w-full items-center justify-between rounded-xl border p-3 text-left transition ${active
                                            ? 'border-blue-400 bg-blue-50'
                                            : 'border-charcoal/10 hover:bg-charcoal/[0.02]'
                                        }`}
                                >
                                    <div>
                                        <p className="text-sm font-semibold">{employee.name}</p>
                                        <p className="mt-0.5 text-xs text-charcoal/40">{employee.email}</p>
                                    </div>
                                    {active && (
                                        <div className="flex size-7 items-center justify-center rounded-full bg-blue-500 text-white">
                                            <FiCheck />
                                        </div>
                                    )}
                                </button>
                            );
                        })}
                </div>
            </div>

            <div className="flex justify-end border-t border-charcoal/5 pt-4">
                <ButtonEmerald
                    disabled={
                        loading ||
                        !selected.length ||
                        (type === 'group' && !groupName.trim())
                    }
                    onClick={handleSubmit}
                >
                    {type === 'group' ? 'Create Group' : 'Start Conversation'}
                </ButtonEmerald>
            </div>
        </div>
    );
};

export default ConversationForm;