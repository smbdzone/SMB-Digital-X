'use client'

import React, { useEffect, useRef, useState } from 'react'
import { FiPenTool, FiX } from 'react-icons/fi'

import { processSignatureFile } from '@/lib/signatureClean'

/**
 * The owner's signature for ONE issue / bulk issue / resend.
 *
 * Kept only in React state (memory): never in localStorage, sessionStorage, IndexedDB, cookies or any cache.
 * The parent clears it after use, on cancel, and it disappears when the page is left (unmount).
 *
 * The picked file is processed in the browser first (lib/signatureClean.ts): background made transparent and
 * cropped to the ink. What is previewed, sent and printed is that processed PNG.
 */
export interface PickedSignature {
    /** base64 of the processed PNG, sent in the JSON body */
    base64: string
    /** object URL of the processed PNG for the preview; revoked when the signature is cleared */
    previewUrl: string
    name: string
    width: number
    height: number
}

export const SIGNATURE_MAX_BYTES = 1024 * 1024

const readAsBase64 = (file: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = String(reader.result ?? '')
            resolve(result.slice(result.indexOf(',') + 1))
        }
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(file)
    })

/** PNG or JPEG by the first bytes, like the server checks (the file name and type can lie). */
const looksLikeImage = async (file: File): Promise<boolean> => {
    const head = new Uint8Array(await file.slice(0, 8).arrayBuffer())
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => head[i] === b)
    const jpeg = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    return png || jpeg
}

interface SignaturePickerProps {
    value: PickedSignature | null
    onChange: (value: PickedSignature | null) => void
    disabled?: boolean
    /** Shown under the picker, e.g. why "Send email" must be on. */
    note?: React.ReactNode
}

const SignaturePicker = ({ value, onChange, disabled, note }: SignaturePickerProps) => {
    const inputRef = useRef<HTMLInputElement>(null)
    const [error, setError] = useState<string | null>(null)
    const [processing, setProcessing] = useState(false)

    // Free the preview URL when it is replaced, cleared, or the picker goes away.
    useEffect(() => () => { if (value?.previewUrl) URL.revokeObjectURL(value.previewUrl) }, [value?.previewUrl])

    const pick = async (file: File | undefined) => {
        if (inputRef.current) inputRef.current.value = ''   // the browser forgets the file; the same one can be picked again
        if (!file) return
        setError(null)
        if (file.size > SIGNATURE_MAX_BYTES) return setError('The image must be at most 1 MB.')
        if (!(await looksLikeImage(file))) return setError('Choose a PNG or JPG image.')
        setProcessing(true)
        try {
            // Background -> transparent, cropped to the ink. In memory only.
            const processed = await processSignatureFile(file)
            const base64 = await readAsBase64(processed.blob)
            onChange({ base64, previewUrl: URL.createObjectURL(processed.blob), name: file.name, width: processed.width, height: processed.height })
        } catch (e) {
            setError(e instanceof Error && e.message ? e.message : 'Could not read the file.')
        } finally {
            setProcessing(false)
        }
    }

    return (
        <div>
            <input
                ref={inputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={e => pick(e.target.files?.[0])}
                disabled={disabled}
            />

            {value ? (
                <div className="flex items-center gap-3 rounded-xl border border-charcoal/10 bg-surface p-3">
                    {/* Checkerboard behind the processed image: transparent parts show as checks, so what you see is what is printed. */}
                    <span
                        className="inline-flex h-16 w-44 shrink-0 items-center justify-center rounded border border-charcoal/10 p-1"
                        style={{ backgroundImage: 'repeating-conic-gradient(#e5e7eb 0% 25%, #ffffff 0% 50%)', backgroundSize: '12px 12px' }}
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={value.previewUrl} alt="Signature as it will be printed" className="max-h-full max-w-full object-contain" />
                    </span>
                    <span className="min-w-0 flex-1 text-xs text-charcoal/60">
                        <span className="block truncate">{value.name}</span>
                        <span className="block text-charcoal/45">Background removed and cropped. This is exactly what is printed.</span>
                    </span>
                    <button
                        type="button"
                        onClick={() => onChange(null)}
                        disabled={disabled}
                        className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                    >
                        <FiX className="size-3.5" /> Remove
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    onClick={() => inputRef.current?.click()}
                    disabled={disabled || processing}
                    className="inline-flex h-11 items-center gap-2 rounded-xl border border-dashed border-charcoal/20 bg-white px-4 text-sm font-semibold text-charcoal transition hover:border-blue-500/50 hover:bg-blue-50 disabled:opacity-50"
                >
                    <FiPenTool className="size-4" /> {processing ? 'Preparing signature...' : 'Choose signature image'}
                </button>
            )}

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
            <p className="mt-2 text-xs text-charcoal/50">
                PNG or JPG, max 1 MB. A photo on white paper works: the background is removed. Used once and never saved.
            </p>
            {note && <div className="mt-1 text-xs text-charcoal/50">{note}</div>}
        </div>
    )
}

export default SignaturePicker
