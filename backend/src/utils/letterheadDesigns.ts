/**
 * The letterhead designs a company can use for its letters. Each company's design is fixed (set on the
 * company); only the content changes from letter to letter. Certificates always use the certificate layout.
 *
 * Which design a company uses: its stored choice (`company.letterhead`), else the design whose code
 * equals the company code (the original seed codes), else Plain.
 * The values are the folder names under backend/assets/letterheads/ ('plain' has no artwork).
 */
export const LETTERHEAD_DESIGNS = [
    { value: 'axis-aura', label: 'Axis Aura' },
    { value: 'smb-proptech', label: 'SMB Axis Proptech' },
    { value: 'smb-digitalzone', label: 'SMB DigitalZone' },
    { value: 'plain', label: 'Plain' },
] as const

export type LetterheadDesign = typeof LETTERHEAD_DESIGNS[number]['value']

export const LETTERHEAD_DESIGN_VALUES = LETTERHEAD_DESIGNS.map(d => d.value) as LetterheadDesign[]

export const isLetterheadDesign = (value: unknown): value is LetterheadDesign =>
    typeof value === 'string' && (LETTERHEAD_DESIGN_VALUES as string[]).includes(value)

/** Stored choice -> design with the same code as the company -> Plain. */
export const letterheadDesignFor = (company: { letterhead?: string | null; code?: string | null }): LetterheadDesign => {
    if (isLetterheadDesign(company.letterhead)) return company.letterhead
    const code = (company.code ?? '').toLowerCase()
    if (code !== 'plain' && isLetterheadDesign(code)) return code
    return 'plain'
}
