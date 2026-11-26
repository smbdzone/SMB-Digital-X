import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppError } from '../utils/http.js'

/*
 * Letterhead designs for letters (kind "letter").
 *
 * One entry per company code. Adding a company design = one entry here + its artwork in
 * backend/assets/letterheads/<code>/ (see backend/scripts/letterheads/build_assets.py). No new code.
 *
 * All positions are PDF points on an A4 page (595.28 x 841.89), measured from the approved design PDFs
 * with PyMuPDF (text bounding boxes). A text `y` is the top of its line box, which is what PDFKit expects.
 * Companies without an entry keep the plain layout in certificatePdf.ts.
 */

/** Asset root: backend/assets (this file lives in src/email or dist/email). */
export const ASSETS_DIR = fileURLToPath(new URL('../../assets/', import.meta.url))

export const FONT_FILES = {
    'Poppins-Regular': 'fonts/Poppins-Regular.ttf',
    'Poppins-SemiBold': 'fonts/Poppins-SemiBold.ttf',
    'Poppins-Bold': 'fonts/Poppins-Bold.ttf',
    'Arimo-Regular': 'fonts/Arimo-Regular.ttf',
    'Arimo-Bold': 'fonts/Arimo-Bold.ttf',
    'ArchivoBlack-Regular': 'fonts/ArchivoBlack-Regular.ttf',
    'Mulish-Regular': 'fonts/Mulish-Regular.ttf',
    'Mulish-Bold': 'fonts/Mulish-Bold.ttf',
} as const

export type FontName = keyof typeof FONT_FILES

export interface TextStyle {
    font: FontName
    size: number
    color: string
    characterSpacing?: number
    /** Soft drop shadow drawn as an offset copy (Proptech design). */
    shadow?: { dx: number; dy: number; color: string; opacity: number }
}

/** Something drawn behind the text of a page. Paths are relative to backend/assets/letterheads/<code>/. */
export type Art =
    | { type: 'fill'; color: string }
    | { type: 'image'; file: string; x: number; y: number; width: number; height: number; opacity?: number }
    | { type: 'shapes'; file: string; roles: ('band' | 'decoration')[] }

export interface PageFrame {
    art: Art[]
    /** Where the body may start on this page (continuation pages only; page 1 uses the header blocks). */
    top: number
    /** Lowest point for body text. */
    bodyBottom: number
    /** Lowest point for the closing + signature block. */
    blockBottom: number
}

export interface Letterhead {
    code: string
    first: PageFrame
    next: PageFrame

    /** centerX: the design's title centre (designs are not always centred on the page exactly). */
    title: { y: number; centerX: number; style: TextStyle; uppercase: boolean }

    date: {
        y: number
        style: TextStyle
        align: 'left' | 'right'
        x: number             // left edge (align left) or right edge (align right)
        format: 'MMM d, yyyy' | 'd MMM, yyyy' | 'MMMM d, yyyy'
        prefix?: string       // "Date: "
    }
    /** Small reference number line. `y` is absolute. */
    reference: { y: number; style: TextStyle; align: 'left' | 'right'; x: number }
    /** "To:" + recipient name. Omitted on designs without it. */
    recipient?: { label: string; labelY: number; labelStyle: TextStyle; nameY: number; nameStyle: TextStyle; x: number }
    /** Optional subject line; when there is no subject the body moves up to `y`. */
    subject: { y: number; style: TextStyle; prefix: string; bodyTop: number }

    body: {
        top: number           // body start when there is no subject
        left: number
        right: number
        style: TextStyle
        boldFont: FontName
        lineHeight: number
        blankLine: number     // height of an empty line between paragraphs
        align: 'left' | 'justify'
        /** Bold text equal to the company name gets this colour (designs highlight the company name). */
        companyNameColor?: string
        /** First line "Dear ...," / "To whom it may concern," in its own style. */
        salutation?: { style: TextStyle; lineHeight: number }
        bullet: { indent: number; radius: number; dx: number; dy: number; color: string }
    }

    closing: {
        gapBefore: number     // from the end of the body to the closing
        lines: { text: string; style: TextStyle; height: number }[]   // {{company}} = company name
    }

    signature: {
        align: 'left' | 'right'
        x: number             // left edge of the block (both alignments: the block is left-aligned text)
        width: number
        boxHeight: number     // space for the signature image above the name
        name: { style: TextStyle; height: number }
        title: { style: TextStyle; height: number }
        /** "Digitally signed by ..." line when the in-app copy has no image. */
        signedLine: TextStyle
    }

    /** Contact lines in the footer, from the company record. Empty fields are left out (no gaps). */
    contact?: {
        x: number             // right edge
        ys: number[]          // line positions, top to bottom
        style: TextStyle
        underlineWebsite?: boolean
    }
}

const PAGE_W = 595.28
const PAGE_H = 841.89

/* ------------------------------------------------------------------ */
/* Axis Aura Properties                                                */
/* ------------------------------------------------------------------ */

const axisAura: Letterhead = {
    code: 'axis-aura',
    first: {
        art: [
            { type: 'fill', color: '#f7fbff' },
            { type: 'image', file: 'watermark.png', x: 311.5, y: 474.2, width: 283.6, height: 241.6 },
            { type: 'image', file: 'header.png', x: 0, y: 0, width: PAGE_W, height: 142 },
            { type: 'image', file: 'footer.png', x: 0, y: 674, width: PAGE_W, height: PAGE_H - 674 },
        ],
        top: 0,
        bodyBottom: 668,
        blockBottom: 668,
    },
    // The design's page 2 is the plain background.
    next: { art: [{ type: 'fill', color: '#f7fbff' }], top: 60, bodyBottom: 780, blockBottom: 790 },

    title: { y: 183.2, centerX: 295.8, uppercase: true, style: { font: 'Arimo-Bold', size: 25, color: '#013049' } },
    date: { y: 234.8, x: 531.1, align: 'right', format: 'MMM d, yyyy', style: { font: 'Arimo-Regular', size: 12, color: '#3d414d' } },
    reference: { y: 251, x: 531.1, align: 'right', style: { font: 'Arimo-Regular', size: 8, color: '#7b8190' } },
    recipient: {
        label: 'To:', x: 59.5,
        labelY: 236.1, labelStyle: { font: 'Arimo-Bold', size: 13, color: '#3d414d' },
        nameY: 254.1, nameStyle: { font: 'Arimo-Bold', size: 13, color: '#3d414d' },
    },
    subject: { y: 285.5, prefix: 'Subject: ', bodyTop: 315.9, style: { font: 'Arimo-Bold', size: 12, color: '#3d414d' } },
    body: {
        top: 285.5, left: 59.5, right: 534.5,
        style: { font: 'Poppins-Regular', size: 10.8, color: '#222222' },
        boldFont: 'Poppins-Bold',
        lineHeight: 15,
        blankLine: 15.4,
        align: 'left',
        companyNameColor: '#619dd8',
        bullet: { indent: 18.7, radius: 1.9, dx: 7.9, dy: 7.6, color: '#222222' },
    },
    closing: {
        gapBefore: 15.4,
        lines: [
            { text: 'Best Regards,', height: 14.7, style: { font: 'Poppins-Bold', size: 10.8, color: '#000000' } },
            { text: 'Team {{company}}', height: 13.6, style: { font: 'Poppins-Regular', size: 9.7, color: '#222222' } },
        ],
    },
    signature: {
        align: 'left', x: 59.5, width: 220, boxHeight: 60.9,
        name: { height: 18.8, style: { font: 'Poppins-Bold', size: 15.1, color: '#000000', shadow: { dx: 0.3, dy: 0.3, color: '#000000', opacity: 0.4 } } },
        title: { height: 13.6, style: { font: 'Poppins-Regular', size: 9.7, color: '#222222' } },
        signedLine: { font: 'Poppins-Regular', size: 8.5, color: '#4b5563' },
    },
    contact: { x: 531.1, ys: [735.0, 751.5, 768.0], style: { font: 'Arimo-Regular', size: 12, color: '#ffffff' } },
}

/* ------------------------------------------------------------------ */
/* SMB Axis Proptech                                                   */
/* ------------------------------------------------------------------ */

const smbProptech: Letterhead = {
    code: 'smb-proptech',
    first: {
        art: [
            { type: 'fill', color: '#f6f7fc' },
            { type: 'image', file: 'watermark.png', x: 76.7, y: 200, width: 441.8, height: 441.8 },
            { type: 'image', file: 'header.png', x: 0, y: 0, width: PAGE_W, height: 193 },
            { type: 'image', file: 'footer.png', x: 0, y: 634, width: PAGE_W, height: PAGE_H - 634 },
        ],
        top: 0,
        bodyBottom: 640,
        blockBottom: 662,
    },
    // Continuation: same background, watermark and footer; a thin gradient strip instead of the logo header.
    next: {
        art: [
            { type: 'fill', color: '#f6f7fc' },
            { type: 'image', file: 'watermark.png', x: 76.7, y: 200, width: 441.8, height: 441.8 },
            { type: 'image', file: 'band.png', x: 0, y: 0, width: PAGE_W, height: 16 },
            { type: 'image', file: 'footer.png', x: 0, y: 634, width: PAGE_W, height: PAGE_H - 634 },
        ],
        top: 56,
        bodyBottom: 640,
        blockBottom: 662,
    },

    // Only the title keeps the design's drop shadow; on small text it read as doubled text.
    title: { y: 143.0, centerX: 296.8, uppercase: true, style: { font: 'ArchivoBlack-Regular', size: 24, color: '#000000', shadow: { dx: 1.2, dy: 1.6, color: '#000000', opacity: 0.25 } } },
    date: { y: 191.2, x: 59.5, align: 'left', format: 'd MMM, yyyy', style: { font: 'Poppins-SemiBold', size: 11.9, color: '#000000' } },
    // The design has the date on the left with the salutation right under it, so the reference sits on the date row, right-aligned.
    reference: { y: 194, x: 535.7, align: 'right', style: { font: 'Poppins-Regular', size: 8, color: '#6b7280' } },
    subject: { y: 208.3, prefix: 'Subject: ', bodyTop: 232.5, style: { font: 'Poppins-SemiBold', size: 11.9, color: '#000000' } },
    body: {
        top: 208.3, left: 59.5, right: 537.6,
        style: { font: 'Poppins-Regular', size: 10.8, color: '#222222' },
        boldFont: 'Poppins-Bold',
        lineHeight: 15,
        blankLine: 24,
        align: 'left',
        companyNameColor: '#3199e9',
        salutation: { lineHeight: 17.4, style: { font: 'Poppins-SemiBold', size: 12.5, color: '#000000' } },
        bullet: { indent: 18.7, radius: 1.9, dx: 7.9, dy: 7.6, color: '#222222' },
    },
    closing: {
        gapBefore: 24,
        lines: [
            { text: 'Best Regards,', height: 14, style: { font: 'Poppins-Bold', size: 10.8, color: '#000000' } },
            { text: 'Team {{company}}', height: 13.5, style: { font: 'Poppins-Regular', size: 9.7, color: '#222222' } },
        ],
    },
    signature: {
        align: 'left', x: 59.5, width: 220, boxHeight: 78.8,
        name: { height: 19.4, style: { font: 'Poppins-Bold', size: 15.1, color: '#000000' } },
        title: { height: 13.6, style: { font: 'Poppins-Regular', size: 9.7, color: '#222222' } },
        signedLine: { font: 'Poppins-Regular', size: 8.5, color: '#4b5563' },
    },
    contact: {
        x: 535.7, ys: [742.1, 755.6, 769.1], underlineWebsite: true,
        style: { font: 'Poppins-SemiBold', size: 10, color: '#fcf6f6', characterSpacing: 1 },
    },
}

/* ------------------------------------------------------------------ */
/* SMB DigitalZone                                                     */
/* ------------------------------------------------------------------ */

const smbDigitalZone: Letterhead = {
    code: 'smb-digitalzone',
    first: {
        art: [
            { type: 'fill', color: '#eaf1f1' },
            { type: 'image', file: 'watermark.png', x: 130.5, y: 303.4, width: 334.4, height: 335.0 },
            { type: 'shapes', file: 'shapes.json', roles: ['band', 'decoration'] },
            { type: 'image', file: 'logo.png', x: 191.2, y: -2.1, width: 203.4, height: 203.4 },
        ],
        top: 0,
        // The bottom-left corner starts at y 760 at the left margin (783 at x 80): keep body text well clear of it.
        bodyBottom: 700,
        blockBottom: 785,
    },
    // Continuation: background, watermark and the corner shapes, without the navy band and logo.
    next: {
        art: [
            { type: 'fill', color: '#eaf1f1' },
            { type: 'image', file: 'watermark.png', x: 130.5, y: 303.4, width: 334.4, height: 335.0 },
            { type: 'shapes', file: 'shapes.json', roles: ['decoration'] },
        ],
        top: 96,              // the top-right corner reaches y 80 at the right margin
        bodyBottom: 700,      // same clearance from the bottom-left corner as page 1
        blockBottom: 785,
    },

    title: { y: 162.9, centerX: 297.65, uppercase: true, style: { font: 'Mulish-Bold', size: 27, color: '#113e7a' } },
    date: { y: 225.7, x: 535.7, align: 'right', prefix: 'Date: ', format: 'MMMM d, yyyy', style: { font: 'Mulish-Regular', size: 11, color: '#0d2648' } },
    reference: { y: 241, x: 535.7, align: 'right', style: { font: 'Mulish-Regular', size: 8, color: '#5b6b80' } },
    recipient: {
        label: 'To:', x: 59.5,
        labelY: 226.1, labelStyle: { font: 'Mulish-Bold', size: 12, color: '#0d2648' },
        nameY: 242.6, nameStyle: { font: 'Mulish-Regular', size: 12, color: '#0d2648' },
    },
    subject: { y: 271.5, prefix: 'Subject: ', bodyTop: 298.6, style: { font: 'Mulish-Bold', size: 11, color: '#0d2648' } },
    body: {
        top: 271.5, left: 59.5, right: 538.6,
        style: { font: 'Mulish-Regular', size: 11, color: '#0d2648' },
        boldFont: 'Mulish-Bold',
        lineHeight: 15,
        blankLine: 15,
        align: 'justify',
        bullet: { indent: 18.7, radius: 1.9, dx: 7.9, dy: 7.0, color: '#0d2648' },
    },
    closing: {
        gapBefore: 27.3,
        lines: [{ text: 'Sincerely,', height: 15, style: { font: 'Mulish-Bold', size: 12, color: '#0d2648' } }],
    },
    signature: {
        align: 'right', x: 392.4, width: 146, boxHeight: 68.5,
        name: { height: 17.5, style: { font: 'Mulish-Bold', size: 12, color: '#0d2648' } },
        title: { height: 13.8, style: { font: 'Mulish-Regular', size: 11, color: '#0d2648' } },
        signedLine: { font: 'Mulish-Regular', size: 8.5, color: '#4b5563' },
    },
    // The SMB DigitalZone design has no contact lines.
}

const LETTERHEADS: Record<string, Letterhead> = {
    [axisAura.code]: axisAura,
    [smbProptech.code]: smbProptech,
    [smbDigitalZone.code]: smbDigitalZone,
}

export const getLetterhead = (companyCode?: string): Letterhead | undefined =>
    companyCode ? LETTERHEADS[companyCode.toLowerCase()] : undefined

export const letterheadAsset = (lh: Letterhead, file: string): string => join(ASSETS_DIR, 'letterheads', lh.code, file)
export const fontAsset = (font: FontName): string => join(ASSETS_DIR, FONT_FILES[font])

/** Every file a letterhead needs. */
export const letterheadFiles = (lh: Letterhead): string[] => {
    const files = new Set<string>()
    for (const frame of [lh.first, lh.next]) {
        for (const art of frame.art) if (art.type !== 'fill') files.add(letterheadAsset(lh, art.file))
    }
    for (const font of Object.keys(FONT_FILES) as FontName[]) files.add(fontAsset(font))
    return [...files]
}

/**
 * Fails with a clear message when the assets folder was not deployed with the backend.
 * (The build only compiles src/ to dist/; backend/assets/ has to be copied to the server too. See DEPLOY.md.)
 */
export const assertLetterheadAssets = (lh: Letterhead): void => {
    const missing = letterheadFiles(lh).filter(f => !existsSync(f))
    if (missing.length === 0) return
    const shown = missing.map(f => f.slice(f.indexOf('assets'))).slice(0, 5).join(', ')
    console.error(`Letterhead assets missing for "${lh.code}": ${missing.join(', ')}`)
    throw new AppError(500, `Letterhead files are missing on the server (${shown}${missing.length > 5 ? ', ...' : ''}). The backend/assets folder must be deployed with the backend.`)
}

/** Startup check: logs (does not crash) when any letterhead asset is missing. */
export const checkAllLetterheadAssets = (): void => {
    for (const lh of Object.values(LETTERHEADS)) {
        const missing = letterheadFiles(lh).filter(f => !existsSync(f))
        if (missing.length) console.error(`WARNING: letterhead assets missing for "${lh.code}" (letters for this company will fail): ${missing.join(', ')}`)
    }
}
