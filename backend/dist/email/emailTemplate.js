/** Escapes user-controlled text before it is placed in HTML (prevents HTML injection in emails). */
export const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const safeColor = (color) => color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0136B0';
const safeUrl = (url) => url && /^https?:\/\//i.test(url) ? url : '';
const maskTail = (value) => {
    if (!value)
        return '';
    const clean = value.replace(/\s/g, '');
    return clean.length <= 4 ? clean : `•••• ${clean.slice(-4)}`;
};
export const formatMonthLabel = (month) => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m)
        return month;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    });
};
const formatAmount = (amount) => amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatDate = (date) => date
    ? date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : '';
export function generateSalarySlip(data) {
    const { company, employeeName, role, month, currency, salary, allowances = [], deductions = [], totalAllowances, totalDeductions, grossAmount, netPay, payment, paidOn, approvedBy, approvedByTitle, signature, } = data;
    const color = safeColor(company.brandColor);
    const logo = safeUrl(company.logoUrl);
    const monthLabel = formatMonthLabel(month);
    const displayName = company.legalName || company.name;
    const td = 'padding:11px 18px;border-bottom:1px solid #e9edf2;font-size:15px;color:#1e293b;';
    const tdR = `${td}text-align:right;font-weight:500;`;
    const row = (label, value, opts = {}) => `<tr><td style="${td}">${escapeHtml(label)}</td><td style="${tdR}">${opts.negative ? '-' : ''}${value}</td></tr>`;
    const allowanceRows = allowances.map(a => row(a.name, formatAmount(a.amount))).join('');
    const deductionRows = deductions.map(d => row(d.name, formatAmount(d.amount), { negative: true })).join('');
    const detail = (label, value) => value
        ? `<tr><td style="padding:3px 0;font-size:14px;color:#64748b;width:140px;">${escapeHtml(label)}</td><td style="padding:3px 0;font-size:14px;color:#1e293b;">${escapeHtml(value)}</td></tr>`
        : '';
    const paymentBlock = payment && (payment.method || payment.bankName || payment.accountNumber || payment.iban || payment.reference)
        ? `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 8px 0;background:#f9fafc;border-left:4px solid ${color};border-radius:8px;">
            <tr><td style="padding:16px 20px;">
                <div style="font-size:16px;font-weight:600;color:${color};margin-bottom:8px;">Payment Details</div>
                <table role="presentation" cellpadding="0" cellspacing="0">
                    ${detail('Method', payment.method)}
                    ${detail('Bank', payment.bankName)}
                    ${detail('Account holder', payment.holderName)}
                    ${detail('Account number', maskTail(payment.accountNumber))}
                    ${detail('IBAN', maskTail(payment.iban))}
                    ${detail('Reference', payment.reference)}
                    ${detail('Paid on', formatDate(paidOn))}
                </table>
            </td></tr>
        </table>`
        : '';
    const contactLine = [company.address, company.phone, company.website]
        .filter(Boolean)
        .map(escapeHtml)
        .join(' &nbsp;•&nbsp; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Salary Slip – ${escapeHtml(employeeName)} – ${escapeHtml(company.name)}</title>
</head>
<body style="margin:0;padding:0;background:#e6e9ef;font-family:'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e6e9ef;padding:30px 12px;">
<tr><td align="center">

  <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;">

    <!-- Company header -->
    <tr><td style="background:${color};height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
    <tr><td style="padding:24px 32px 8px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle">
          <div style="font-size:22px;font-weight:700;color:${color};">${escapeHtml(displayName)}</div>
          ${contactLine ? `<div style="font-size:12px;color:#64748b;margin-top:4px;line-height:1.5;">${contactLine}</div>` : ''}
        </td>
        ${logo ? `<td align="right" valign="middle" width="160"><img src="${escapeHtml(logo)}" alt="${escapeHtml(company.name)}" width="150" style="display:block;max-width:150px;max-height:100px;height:auto;border:0;" /></td>` : ''}
      </tr></table>
    </td></tr>

    <!-- Title + employee -->
    <tr><td style="padding:8px 32px 0 32px;">
      <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#64748b;">Salary Slip</div>
      <div style="font-size:18px;font-weight:600;color:#1e293b;margin:2px 0 14px 0;">${escapeHtml(monthLabel)}</div>
      <table role="presentation" cellpadding="0" cellspacing="0">
        ${detail('Employee', employeeName)}
        ${detail('Position', role)}
        ${detail('Pay period', monthLabel)}
        ${detail('Currency', currency)}
      </table>
    </td></tr>

    <!-- Earnings / deductions -->
    <tr><td style="padding:18px 32px 0 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e9edf2;">
        <tr>
          <th align="left" style="background:${color};color:#fff;font-size:14px;padding:12px 18px;">Description</th>
          <th align="right" style="background:${color};color:#fff;font-size:14px;padding:12px 18px;">Amount (${escapeHtml(currency)})</th>
        </tr>
        ${row('Basic Salary', formatAmount(salary))}
        ${allowanceRows}
        ${allowances.length ? row('Total Allowances', formatAmount(totalAllowances)) : ''}
        <tr><td style="${td}font-weight:600;">Gross Pay</td><td style="${tdR}font-weight:600;">${formatAmount(grossAmount)}</td></tr>
        ${deductionRows}
        ${deductions.length ? row('Total Deductions', formatAmount(totalDeductions), { negative: true }) : ''}
        <tr>
          <td style="background:#f8fafc;border-top:2px solid ${color};padding:14px 18px;font-size:16px;font-weight:700;color:${color};">Net Pay</td>
          <td style="background:#f8fafc;border-top:2px solid ${color};padding:14px 18px;font-size:16px;font-weight:700;color:${color};text-align:right;">${formatAmount(netPay)}</td>
        </tr>
      </table>
      ${paymentBlock}
    </td></tr>

    <!-- Approval -->
    <tr><td style="padding:20px 32px 8px 32px;">
      <div style="font-size:13px;color:#64748b;">Approved by</div>
      <div style="font-size:15px;font-weight:600;color:#1e293b;">${escapeHtml(approvedBy)}${approvedByTitle ? ` <span style="font-weight:400;color:#64748b;">– ${escapeHtml(approvedByTitle)}</span>` : ''}</div>
      ${signature ? `<div style="font-family:'Brush Script MT','Segoe Script',cursive;font-size:26px;color:${color};margin-top:6px;">${escapeHtml(signature)}</div>` : ''}
    </td></tr>

    <!-- Footer -->
    <tr><td style="padding:18px 32px 26px 32px;border-top:1px solid #e9edf2;">
      <div style="font-size:12px;color:#94a3b8;line-height:1.6;">
        ${company.footerNote ? `${escapeHtml(company.footerNote)}<br />` : ''}
        This is a system-generated salary slip from ${escapeHtml(company.name)}.
      </div>
    </td></tr>

  </table>

</td></tr>
</table>
</body>
</html>`;
}
