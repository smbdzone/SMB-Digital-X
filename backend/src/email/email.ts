import transporter from "../config/nodemailer.js"

export interface SlipMailOptions {
    to: string;
    subject: string;
    html: string;
    text?: string;
    // Files attached to the email (salary slip PDF, certificate PDF, ...).
    attachments?: { filename: string; content: Buffer; contentType?: string }[];
    // The paying / issuing company decides who the email appears to come from.
    company: {
        name: string;
        email?: {
            fromName?: string;
            fromEmail?: string;
            replyTo?: string;
        };
    };
}

/**
 * Sends an email "as" a company (salary slips, certificates, letters).
 *
 * - Display name  : company.email.fromName, else company.name   -> "Axis Aura" <hr@...>
 * - Address       : company.email.fromEmail, else process.env.EMAIL
 * - Reply-To      : company.email.replyTo (optional)
 *
 * NOTE (Gmail): Gmail only lets you send from your own address or from aliases that are
 * configured under "Send mail as" for that account. If `fromEmail` is not a verified alias,
 * Gmail silently rewrites it to the account in process.env.EMAIL. The display name still
 * changes per company either way. For fully separate sender domains, move to a transactional
 * provider (SES, Resend, Postmark, ...) and swap only config/nodemailer.ts.
 */
export const sendCompanyMail = async ({ to, subject, html, text, attachments, company }: SlipMailOptions): Promise<void> => {
    if (!to) throw new Error('Recipient email is required');

    const address = company.email?.fromEmail || process.env.EMAIL;
    if (!address) {
        throw new Error('No sender address configured. Set EMAIL in .env or a fromEmail on the company.');
    }

    await transporter.sendMail({
        from: { name: company.email?.fromName || company.name, address },
        replyTo: company.email?.replyTo || undefined,
        to,
        subject,
        html,
        text,
        attachments,
    });
};

// Kept under its old name so the salary code does not need to change.
export const sendSalarySlip = sendCompanyMail;

/** Sends a system email (password reset, ...) that does not belong to any company. */
export const sendSystemMail = async ({ to, subject, html, text }: { to: string; subject: string; html: string; text?: string }): Promise<void> => {
    if (!to) throw new Error('Recipient email is required');
    const address = process.env.EMAIL;
    if (!address) throw new Error('No sender address configured. Set EMAIL in .env.');

    await transporter.sendMail({
        from: { name: process.env.APP_NAME || 'Team Portal', address },
        to,
        subject,
        html,
        text,
    });
};
