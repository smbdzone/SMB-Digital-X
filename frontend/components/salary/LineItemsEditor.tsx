'use client';

import React from 'react';
import Input from '@/components/ui/Input';
import type { LineItem } from '@/services/salary.services';

interface LineItemsEditorProps {
    label: string;
    addLabel: string;
    namePlaceholder: string;
    items: LineItem[];
    onChange: (items: LineItem[]) => void;
}

const LineItemsEditor = ({ label, addLabel, namePlaceholder, items, onChange }: LineItemsEditorProps) => {
    const update = (index: number, patch: Partial<LineItem>) =>
        onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

    return (
        <div>
            <div className="mb-3 flex items-center justify-between">
                <label className="text-sm font-medium text-charcoal">{label}</label>
                <button
                    type="button"
                    onClick={() => onChange([...items, { name: '', amount: 0 }])}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                >
                    + {addLabel}
                </button>
            </div>
            {items.length === 0 ? (
                <p className="rounded-xl bg-charcoal/[0.03] px-4 py-3 text-xs text-charcoal/45">None added.</p>
            ) : (
                <div className="space-y-2">
                    {items.map((item, index) => (
                        <div key={index} className="grid grid-cols-[1fr_120px_36px] items-center gap-2">
                            <Input
                                value={item.name}
                                placeholder={namePlaceholder}
                                handleChange={e => update(index, { name: e.target.value })}
                            />
                            <Input
                                type="number"
                                min={0}
                                value={item.amount}
                                placeholder="Amount"
                                handleChange={e => update(index, { amount: Number(e.target.value) })}
                            />
                            <button
                                type="button"
                                onClick={() => onChange(items.filter((_, i) => i !== index))}
                                className="flex size-9 items-center justify-center rounded-lg text-red-500 transition hover:bg-red-50"
                                aria-label={`Remove ${label.toLowerCase()} row`}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default LineItemsEditor;
