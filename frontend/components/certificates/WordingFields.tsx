'use client'

import React, { useRef } from 'react'

import Input from '@/components/ui/Input'
import { AUTO_VARIABLES, findPlaceholders, isAutoVariable } from '@/services/certificate.services'

interface WordingFieldsProps {
    title: string
    body: string
    onTitleChange: (value: string) => void
    onBodyChange: (value: string) => void
    disabled?: boolean
}

// The ones that are worth offering as buttons.
const CHIPS = AUTO_VARIABLES.filter(v => v !== 'employeeEmail' && v !== 'companyLegalName')

/**
 * Title + body of a letter or certificate. Placeholders like {{employeeName}} are filled in
 * for every person when the document is issued.
 */
const WordingFields = ({ title, body, onTitleChange, onBodyChange, disabled }: WordingFieldsProps) => {
    const bodyRef = useRef<HTMLTextAreaElement>(null)

    const insert = (name: string) => {
        const tag = `{{${name}}}`
        const el = bodyRef.current

        if (!el) {
            onBodyChange(`${body}${tag}`)
            return
        }

        const start = el.selectionStart ?? body.length
        const end = el.selectionEnd ?? start
        onBodyChange(`${body.slice(0, start)}${tag}${body.slice(end)}`)

        requestAnimationFrame(() => {
            el.focus()
            el.setSelectionRange(start + tag.length, start + tag.length)
        })
    }

    const custom = findPlaceholders(title, body).filter(p => !isAutoVariable(p))

    return (
        <div className="space-y-4">
            <Input
                label="Title"
                required
                value={title}
                handleChange={e => onTitleChange(e.target.value)}
                placeholder="Letter of Joining"
                maxLength={200}
                disabled={disabled}
            />

            <div>
                <label className="mb-2 block text-sm font-medium text-charcoal">
                    Text<span className="ml-1 text-red-500">*</span>
                </label>
                <textarea
                    ref={bodyRef}
                    value={body}
                    onChange={e => onBodyChange(e.target.value)}
                    rows={12}
                    maxLength={8000}
                    disabled={disabled}
                    placeholder="Dear {{employeeName}}, ..."
                    className="w-full rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm leading-6 outline-none transition placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60"
                />

                <p className="mt-2 text-xs text-charcoal/50">
                    Click a name to add it at the cursor. It is replaced with the real value for each person.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {CHIPS.map(name => (
                        <button
                            key={name}
                            type="button"
                            onClick={() => insert(name)}
                            disabled={disabled}
                            className="rounded-lg border border-charcoal/10 bg-white px-2 py-1 text-xs font-medium text-charcoal/70 transition hover:border-blue-500/40 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
                        >
                            {`{{${name}}}`}
                        </button>
                    ))}
                </div>

                {custom.length > 0 && (
                    <p className="mt-2 text-xs text-charcoal/50">
                        Your own values: {custom.map(c => `{{${c}}}`).join(', ')}. You fill these in when issuing.
                    </p>
                )}
            </div>
        </div>
    )
}

export default WordingFields
