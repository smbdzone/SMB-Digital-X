import { readFileSync } from 'node:fs'
import {
    Art, FONT_FILES, FontName, Letterhead, PageFrame, TextStyle, fontAsset, letterheadAsset,
} from './letterheads.js'

/*
 * Draws a letter on a company letterhead (see letterheads.ts for the per-company layout).
 * Body markup: **bold** only. A line starting with "- " is a bullet.
 */

export interface LetterheadLetterData {
    title: string
    subject?: string
    body: string
    recipientName: string
    issueDate: Date
    referenceNo: string
    companyName: string            // as printed: legal name, else name
    contact: { phone?: string; email?: string; website?: string }
    signatory: { name?: string; title?: string }
    signature?: {
        image?: Buffer             // only for the emailed copy; never stored
        signedByName?: string      // in-app copies: "Digitally signed by <name> on <date>"
        signedAt?: Date
    }
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

export const formatLetterDate = (date: Date, format: Letterhead['date']['format']): string => {
    const d = new Date(date)
    const day = d.getUTCDate()
    const month = MONTHS[d.getUTCMonth()]
    const year = d.getUTCFullYear()
    if (format === 'd MMM, yyyy') return `${day} ${month.slice(0, 3)}, ${year}`
    if (format === 'MMMM d, yyyy') return `${month} ${day}, ${year}`
    return `${month.slice(0, 3)} ${day}, ${year}`
}

/** Text as typed, without control characters (the embedded fonts cover Unicode). */
const clean = (value: unknown): string => String(value ?? '').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')

const displayWebsite = (url?: string): string => clean(url).trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')

const shapesCache = new Map<string, ShapeData[]>()

interface ShapeData {
    role: 'band' | 'decoration'
    fill: string
    opacity: number
    evenOdd: boolean
    ops: (string | number)[][]
}

const loadShapes = (path: string): ShapeData[] => {
    let shapes = shapesCache.get(path)
    if (!shapes) {
        shapes = JSON.parse(readFileSync(path, 'utf8')) as ShapeData[]
        shapesCache.set(path, shapes)
    }
    return shapes
}

/* ------------------------------------------------------------------ */
/* Drawing primitives                                                  */
/* ------------------------------------------------------------------ */

const useStyle = (doc: PDFKit.PDFDocument, style: TextStyle) => doc.font(style.font).fontSize(style.size)

const widthOf = (doc: PDFKit.PDFDocument, text: string, style: TextStyle): number =>
    useStyle(doc, style).widthOfString(text, { characterSpacing: style.characterSpacing ?? 0 })

/** One line of text at (x, y) = top-left of the line box. No wrapping. */
const drawText = (doc: PDFKit.PDFDocument, text: string, x: number, y: number, style: TextStyle) => {
    const options = { lineBreak: false, characterSpacing: style.characterSpacing ?? 0 }
    if (style.shadow) {
        doc.save()
        useStyle(doc, style).fillColor(style.shadow.color).fillOpacity(style.shadow.opacity)
            .text(text, x + style.shadow.dx, y + style.shadow.dy, options)
        doc.restore()
    }
    useStyle(doc, style).fillColor(style.color).fillOpacity(1).text(text, x, y, options)
}

const drawAligned = (doc: PDFKit.PDFDocument, text: string, x: number, y: number, align: 'left' | 'right', style: TextStyle) =>
    drawText(doc, text, align === 'right' ? x - widthOf(doc, text, style) : x, y, style)

const drawArt = (doc: PDFKit.PDFDocument, lh: Letterhead, art: Art[]) => {
    for (const item of art) {
        if (item.type === 'fill') {
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(item.color)
        } else if (item.type === 'image') {
            doc.save()
            if (item.opacity !== undefined) doc.opacity(item.opacity)
            doc.image(letterheadAsset(lh, item.file), item.x, item.y, { width: item.width, height: item.height })
            doc.restore()
        } else {
            for (const shape of loadShapes(letterheadAsset(lh, item.file))) {
                if (!item.roles.includes(shape.role)) continue
                doc.save()
                for (const op of shape.ops) {
                    const [kind, ...n] = op as [string, ...number[]]
                    if (kind === 'M') doc.moveTo(n[0], n[1])
                    else if (kind === 'L') doc.lineTo(n[0], n[1])
                    else if (kind === 'C') doc.bezierCurveTo(n[0], n[1], n[2], n[3], n[4], n[5])
                    else if (kind === 'R') doc.rect(n[0], n[1], n[2], n[3])
                    else if (kind === 'Z') doc.closePath()
                }
                doc.fillOpacity(shape.opacity).fill(shape.fill, shape.evenOdd ? 'even-odd' : 'non-zero')
                doc.restore()
            }
        }
    }
}

/* ------------------------------------------------------------------ */
/* Body text: **bold** runs, bullets, salutation, wrapping, justify    */
/* ------------------------------------------------------------------ */

interface Word { text: string; style: TextStyle; width: number; spaceBefore: number }

const SALUTATION = /^(dear\b.*|to whom it may concern)[,:]?$/i
const BULLET = /^\s*[-•]\s+/

/** "**bold**" -> runs. An unmatched "**" stays as typed. */
const parseRuns = (line: string): { text: string; bold: boolean }[] => {
    const runs: { text: string; bold: boolean }[] = []
    const re = /\*\*(.+?)\*\*/g
    let last = 0
    for (const m of line.matchAll(re)) {
        if (m.index! > last) runs.push({ text: line.slice(last, m.index), bold: false })
        runs.push({ text: m[1], bold: true })
        last = m.index! + m[0].length
    }
    if (last < line.length) runs.push({ text: line.slice(last), bold: false })
    return runs
}

const toWords = (
    doc: PDFKit.PDFDocument, line: string, base: TextStyle, lh: Letterhead, companyName: string,
): Word[] => {
    const words: Word[] = []
    let pendingSpace = false
    const company = companyName.trim().toLowerCase()
    for (const run of parseRuns(line)) {
        let style = base
        if (run.bold) {
            const accent = lh.body.companyNameColor && run.text.trim().toLowerCase() === company
            style = { ...base, font: lh.body.boldFont, color: accent ? lh.body.companyNameColor! : base.color }
            // the salutation style already has its own weight; keep it
            if (base !== lh.body.style) style = { ...style, font: base.font }
        }
        for (const part of run.text.split(/(\s+)/)) {
            if (part === '') continue
            if (/^\s+$/.test(part)) { pendingSpace = true; continue }
            // A word glued to the previous run (e.g. "**26th**,") continues without a space: spaceBefore -1.
            const glue = !pendingSpace && words.length > 0
            const spaceBefore = glue ? -1 : words.length ? widthOf(doc, ' ', base) : 0
            words.push({ text: part, style, width: widthOf(doc, part, style), spaceBefore })
            pendingSpace = false
        }
    }
    return words
}

/** Greedy line breaking. Words glued to the previous one (spaceBefore -1) never start a line. */
const breakLines = (words: Word[], maxWidth: number): Word[][] => {
    const lines: Word[][] = []
    let line: Word[] = []
    let width = 0
    // group glued words so they move to the next line together
    const groups: Word[][] = []
    for (const w of words) {
        if (w.spaceBefore === -1 && groups.length) groups[groups.length - 1].push(w)
        else groups.push([w])
    }
    for (const group of groups) {
        const groupWidth = group.reduce((s, w) => s + w.width, 0)
        const space = line.length ? group[0].spaceBefore : 0
        if (line.length && width + space + groupWidth > maxWidth) {
            lines.push(line)
            line = []
            width = 0
        }
        const lead = line.length ? group[0].spaceBefore : 0
        line.push(...group.map((w, i) => (i === 0 ? { ...w, spaceBefore: lead } : { ...w, spaceBefore: 0 })))
        width += lead + groupWidth
    }
    if (line.length) lines.push(line)
    return lines
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export const drawLetterheadLetter = (doc: PDFKit.PDFDocument, lh: Letterhead, data: LetterheadLetterData) => {
    for (const font of Object.keys(FONT_FILES) as FontName[]) doc.registerFont(font, fontAsset(font))

    let frame: PageFrame = lh.first
    const contactLines = [data.contact.phone, data.contact.email, displayWebsite(data.contact.website)]
        .map(v => clean(v).trim())

    const decorate = (f: PageFrame, first: boolean) => {
        drawArt(doc, lh, f.art)
        // Contact lines go wherever the footer band is drawn.
        const hasFooter = f.art.some(a => a.type === 'image' && a.file === 'footer.png')
        if (lh.contact && (first || hasFooter)) {
            const c = lh.contact
            const present = contactLines.map((text, i) => ({ text, website: i === 2 })).filter(l => l.text)
            present.forEach((l, i) => {
                const y = c.ys[i]
                drawAligned(doc, l.text, c.x, y, 'right', c.style)
                if (l.website && c.underlineWebsite) {
                    const w = widthOf(doc, l.text, c.style)
                    const underlineY = y + c.style.size * 1.15
                    doc.save().rect(c.x - w, underlineY, w - (c.style.characterSpacing ?? 0), 0.7).fill(c.style.color).restore()
                }
            })
        }
    }

    const newPage = (): number => {
        doc.addPage({ size: 'A4', margin: 0 })
        frame = lh.next
        decorate(frame, false)
        return frame.top
    }

    decorate(frame, true)

    /* ---------- Title, date, reference, recipient, subject ---------- */
    const title = clean(data.title).trim()
    const titleText = lh.title.uppercase ? title.toUpperCase() : title
    // A long title shrinks to fit the width between the margins.
    let titleStyle = lh.title.style
    const maxTitle = lh.body.right - lh.body.left
    while (widthOf(doc, titleText, titleStyle) > maxTitle && titleStyle.size > 12) titleStyle = { ...titleStyle, size: titleStyle.size - 1 }
    drawText(doc, titleText, lh.title.centerX - widthOf(doc, titleText, titleStyle) / 2, lh.title.y, titleStyle)

    drawAligned(doc, `${lh.date.prefix ?? ''}${formatLetterDate(data.issueDate, lh.date.format)}`, lh.date.x, lh.date.y, lh.date.align, lh.date.style)
    drawAligned(doc, `Ref: ${clean(data.referenceNo)}`, lh.reference.x, lh.reference.y, lh.reference.align, lh.reference.style)

    if (lh.recipient) {
        const r = lh.recipient
        drawText(doc, r.label, r.x, r.labelY, r.labelStyle)
        drawText(doc, clean(data.recipientName), r.x, r.nameY, r.nameStyle)
    }

    const subject = clean(data.subject).trim()
    if (subject) drawText(doc, `${lh.subject.prefix}${subject}`, lh.body.left, lh.subject.y, lh.subject.style)

    /* ---------- Body ---------- */
    let y = subject ? lh.subject.bodyTop : lh.body.top
    const b = lh.body
    const lines = clean(data.body).replace(/\r\n?/g, '\n').split('\n')
    let firstText = true

    for (const raw of lines) {
        if (raw.trim() === '') {
            y += b.blankLine
            continue
        }

        const isSalutation = firstText && !!b.salutation && SALUTATION.test(raw.trim())
        firstText = false
        const bullet = BULLET.test(raw)
        const text = bullet ? raw.replace(BULLET, '') : raw.trim()
        const style = isSalutation ? b.salutation!.style : b.style
        const lineHeight = isSalutation ? b.salutation!.lineHeight : b.lineHeight
        const left = b.left + (bullet ? b.bullet.indent : 0)
        const maxWidth = b.right - left

        const wrapped = breakLines(toWords(doc, text, style, lh, data.companyName), maxWidth)
        wrapped.forEach((words, index) => {
            if (y + lineHeight > frame.bodyBottom) y = newPage()

            if (bullet && index === 0) {
                doc.save().circle(b.left + b.bullet.dx, y + b.bullet.dy, b.bullet.radius).fill(b.bullet.color).restore()
            }

            const lastLine = index === wrapped.length - 1
            const natural = words.reduce((s, w) => s + w.spaceBefore + w.width, 0)
            const gaps = words.filter((w, i) => i > 0 && w.spaceBefore > 0).length
            const extra = b.align === 'justify' && !lastLine && !bullet && gaps > 0 ? (maxWidth - natural) / gaps : 0

            let x = left
            words.forEach((w, i) => {
                if (i > 0) x += w.spaceBefore + (w.spaceBefore > 0 ? extra : 0)
                drawText(doc, w.text, x, y, w.style)
                x += w.width
            })
            y += lineHeight
        })
    }

    /* ---------- Closing + signature: one block, never split across pages ---------- */
    const s = lh.signature
    const signatoryName = clean(data.signatory.name).trim() || data.companyName
    const signatoryTitle = clean(data.signatory.title).trim()
    const closingHeight = lh.closing.lines.reduce((sum, l) => sum + l.height, 0)
    const blockHeight = lh.closing.gapBefore + closingHeight + s.boxHeight + s.name.height + (signatoryTitle ? s.title.height : 0)

    if (y + blockHeight > frame.blockBottom) {
        y = newPage()
    } else {
        y += lh.closing.gapBefore
    }

    for (const line of lh.closing.lines) {
        drawText(doc, line.text.replace('{{company}}', data.companyName), s.x, y, line.style)
        y += line.height
    }

    const boxTop = y
    const sig = data.signature
    if (sig?.image) {
        doc.image(sig.image, s.x, boxTop + 2, { fit: [s.width, s.boxHeight - 4], valign: 'bottom' })
    } else if (sig?.signedAt && sig.signedByName) {
        const line = `Digitally signed by ${clean(sig.signedByName)} on ${formatLetterDate(sig.signedAt, 'MMMM d, yyyy')}`
        useStyle(doc, s.signedLine)
        const height = doc.heightOfString(line, { width: s.width })
        doc.fillColor(s.signedLine.color).fillOpacity(1)
            .text(line, s.x, boxTop + s.boxHeight - height - 6, { width: s.width, align: 'left' })
    }
    y = boxTop + s.boxHeight

    drawText(doc, signatoryName, s.x, y, s.name.style)
    y += s.name.height
    if (signatoryTitle) drawText(doc, signatoryTitle, s.x, y, s.title.style)
}
