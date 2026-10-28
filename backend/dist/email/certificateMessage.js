import { escapeHtml } from './emailTemplate.js';
const safeColor = (color) => color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#0136B0';
/** Short email body. The letter / certificate itself is attached as a PDF. */
export const generateCertificateMessage = (data) => {
    const color = safeColor(data.brandColor);
    const text = [
        `Dear ${data.employeeName},`,
        '',
        `Please find attached your "${data.title}" issued by ${data.companyName}.`,
        `Reference number: ${data.referenceNo}`,
        '',
        'If you have any questions about it, please reply to this email.',
        '',
        'Regards,',
        data.companyName,
        ...(data.footerNote ? ['', data.footerNote] : []),
    ].join('\n');
    const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="height:6px;background:${color};font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr>
        <td style="padding:28px 32px;font-size:15px;line-height:1.6;">
          <p style="margin:0 0 16px;">Dear ${escapeHtml(data.employeeName)},</p>
          <p style="margin:0 0 16px;">Please find attached your <strong>${escapeHtml(data.title)}</strong> issued by ${escapeHtml(data.companyName)}.</p>
          <p style="margin:0 0 16px;font-size:13px;color:#64748b;">Reference number: ${escapeHtml(data.referenceNo)}</p>
          <p style="margin:0 0 24px;">If you have any questions about it, please reply to this email.</p>
          <p style="margin:0;">Regards,<br><strong>${escapeHtml(data.companyName)}</strong></p>
        </td>
      </tr>
      ${data.footerNote ? `<tr><td style="padding:0 32px 24px;font-size:12px;color:#64748b;">${escapeHtml(data.footerNote)}</td></tr>` : ''}
    </table>
  </body>
</html>`;
    return { html, text };
};
