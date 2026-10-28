import { escapeHtml } from './emailTemplate.js'

const APP_NAME = () => process.env.APP_NAME || 'Team Portal'

const wrap = (inner: string): string => `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="height:6px;background:#0136B0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;">${inner}</td></tr>
    </table>
  </body>
</html>`

/** Email that carries the 6-digit password reset code. */
export const generatePasswordResetEmail = (name: string, code: string, minutes: number): { subject: string; html: string; text: string } => {
    const app = APP_NAME()
    const text = [
        `Hi ${name},`,
        '',
        `Your ${app} password reset code is: ${code}`,
        '',
        `This code expires in ${minutes} minutes. Do not share it with anyone.`,
        'If you did not ask to reset your password, you can ignore this email; your password will not change.',
    ].join('\n')

    const html = wrap(`
      <p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 16px;">Use this code to reset your ${escapeHtml(app)} password:</p>
      <p style="margin:0 0 20px;text-align:center;">
        <span style="display:inline-block;padding:14px 28px;background:#f1f5f9;border-radius:8px;font-size:32px;font-weight:700;letter-spacing:10px;color:#0136B0;">${escapeHtml(code)}</span>
      </p>
      <p style="margin:0 0 12px;">This code expires in <strong>${minutes} minutes</strong>. Do not share it with anyone.</p>
      <p style="margin:0;font-size:13px;color:#64748b;">If you did not ask to reset your password, you can ignore this email. Your password will not change.</p>`)

    return { subject: `${app} password reset code`, html, text }
}

/** Confirmation sent after the password was changed. */
export const generatePasswordChangedEmail = (name: string): { subject: string; html: string; text: string } => {
    const app = APP_NAME()
    const text = [
        `Hi ${name},`,
        '',
        `Your ${app} password was just changed.`,
        'If this was not you, contact your administrator immediately.',
    ].join('\n')

    const html = wrap(`
      <p style="margin:0 0 16px;">Hi ${escapeHtml(name)},</p>
      <p style="margin:0 0 16px;">Your ${escapeHtml(app)} password was just changed.</p>
      <p style="margin:0;font-size:13px;color:#64748b;">If this was not you, contact your administrator immediately.</p>`)

    return { subject: `Your ${app} password was changed`, html, text }
}
