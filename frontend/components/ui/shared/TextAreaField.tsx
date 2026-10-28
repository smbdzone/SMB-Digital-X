import React from 'react'

interface TextAreaFieldProps {
    label: string
    name: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
    placeholder: string
    required?: boolean
    rows?: number
}

export const TextAreaField = ({ label, name, value, onChange, placeholder, required = false, rows = 4 }: TextAreaFieldProps) => (
    <div>
        <label className="mb-2 block text-sm font-medium text-charcoal">
            {label}
            {required && <span className="ml-1 text-red-500">*</span>}
        </label>
        <textarea
            name={name}
            value={value}
            onChange={onChange}
            rows={rows}
            placeholder={placeholder}
            className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm outline-none transition placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10"
        />
    </div>
)