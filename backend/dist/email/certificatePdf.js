import PDFDocument from 'pdfkit';
/* ------------------------------------------------------------------ */
/* Helpers (same rules as salarySlipPdf.ts)                            */
/* ------------------------------------------------------------------ */
const safeColor = (color) => color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0136B0';
const formatDate = (date) => new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** Built-in PDF fonts only cover Latin-1; replace anything else so the PDF never shows garbage. */
const pdfText = (value) => String(value ?? '')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\u2022/g, '*')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');
/** Downloads the company logo. PDFKit supports PNG and JPEG only; anything else falls back to the company name. */
const fetchLogo = async (url) => {
    if (!url || !/^https?:\/\//i.test(url))
        return null;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok)
            return null;
        const buffer = Buffer.from(await response.arrayBuffer());
        const isPng = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
        return isPng || isJpg ? buffer : null;
    }
    catch {
        return null;
    }
};
export const certificateFileName = (referenceNo) => `${referenceNo.replace(/[^a-zA-Z0-9-]+/g, '-')}.pdf`;
/** Draws a big diagonal "REVOKED" stamp on the current page. */
const drawRevokedStamp = (doc) => {
    doc.save();
    doc.opacity(0.18);
    doc.translate(doc.page.width / 2, doc.page.height / 2).rotate(-30);
    doc.font('Helvetica-Bold').fontSize(90).fillColor('#dc2626')
        .text('REVOKED', -250, -45, { width: 500, align: 'center', lineBreak: false });
    doc.restore();
};
/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */
/** Renders the letter or certificate as a PDF and resolves with the file bytes. */
export const generateCertificatePdf = async (data) => {
    const color = safeColor(data.company.brandColor);
    const logo = await fetchLogo(data.company.logoUrl);
    const landscape = data.kind === 'certificate';
    const doc = new PDFDocument({
        size: 'A4',
        layout: landscape ? 'landscape' : 'portrait',
        margin: landscape ? 40 : 50,
        bufferPages: true,
        info: {
            Title: pdfText(data.title),
            Author: pdfText(data.company.name),
            Subject: pdfText(`${data.title} - ${data.employeeName}`),
        },
    });
    const chunks = [];
    const finished = new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    if (landscape)
        drawCertificate(doc, data, color, logo);
    else
        drawLetter(doc, data, color, logo);
    if (data.revoked) {
        const range = doc.bufferedPageRange();
        for (let i = range.start; i < range.start + range.count; i++) {
            doc.switchToPage(i);
            drawRevokedStamp(doc);
        }
    }
    doc.end();
    return finished;
};
/* ------------------------------------------------------------------ */
/* Letter layout (portrait)                                            */
/* ------------------------------------------------------------------ */
const drawLetter = (doc, data, color, logo) => {
    const { company } = data;
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const right = left + width;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 30;
    const ensureSpace = (height) => {
        if (doc.y + height > bottomLimit())
            doc.addPage();
    };
    /* ---------- Header ---------- */
    const headerTop = 34;
    let leftBlockBottom = headerTop;
    if (logo) {
        try {
            doc.image(logo, left, headerTop, { fit: [150, 55] });
            leftBlockBottom = headerTop + 55;
        }
        catch {
            doc.font('Helvetica-Bold').fontSize(18).fillColor(color).text(pdfText(company.name), left, headerTop, { width: 300 });
            leftBlockBottom = doc.y;
        }
    }
    else {
        doc.font('Helvetica-Bold').fontSize(18).fillColor(color).text(pdfText(company.name), left, headerTop, { width: 300 });
        leftBlockBottom = doc.y;
    }
    doc.font('Helvetica').fontSize(10).fillColor('#475569')
        .text(`Ref: ${pdfText(data.referenceNo)}`, left, headerTop + 2, { width, align: 'right' })
        .text(`Date: ${formatDate(data.issueDate)}`, left, headerTop + 16, { width, align: 'right' });
    const companyLines = [company.legalName || company.name, company.address, company.phone, company.website]
        .filter(Boolean)
        .map(pdfText);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b')
        .text(companyLines.join('   |   '), left, Math.max(leftBlockBottom, headerTop + 36) + 8, { width });
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor('#e2e8f0').stroke();
    doc.y += 28;
    /* ---------- Title ---------- */
    doc.font('Helvetica-Bold').fontSize(16).fillColor(color)
        .text(pdfText(data.title).toUpperCase(), left, doc.y, { width, align: 'center', characterSpacing: 0.5 });
    doc.y += 22;
    /* ---------- Body ---------- */
    const paragraphs = data.body.replace(/\r\n/g, '\n').split('\n');
    doc.font('Helvetica').fontSize(11).fillColor('#1e293b');
    for (const paragraph of paragraphs) {
        if (paragraph.trim() === '') {
            doc.y += 8;
            continue;
        }
        doc.font('Helvetica').fontSize(11).fillColor('#1e293b')
            .text(pdfText(paragraph), left, doc.y, { width, lineGap: 3, align: 'left' });
        doc.y += 2;
    }
    /* ---------- Signature ---------- */
    ensureSpace(110);
    doc.y += 30;
    const signTop = doc.y;
    const { signatory } = data;
    if (signatory.signature) {
        doc.font('Helvetica-Oblique').fontSize(18).fillColor('#0f172a').text(pdfText(signatory.signature), left, signTop, { width: 260 });
    }
    const lineY = signTop + 30;
    doc.moveTo(left, lineY).lineTo(left + 200, lineY).lineWidth(0.8).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(pdfText(signatory.name || company.name), left, lineY + 5, { width: 260 });
    if (signatory.title) {
        doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(pdfText(signatory.title), left, doc.y, { width: 260 });
    }
    doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(pdfText(company.name), left, doc.y, { width: 260 });
    /* ---------- Top bar + footer on every page ---------- */
    const footer = [company.footerNote, 'This is a system-generated document.'].filter(Boolean).map(pdfText).join('  ');
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        doc.rect(0, 0, doc.page.width, 8).fill(color);
        doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
            .text(footer, left, doc.page.height - doc.page.margins.bottom - 14, { width, align: 'center', lineBreak: false });
    }
};
/* ------------------------------------------------------------------ */
/* Certificate layout (landscape)                                      */
/* ------------------------------------------------------------------ */
const drawCertificate = (doc, data, color, logo) => {
    const { company, signatory } = data;
    const W = doc.page.width;
    const H = doc.page.height;
    /* ---------- Border ---------- */
    doc.lineWidth(5).strokeColor(color).rect(18, 18, W - 36, H - 36).stroke();
    doc.lineWidth(1).strokeColor(color).rect(28, 28, W - 56, H - 56).stroke();
    /* ---------- Logo / company name ---------- */
    let y = 52;
    if (logo) {
        try {
            doc.image(logo, (W - 160) / 2, y, { fit: [160, 60], align: 'center' });
        }
        catch {
            doc.font('Helvetica-Bold').fontSize(18).fillColor(color).text(pdfText(company.name), 0, y + 10, { width: W, align: 'center', lineBreak: false });
        }
    }
    else {
        doc.font('Helvetica-Bold').fontSize(18).fillColor(color).text(pdfText(company.name), 0, y + 10, { width: W, align: 'center', lineBreak: false });
    }
    y = 128;
    /* ---------- Title ---------- */
    const title = pdfText(data.title).toUpperCase();
    const titleSize = title.length <= 24 ? 32 : title.length <= 36 ? 26 : 20;
    doc.font('Helvetica-Bold').fontSize(titleSize).fillColor(color)
        .text(title, 70, y, { width: W - 140, align: 'center', characterSpacing: 1.5, lineBreak: false, ellipsis: true });
    y += titleSize + 16;
    doc.font('Helvetica').fontSize(12).fillColor('#64748b')
        .text('This is to certify that', 0, y, { width: W, align: 'center', lineBreak: false });
    y += 28;
    /* ---------- Recipient ---------- */
    const name = pdfText(data.employeeName);
    const nameSize = name.length <= 26 ? 36 : name.length <= 36 ? 28 : 22;
    doc.font('Times-BoldItalic').fontSize(nameSize).fillColor('#0f172a')
        .text(name, 70, y, { width: W - 140, align: 'center', lineBreak: false, ellipsis: true });
    y += nameSize + 6;
    doc.moveTo(W / 2 - 150, y).lineTo(W / 2 + 150, y).lineWidth(0.8).strokeColor('#94a3b8').stroke();
    y += 16;
    /* ---------- Body (kept inside a fixed box so the certificate always stays on one page) ---------- */
    const bodyBottom = H - 150;
    doc.font('Helvetica').fontSize(13).fillColor('#1e293b')
        .text(pdfText(data.body.replace(/\r\n/g, '\n')), 110, y, {
        width: W - 220,
        align: 'center',
        lineGap: 4,
        height: Math.max(40, bodyBottom - y),
        ellipsis: true,
    });
    /* ---------- Bottom row: date | reference | signature ---------- */
    const rowY = H - 118;
    // date
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
        .text(formatDate(data.issueDate), 70, rowY + 14, { width: 220, align: 'center', lineBreak: false });
    doc.moveTo(70, rowY + 10).lineTo(290, rowY + 10).lineWidth(0.8).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica').fontSize(9).fillColor('#64748b')
        .text('Date of issue', 70, rowY + 30, { width: 220, align: 'center', lineBreak: false });
    // signature
    const sigX = W - 290;
    if (signatory.signature) {
        doc.font('Helvetica-Oblique').fontSize(18).fillColor('#0f172a')
            .text(pdfText(signatory.signature), sigX, rowY - 24, { width: 220, align: 'center', lineBreak: false, ellipsis: true });
    }
    doc.moveTo(sigX, rowY + 10).lineTo(sigX + 220, rowY + 10).lineWidth(0.8).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a')
        .text(pdfText(signatory.name || company.name), sigX, rowY + 14, { width: 220, align: 'center', lineBreak: false, ellipsis: true });
    doc.font('Helvetica').fontSize(9).fillColor('#64748b')
        .text(pdfText(signatory.title || company.name), sigX, rowY + 30, { width: 220, align: 'center', lineBreak: false, ellipsis: true });
    // reference + footer note
    const footer = [`Ref: ${data.referenceNo}`, company.footerNote].filter(Boolean).map(pdfText).join('   |   ');
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
        .text(footer, 40, H - 62, { width: W - 80, align: 'center', lineBreak: false });
};
