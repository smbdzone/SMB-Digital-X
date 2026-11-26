import PDFDocument from 'pdfkit';
import { SalarySlipData, formatMonthLabel } from './emailTemplate.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const safeColor = (color?: string): string =>
    color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0136B0';

const formatAmount = (amount: number): string =>
    amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDate = (date?: Date): string =>
    date
        ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
        : '';

const maskTail = (value?: string): string => {
    if (!value) return '';
    const clean = value.replace(/\s/g, '');
    return clean.length <= 4 ? clean : `**** ${clean.slice(-4)}`;
};

/** Built-in PDF fonts only cover Latin-1; replace anything else so the PDF never shows garbage. */
const pdfText = (value: unknown): string =>
    String(value ?? '')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u2022/g, '*')
        .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '?');

/** Downloads the company logo. PDFKit supports PNG and JPEG only; anything else falls back to the company name. */
const fetchLogo = async (url?: string): Promise<Buffer | null> => {
    if (!url || !/^https?:\/\//i.test(url)) return null;
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);
        if (!response.ok) return null;

        const buffer = Buffer.from(await response.arrayBuffer());
        const isPng = buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        const isJpg = buffer[0] === 0xff && buffer[1] === 0xd8;
        return isPng || isJpg ? buffer : null;
    } catch {
        return null;
    }
};

export const slipFileName = (employeeName: string, month: string): string => {
    const clean = employeeName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Employee';
    return `Salary-Slip-${clean}-${month}.pdf`;
};

/** Cuts text so it fits on one line of `width` points in the current font, adding "..." if needed. */
const fitText = (doc: PDFKit.PDFDocument, text: string, width: number): string => {
    if (doc.widthOfString(text) <= width) return text;
    let cut = text;
    while (cut.length > 1 && doc.widthOfString(`${cut}...`) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}...`;
};

/* ------------------------------------------------------------------ */
/* Amount in words                                                     */
/* ------------------------------------------------------------------ */

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', 'Thousand', 'Million', 'Billion', 'Trillion'];

const under1000 = (n: number): string => {
    const parts: string[] = [];
    if (n >= 100) { parts.push(`${ONES[Math.floor(n / 100)]} Hundred`); n %= 100; }
    if (n >= 20) parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ''));
    else if (n > 0) parts.push(ONES[n]);
    return parts.join(' ');
};

const integerToWords = (n: number): string => {
    if (n === 0) return 'Zero';
    const parts: string[] = [];
    for (let i = 0; n > 0 && i < SCALES.length; i++) {
        const chunk = n % 1000;
        if (chunk) parts.unshift(`${under1000(chunk)}${SCALES[i] ? ` ${SCALES[i]}` : ''}`);
        n = Math.floor(n / 1000);
    }
    return parts.join(' ');
};

// [major unit, minor unit]
const CURRENCY_WORDS: Record<string, [string, string]> = {
    AED: ['UAE Dirhams', 'Fils'],
    PKR: ['Pakistani Rupees', 'Paisa'],
    USD: ['US Dollars', 'Cents'],
    EUR: ['Euros', 'Cents'],
    GBP: ['Pounds Sterling', 'Pence'],
    SAR: ['Saudi Riyals', 'Halalas'],
    INR: ['Indian Rupees', 'Paise'],
};

/**
 * 5250.5, "AED" -> "UAE Dirhams Five Thousand Two Hundred Fifty and Fifty Fils Only".
 * Unknown currencies fall back to the code and "nn/100": "QAR One Hundred and 25/100 Only".
 */
export const amountInWords = (amount: number, currency: string): string => {
    const code = currency.toUpperCase();
    const totalMinor = Math.round(Math.abs(amount) * 100);
    const whole = Math.floor(totalMinor / 100);
    const minor = totalMinor % 100;
    const known = CURRENCY_WORDS[code];

    if (!known) {
        return `${code} ${integerToWords(whole)}${minor ? ` and ${String(minor).padStart(2, '0')}/100` : ''} Only`;
    }
    const [major, minorName] = known;
    return `${major} ${integerToWords(whole)}${minor ? ` and ${integerToWords(minor)} ${minorName}` : ''} Only`;
};

/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */

const INK = '#111827';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const ROW_RULE = '#e5e7eb';
const SHADE = '#f3f4f6';

/**
 * Renders the salary slip as an A4 PDF in a conventional payslip layout:
 * letterhead, payslip title and number, employee details grid, earnings and
 * deductions side by side, net pay with the amount in words, signature lines
 * and a confidentiality footer. Unpaid records get a DRAFT watermark.
 * The same function produces the emailed attachment and the in-app PDF.
 */
export const generateSalarySlipPdf = async (data: SalarySlipData): Promise<Buffer> => {
    const {
        company, employeeName, role, month, currency, salary,
        allowances = [], deductions = [], totalAllowances, totalDeductions,
        grossAmount, netPay, payment, paidOn, approvedBy, approvedByTitle, signature,
        employeeEmail, employeeCode, slipNo, draft,
    } = data;

    const color = safeColor(company.brandColor);
    const logo = await fetchLogo(company.logoUrl);
    const monthLabel = formatMonthLabel(month);

    const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 40, bottom: 56, left: 48, right: 48 },   // bottom leaves room for the footer
        bufferPages: true,                                          // footer + watermark are added to every page at the end
        info: {
            Title: `Payslip - ${pdfText(employeeName)} - ${monthLabel}`,
            Author: pdfText(company.legalName || company.name),
            Subject: `Payslip for ${monthLabel}`,
        },
    });

    const chunks: Buffer[] = [];
    const finished = new Promise<Buffer>((resolve, reject) => {
        doc.on('data', (chunk: Buffer) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const right = left + width;
    const half = width / 2;
    const contentBottom = () => doc.page.height - doc.page.margins.bottom;

    const hline = (y: number, x1 = left, x2 = right, lw = 0.5, c = RULE) =>
        doc.moveTo(x1, y).lineTo(x2, y).lineWidth(lw).strokeColor(c).stroke();
    const vline = (x: number, y1: number, y2: number, lw = 0.75, c = RULE) =>
        doc.moveTo(x, y1).lineTo(x, y2).lineWidth(lw).strokeColor(c).stroke();

    let y = doc.page.margins.top;
    /** Starts a new page when `height` more points would run into the footer area. Returns true if it did. */
    const ensure = (height: number): boolean => {
        if (y + height <= contentBottom()) return false;
        doc.addPage();
        y = doc.page.margins.top;
        return true;
    };

    /* ---------- Letterhead ---------- */
    doc.rect(0, 0, doc.page.width, 6).fill(color);
    y = 30;
    let logoBottom = y;
    if (logo) {
        try {
            doc.image(logo, left, y, { fit: [140, 52] });
            logoBottom = y + 52;
        } catch { /* unreadable image: fall back to the name below */ }
    }
    if (logoBottom === y) {
        doc.font('Helvetica-Bold').fontSize(16).fillColor(color).text(pdfText(company.name), left, y, { width: half - 10 });
        logoBottom = doc.y;
    }

    const infoX = left + half;
    doc.font('Helvetica-Bold').fontSize(12).fillColor(INK)
        .text(pdfText(company.legalName || company.name), infoX, y, { width: half, align: 'right' });
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED);
    [company.address, company.phone && `Tel: ${company.phone}`, company.website]
        .filter(Boolean)
        .forEach(line => doc.text(pdfText(line), infoX, doc.y + 1, { width: half, align: 'right' }));

    y = Math.max(logoBottom, doc.y) + 12;
    hline(y, left, right, 1.5, color);
    y += 14;

    /* ---------- Title + payslip number ---------- */
    const titleTop = y;
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK)
        .text('PAYSLIP', left, titleTop, { width, align: 'center', characterSpacing: 2 });
    doc.font('Helvetica').fontSize(10).fillColor(MUTED)
        .text(`For the month of ${monthLabel}`, left, doc.y + 2, { width, align: 'center' });
    const titleBottom = doc.y;   // measured BEFORE the payslip number, which sits beside the title
    if (slipNo) {
        doc.font('Helvetica').fontSize(8).fillColor(MUTED)
            .text(`Payslip No: ${pdfText(slipNo)}`, left, titleTop + 4, { width, align: 'right' });
    }
    y = titleBottom + 14;

    /* ---------- Employee details grid (2 columns, label | value) ---------- */
    const details: [string, string][] = [
        ['Employee Name', employeeName],
        ['Employee ID', employeeCode || '-'],
        ['Designation', role || '-'],
        ['Pay Period', monthLabel],
        ['Email', employeeEmail || '-'],
        ['Pay Date', draft ? 'Not yet paid' : formatDate(paidOn) || '-'],
        ['Payment Mode', payment?.method || '-'],
        ['Bank', payment?.bankName || '-'],
        ['Account No.', maskTail(payment?.accountNumber) || '-'],
        ['IBAN', maskTail(payment?.iban) || '-'],
    ];
    const rowH = 20;
    const labelW = 88;
    const gridRows = Math.ceil(details.length / 2);
    const gridTop = y;

    details.forEach(([label, value], i) => {
        const x = left + (i % 2) * half;
        const ry = gridTop + Math.floor(i / 2) * rowH;
        doc.rect(x, ry, labelW, rowH).fill(SHADE);
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED)
            .text(label, x + 8, ry + 6.5, { lineBreak: false });
        doc.font('Helvetica').fontSize(9.5).fillColor(INK);
        doc.text(fitText(doc, pdfText(value), half - labelW - 16), x + labelW + 8, ry + 6, { lineBreak: false });
    });
    for (let r = 1; r < gridRows; r++) hline(gridTop + r * rowH);
    const gridBottom = gridTop + gridRows * rowH;
    doc.rect(left, gridTop, width, gridBottom - gridTop).lineWidth(0.75).strokeColor(RULE).stroke();
    vline(left + half, gridTop, gridBottom);
    vline(left + labelW, gridTop, gridBottom, 0.5);
    vline(left + half + labelW, gridTop, gridBottom, 0.5);
    y = gridBottom + 18;

    /* ---------- Earnings | Deductions ---------- */
    const earnings: [string, number][] = [['Basic Salary', salary], ...allowances.map(a => [a.name, a.amount] as [string, number])];
    const deducts: [string, number][] = deductions.map(d => [d.name, d.amount]);
    const lineCount = Math.max(earnings.length, deducts.length, 3);   // at least 3 rows so the table never looks empty
    const amtW = 92;
    const headH = 22;
    const lineH = 19;
    const totalH = 21;

    const tableHeader = (continued: boolean) => {
        doc.rect(left, y, width, headH).fill(color);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#ffffff');
        doc.text(continued ? 'EARNINGS (CONTINUED)' : 'EARNINGS', left + 8, y + 7, { lineBreak: false });
        doc.text(`AMOUNT (${currency})`, left + half - amtW - 8, y + 7, { width: amtW, align: 'right', lineBreak: false });
        doc.text(continued ? 'DEDUCTIONS (CONTINUED)' : 'DEDUCTIONS', left + half + 8, y + 7, { lineBreak: false });
        doc.text(`AMOUNT (${currency})`, right - amtW - 8, y + 7, { width: amtW, align: 'right', lineBreak: false });
        y += headH;
    };
    // Side borders are drawn per row so the table can continue cleanly on a second page.
    const rowBorders = (top: number, bottom: number) => {
        vline(left, top, bottom);
        vline(left + half, top, bottom);
        vline(right, top, bottom);
    };
    const cell = (label: string, amount: number, x: number, ry: number) => {
        doc.text(fitText(doc, pdfText(label), half - amtW - 24), x + 8, ry + 5.5, { lineBreak: false });
        doc.text(formatAmount(amount), x + half - amtW - 8, ry + 5.5, { width: amtW, align: 'right', lineBreak: false });
    };

    ensure(headH + lineH * Math.min(lineCount, 3) + totalH);
    tableHeader(false);
    for (let i = 0; i < lineCount; i++) {
        if (ensure(lineH)) tableHeader(true);
        const rowTop = y;
        doc.font('Helvetica').fontSize(9.5).fillColor(INK);
        if (earnings[i]) cell(earnings[i][0], earnings[i][1], left, rowTop);
        if (deducts[i]) cell(deducts[i][0], deducts[i][1], left + half, rowTop);
        y += lineH;
        hline(y, left, right, 0.4, ROW_RULE);
        rowBorders(rowTop, y);
    }

    if (ensure(totalH)) tableHeader(true);
    const totalsTop = y;
    doc.rect(left, y, width, totalH).fill(SHADE);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(INK);
    cell('Gross Earnings', grossAmount ?? salary + totalAllowances, left, y + 1);
    cell('Total Deductions', totalDeductions, left + half, y + 1);
    y += totalH;
    rowBorders(totalsTop, y);
    hline(y, left, right, 0.75);
    y += 16;

    /* ---------- Net pay ---------- */
    ensure(30 + 40);
    doc.rect(left, y, width, 30).lineWidth(1).strokeColor(color).stroke();
    doc.rect(left, y, 150, 30).fill(color);
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#ffffff').text('NET PAY', left + 12, y + 10, { lineBreak: false });
    doc.font('Helvetica-Bold').fontSize(14).fillColor(INK)
        .text(`${currency} ${formatAmount(netPay)}`, left + 160, y + 8, { width: width - 172, align: 'right', lineBreak: false });
    y += 38;
    doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('Amount in words: ', left, y, { continued: true, width })
        .font('Helvetica-Oblique').fillColor(INK).text(amountInWords(netPay, currency));
    y = doc.y + 4;
    if (payment?.reference) {
        doc.font('Helvetica-Bold').fontSize(8.5).fillColor(MUTED).text('Payment reference: ', left, y, { continued: true, width })
            .font('Helvetica').fillColor(INK).text(pdfText(payment.reference));
        y = doc.y;
    }

    /* ---------- Signatures ---------- */
    ensure(48 + 30);
    y += 48;   // room above the line for a typed signature
    const sigW = 200;
    if (signature) {
        doc.font('Helvetica-Oblique').fontSize(16).fillColor(INK);
        doc.text(fitText(doc, pdfText(signature), sigW), left, y - 22, { lineBreak: false });
    }
    hline(y, left, left + sigW, 0.75, '#9ca3af');
    hline(y, right - sigW, right, 0.75, '#9ca3af');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(INK);
    doc.text(fitText(doc, pdfText(approvedBy), sigW), left, y + 5, { lineBreak: false });
    doc.text('Employee Signature', right - sigW, y + 5, { width: sigW, align: 'right', lineBreak: false });
    doc.font('Helvetica').fontSize(8).fillColor(MUTED);
    doc.text(fitText(doc, pdfText(approvedByTitle || 'Authorised Signatory'), sigW), left, y + 18, { lineBreak: false });
    doc.text(fitText(doc, pdfText(employeeName), sigW), right - sigW, y + 18, { width: sigW, align: 'right', lineBreak: false });

    /* ---------- Every page: footer, page number, DRAFT watermark ---------- */
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
        doc.switchToPage(i);
        // Text inside the bottom margin would otherwise make PDFKit start a new page.
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;

        const fy = doc.page.height - 44;
        hline(fy - 6, left, right, 0.5);
        doc.font('Helvetica').fontSize(7.5).fillColor(MUTED);
        doc.text('This is a computer-generated payslip and does not require a physical signature. Private and confidential.',
            left, fy, { width, align: 'center', lineBreak: false });
        if (company.footerNote) {
            doc.text(fitText(doc, pdfText(company.footerNote), width), left, fy + 10, { width, align: 'center', lineBreak: false });
        }
        if (range.count > 1) {
            doc.text(`Page ${i - range.start + 1} of ${range.count}`, left, fy + 20, { width, align: 'right', lineBreak: false });
        }

        if (draft) {
            doc.save();
            doc.rotate(-35, { origin: [doc.page.width / 2, doc.page.height / 2] });
            doc.font('Helvetica-Bold').fontSize(110).fillColor('#ef4444').fillOpacity(0.08)
                .text('DRAFT', 0, doc.page.height / 2 - 60, { width: doc.page.width, align: 'center', lineBreak: false });
            doc.restore();
        }
        doc.page.margins.bottom = savedBottom;
    }

    doc.end();
    return finished;
};
