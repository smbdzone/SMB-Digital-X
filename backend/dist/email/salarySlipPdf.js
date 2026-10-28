import PDFDocument from 'pdfkit';
import { formatMonthLabel } from './emailTemplate.js';
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const safeColor = (color) => color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0136B0';
const formatAmount = (amount) => amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (date) => date
    ? new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
const maskTail = (value) => {
    if (!value)
        return '';
    const clean = value.replace(/\s/g, '');
    return clean.length <= 4 ? clean : `**** ${clean.slice(-4)}`;
};
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
        const timer = setTimeout(() => controller.abort(), 5000);
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
export const slipFileName = (employeeName, month) => {
    const clean = employeeName.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'Employee';
    return `Salary-Slip-${clean}-${month}.pdf`;
};
/* ------------------------------------------------------------------ */
/* PDF                                                                 */
/* ------------------------------------------------------------------ */
/**
 * Renders the salary slip as a PDF and resolves with the file bytes.
 * Uses the same SalarySlipData as the HTML slip, so company branding
 * (logo, colour, address, signatory, footer) is identical.
 */
export const generateSalarySlipPdf = async (data) => {
    const { company, employeeName, role, month, currency, salary, allowances = [], deductions = [], totalAllowances, totalDeductions, grossAmount, netPay, payment, paidOn, approvedBy, approvedByTitle, signature, } = data;
    const color = safeColor(company.brandColor);
    const logo = await fetchLogo(company.logoUrl);
    const money = (n) => `${currency} ${formatAmount(n)}`;
    const doc = new PDFDocument({
        size: 'A4',
        margin: 40,
        info: {
            Title: `Salary Slip - ${formatMonthLabel(month)}`,
            Author: company.name,
            Subject: `Salary slip for ${employeeName}`,
        },
    });
    const chunks = [];
    const finished = new Promise((resolve, reject) => {
        doc.on('data', (chunk) => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);
    });
    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const right = left + width;
    const bottomLimit = () => doc.page.height - doc.page.margins.bottom - 30;
    const ensureSpace = (height) => {
        if (doc.y + height > bottomLimit())
            doc.addPage();
    };
    /* ---------- Header ---------- */
    doc.rect(0, 0, doc.page.width, 8).fill(color);
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
    doc.font('Helvetica-Bold').fontSize(20).fillColor('#0f172a')
        .text('SALARY SLIP', left, headerTop, { width, align: 'right' });
    doc.font('Helvetica').fontSize(11).fillColor('#475569')
        .text(formatMonthLabel(month), left, headerTop + 26, { width, align: 'right' });
    const companyLines = [company.legalName || company.name, company.address, company.phone, company.website]
        .filter(Boolean)
        .map(pdfText);
    doc.font('Helvetica').fontSize(9).fillColor('#64748b')
        .text(companyLines.join('   |   '), left, Math.max(leftBlockBottom, headerTop + 44) + 8, { width });
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(1).strokeColor('#e2e8f0').stroke();
    doc.moveDown(0.8);
    /* ---------- Employee details ---------- */
    const detailsTop = doc.y;
    const details = [
        ['Employee', employeeName],
        ['Position', role || '-'],
        ['Pay period', formatMonthLabel(month)],
        ['Paid on', formatDate(paidOn) || '-'],
    ];
    doc.roundedRect(left, detailsTop, width, 74, 6).fillAndStroke('#f8fafc', '#e2e8f0');
    const colWidth = width / 2;
    details.forEach(([label, value], i) => {
        const x = left + 16 + (i % 2) * colWidth;
        const y = detailsTop + 10 + Math.floor(i / 2) * 32;
        doc.font('Helvetica').fontSize(8).fillColor('#64748b').text(label.toUpperCase(), x, y, { width: colWidth - 24 });
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#0f172a').text(pdfText(value), x, y + 10, { width: colWidth - 24, ellipsis: true, lineBreak: false });
    });
    doc.y = detailsTop + 74 + 18;
    /* ---------- Table helpers ---------- */
    const tableHeader = (title) => {
        ensureSpace(60);
        const y = doc.y;
        doc.rect(left, y, width, 24).fill(color);
        doc.font('Helvetica-Bold').fontSize(10).fillColor('#ffffff')
            .text(title.toUpperCase(), left + 12, y + 7, { width: width - 140 })
            .text('AMOUNT', left, y + 7, { width: width - 12, align: 'right' });
        doc.y = y + 24;
    };
    const tableRow = (label, amount, opts = {}) => {
        ensureSpace(26);
        const y = doc.y;
        if (opts.shade)
            doc.rect(left, y, width, 26).fill('#f1f5f9');
        doc.font(opts.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(10.5).fillColor('#1e293b')
            .text(pdfText(label), left + 12, y + 8, { width: width - 160, lineBreak: false, ellipsis: true })
            .text(amount, left, y + 8, { width: width - 12, align: 'right' });
        doc.moveTo(left, y + 26).lineTo(right, y + 26).lineWidth(0.5).strokeColor('#e9edf2').stroke();
        doc.y = y + 26;
    };
    /* ---------- Earnings ---------- */
    tableHeader('Earnings');
    tableRow('Basic salary', money(salary));
    allowances.forEach(a => tableRow(a.name, money(a.amount)));
    tableRow('Gross earnings', money(grossAmount ?? salary + totalAllowances), { bold: true, shade: true });
    doc.y += 14;
    /* ---------- Deductions ---------- */
    if (deductions.length > 0) {
        tableHeader('Deductions');
        deductions.forEach(d => tableRow(d.name, `- ${money(d.amount)}`));
        tableRow('Total deductions', `- ${money(totalDeductions)}`, { bold: true, shade: true });
        doc.y += 14;
    }
    /* ---------- Net pay ---------- */
    ensureSpace(70);
    const netTop = doc.y;
    doc.roundedRect(left, netTop, width, 46, 6).fill(color);
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#ffffff')
        .text('NET PAY', left + 16, netTop + 16, { width: 200 });
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#ffffff')
        .text(money(netPay), left, netTop + 13, { width: width - 16, align: 'right' });
    doc.y = netTop + 46 + 18;
    /* ---------- Payment details ---------- */
    if (payment) {
        const rows = [
            ['Payment method', payment.method || ''],
            ['Bank', payment.bankName || ''],
            ['Account holder', payment.holderName || ''],
            ['Account number', maskTail(payment.accountNumber)],
            ['IBAN', maskTail(payment.iban)],
            ['Reference', payment.reference || ''],
        ].filter(([, v]) => v);
        if (rows.length > 0) {
            ensureSpace(30 + rows.length * 18);
            doc.font('Helvetica-Bold').fontSize(10).fillColor(color).text('PAYMENT DETAILS', left, doc.y);
            doc.y += 6;
            rows.forEach(([label, value]) => {
                const y = doc.y;
                doc.font('Helvetica').fontSize(10).fillColor('#64748b').text(label, left, y, { width: 140 });
                doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(pdfText(value), left + 150, y, { width: width - 150 });
                doc.y = y + 18;
            });
            doc.y += 8;
        }
    }
    /* ---------- Approval / signature ---------- */
    ensureSpace(90);
    doc.y += 10;
    const signTop = doc.y;
    if (signature) {
        doc.font('Helvetica-Oblique').fontSize(18).fillColor('#0f172a').text(pdfText(signature), left, signTop, { width: 260 });
    }
    const lineY = signTop + 30;
    doc.moveTo(left, lineY).lineTo(left + 200, lineY).lineWidth(0.8).strokeColor('#94a3b8').stroke();
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(pdfText(approvedBy), left, lineY + 5, { width: 260 });
    if (approvedByTitle) {
        doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(pdfText(approvedByTitle), left, doc.y, { width: 260 });
    }
    /* ---------- Footer ---------- */
    const footer = [company.footerNote, 'This is a system-generated salary slip.'].filter(Boolean).map(pdfText).join('  ');
    doc.font('Helvetica').fontSize(8).fillColor('#94a3b8')
        .text(footer, left, doc.page.height - doc.page.margins.bottom - 14, { width, align: 'center', lineBreak: false });
    doc.end();
    return finished;
};
