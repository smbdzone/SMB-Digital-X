'use client'

import React from 'react'

export interface SelectOption {
    value: string
    label: string
}

interface SelectFieldProps {
    label?: string
    name?: string
    value: string
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
    required?: boolean
    helperText?: string
    className?: string
    containerClassName?: string
}

const SelectField = ({
    label, name, value, onChange, options, placeholder, disabled, required,
    helperText, className = '', containerClassName = '',
}: SelectFieldProps) => (
    <div className={`w-full ${containerClassName}`}>
        {label && (
            <label className="mb-2 block text-sm font-medium text-charcoal">
                {label}
                {required && <span className="ml-1 text-red-500">*</span>}
            </label>
        )}
        <select
            name={name}
            value={value}
            onChange={onChange}
            disabled={disabled}
            className={`h-11 w-full rounded-xl border border-charcoal/10 bg-surface px-3 text-sm text-charcoal outline-none transition-all duration-200 hover:border-charcoal/20 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:bg-charcoal/[0.03] disabled:opacity-60 ${className}`}
        >
            {placeholder !== undefined && <option value="">{placeholder}</option>}
            {options.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
            ))}
        </select>
        {helperText && <p className="mt-1.5 text-xs text-charcoal/50">{helperText}</p>}
    </div>
)

export default SelectField
