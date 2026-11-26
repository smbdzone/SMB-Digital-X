'use client'

import React, { useEffect, useMemo, useRef, useState } from 'react'

import Input from '@/components/ui/Input'
import {
    AUTO_VARIABLES,
    brokenPlaceholderMessage,
    isAutoVariable,
    scanPlaceholders,
    splitPlaceholders,
} from '@/services/certificate.services'

interface WordingFieldsProps {
    title: string
    body: string
    onTitleChange: (value: string) => void
    onBodyChange: (value: string) => void
    /** Optional "Subject:" line (letters). Shown when onSubjectChange is given. */
    subject?: string
    onSubjectChange?: (value: string) => void
    disabled?: boolean
    /** Old-style placeholder names the stored text already used ({{CourseName}}); they stay valid. */
    legacy?: string[]
    /** Called when the text box loses focus (the issue form re-reads the placeholders then). */
    onBodyBlur?: () => void
    /** Issue form: point to the "Fill in the details" section. */
    showFillHint?: boolean
}

// The ones that are worth offering as buttons.
const CHIPS = AUTO_VARIABLES.filter(v => v !== 'employeeEmail' && v !== 'companyLegalName')

// The text box and the highlight layer behind it must lay text out identically.
const TEXT_LAYOUT = 'px-3 py-3 text-sm leading-6 whitespace-pre-wrap break-words [overflow-wrap:anywhere] [scrollbar-gutter:stable]'

/**
 * Title + body of a letter or certificate. Placeholders like {{employeeName}} are filled in
 * for every person when the document is issued.
 *
 * The body is a normal text box over a highlight layer: valid placeholders are shaded blue and
 * broken ones red, so typing, pasting and undo keep working as usual.
 */
const WordingFields = ({
    title, body, onTitleChange, onBodyChange, subject, onSubjectChange, disabled, legacy = [], onBodyBlur, showFillHint,
}: WordingFieldsProps) => {
    const bodyRef = useRef<HTMLTextAreaElement>(null)
    const layerRef = useRef<HTMLDivElement>(null)

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

    const parts = useMemo(() => splitPlaceholders(body, legacy), [body, legacy])

    // The note under the box waits until typing pauses, so it does not flash while a name is being typed.
    const [settled, setSettled] = useState({ title, subject: subject ?? '', body })
    useEffect(() => {
        const timer = setTimeout(() => setSettled({ title, subject: subject ?? '', body }), 700)
        return () => clearTimeout(timer)
    }, [title, subject, body])
    const scan = useMemo(
        () => scanPlaceholders([settled.title, onSubjectChange ? settled.subject : '', settled.body], legacy),
        [settled, legacy, onSubjectChange]
    )
    const custom = scan.names.filter(p => !isAutoVariable(p))

    const syncScroll = () => {
        if (layerRef.current && bodyRef.current) layerRef.current.scrollTop = bodyRef.current.scrollTop
    }
    useEffect(syncScroll, [body])

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

            {onSubjectChange && (
                <Input
                    label="Subject (optional)"
                    value={subject ?? ''}
                    handleChange={e => onSubjectChange(e.target.value)}
                    placeholder="Offer of Employment"
                    maxLength={200}
                    disabled={disabled}
                    helperText="Letters only. Printed as &quot;Subject: ...&quot; above the text. Leave empty for none."
                />
            )}

            <div>
                <label className="mb-2 block text-sm font-medium text-charcoal">
                    Text<span className="ml-1 text-red-500">*</span>
                </label>
                <div className="relative rounded-xl bg-surface">
                    {/* Highlight layer: same text, transparent, with shaded placeholders. Hidden from screen readers. */}
                    <div
                        ref={layerRef}
                        aria-hidden="true"
                        data-testid="placeholder-highlights"
                        className={`pointer-events-none absolute inset-0 overflow-hidden rounded-xl border border-transparent text-transparent ${TEXT_LAYOUT}`}
                    >
                        {parts.map((part, i) =>
                            part.kind === 'plain'
                                ? <React.Fragment key={i}>{part.text}</React.Fragment>
                                : (
                                    <mark
                                        key={i}
                                        data-placeholder={part.kind}
                                        className={`rounded text-transparent ${part.kind === 'valid' ? 'bg-blue-100' : 'bg-red-200'}`}
                                    >
                                        {part.text}
                                    </mark>
                                )
                        )}
                        {/* keeps a trailing new line the same height as in the text box */}
                        {'​'}
                    </div>
                    <textarea
                        ref={bodyRef}
                        value={body}
                        onChange={e => onBodyChange(e.target.value)}
                        onScroll={syncScroll}
                        onBlur={onBodyBlur}
                        rows={12}
                        maxLength={8000}
                        disabled={disabled}
                        placeholder="Dear {{employeeName}}, ..."
                        className={`relative block w-full resize-y rounded-xl border border-charcoal/10 bg-transparent outline-none transition placeholder:text-charcoal/35 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 disabled:opacity-60 ${TEXT_LAYOUT}`}
                    />
                </div>

                {scan.broken.length > 0 && (
                    <p role="alert" data-testid="broken-placeholders" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                        {brokenPlaceholderMessage(scan.broken)}
                    </p>
                )}

                {showFillHint && (
                    <p className="mt-2 text-xs text-charcoal/50">
                        Values go in &apos;Fill in the details&apos; below. Don&apos;t type inside {'{{…}}'}.
                    </p>
                )}
                <p className="mt-2 text-xs text-charcoal/50">
                    Write <span className="font-semibold">**bold**</span> for bold text, and start a line with &quot;- &quot; for a bullet.
                </p>
                <p className="mt-1 text-xs text-charcoal/50">
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
