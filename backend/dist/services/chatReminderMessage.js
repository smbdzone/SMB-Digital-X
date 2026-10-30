//backend-updated/src/services/chatReminderMessage.ts
import { escapeHtml } from "../email/emailTemplate.js";
const APP_NAME = () => process.env.APP_NAME || 'Team Portal';
const wrap = (inner) => `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:24px;background:#f4f6f9;font-family:Arial,Helvetica,sans-serif;color:#1e293b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;">
      <tr><td style="height:6px;background:#0136B0;font-size:0;line-height:0;">&nbsp;</td></tr>
      <tr><td style="padding:28px 32px;font-size:15px;line-height:1.6;">${inner}</td></tr>
    </table>
  </body>
</html>`;
const joinNames = (names) => {
    if (names.length <= 1)
        return names[0] ?? 'a teammate';
    if (names.length === 2)
        return `${names[0]} and ${names[1]}`;
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
/** Email that tells someone they have chat messages they did not open. */
export const generateChatReminderEmail = (data) => {
    const app = APP_NAME();
    const messages = data.count === 1 ? '1 unread message' : `${data.count} unread messages`;
    const who = joinNames(data.senderNames);
    const where = data.conversationType === 'group'
        ? `in the group "${data.conversationName || 'Group'}"`
        : `from ${who}`;
    const subject = data.conversationType === 'group'
        ? `${messages} in "${data.conversationName || 'Group'}"`
        : `${messages} from ${who}`;
    const intro = data.conversationType === 'group'
        ? `You have ${messages} ${where}, sent by ${who}. The oldest has been waiting for about ${data.minutes} minutes.`
        : `You have ${messages} ${where}. The oldest has been waiting for about ${data.minutes} minutes.`;
    const text = [
        `Hi ${data.recipientName},`,
        '',
        intro,
        ...(data.preview ? ['', `Latest message: ${data.preview}`] : []),
        '',
        `Open the conversation: ${data.link}`,
    ].join('\n');
    const html = wrap(`
      <p style="margin:0 0 16px;">Hi ${escapeHtml(data.recipientName)},</p>
      <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
      ${data.preview
        ? `<p style="margin:0 0 20px;padding:12px 16px;background:#f1f5f9;border-radius:8px;color:#334155;">${escapeHtml(data.preview)}</p>`
        : ''}
      <p style="margin:0 0 20px;text-align:center;">
        <a href="${escapeHtml(data.link)}" style="display:inline-block;padding:12px 24px;background:#0136B0;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Open conversation</a>
      </p>
      <p style="margin:0;font-size:13px;color:#64748b;">You are receiving this because the message was not opened in ${escapeHtml(app)} for a while.</p>`);
    return { subject, html, text };
};
