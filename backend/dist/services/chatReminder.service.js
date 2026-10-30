//backend-updated/src/services/chatReminder.service.ts
import conversationModel from '../model/conversation.model.js';
import messageModel from '../model/message.model.js';
import User from '../model/user.model.js';
import { sendSystemMail } from '../email/email.js';
import { generateChatReminderEmail } from './chatReminderMessage.js';
import dotenv from 'dotenv';
dotenv.config();
/* ------------------------------------------------------------------ */
/* Settings (all optional, see .env.example)                           */
/* ------------------------------------------------------------------ */
const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
};
export const reminderConfig = () => ({
    enabled: process.env.CHAT_REMINDER_ENABLED !== 'false',
    delayMs: positive(process.env.CHAT_REMINDER_DELAY_MINUTES, 30) * 60_000, // wait this long before emailing
    cooldownMs: positive(process.env.CHAT_REMINDER_COOLDOWN_MINUTES, 60) * 60_000, // at most one email per person per chat in this time
    maxAgeMs: positive(process.env.CHAT_REMINDER_MAX_AGE_HOURS, 24) * 3_600_000, // never email about messages older than this
    maxEmailsPerRun: positive(process.env.CHAT_REMINDER_MAX_PER_RUN, 50),
    preview: process.env.CHAT_REMINDER_PREVIEW === 'true', // finance chats: default is NO message text in emails
});
// Path of one user's "last reminder sent" time inside conversation.reminderSentAt (a Map keyed by user id).
const reminderKey = (userId) => `reminderSentAt.${userId}`;
/**
 * One group = one person who has unread messages in one conversation that are old enough.
 * A message counts when: it is older than `delayMs`, the person is not the sender, is not in `readBy`,
 * was not already covered by a previous reminder, and no reminder was sent to them for this chat during the cooldown.
 */
export const buildReminderGroups = (rows, now, cooldownMs) => {
    const groups = new Map();
    for (const row of rows) {
        const sender = String(row.senderId);
        const readers = new Set((row.readBy ?? []).map(String));
        for (const participant of row.participents.map(String)) {
            if (participant === sender || readers.has(participant))
                continue;
            const lastRaw = row.reminderSentAt?.[participant];
            const last = lastRaw ? new Date(lastRaw) : undefined;
            if (last && (now - last.getTime() < cooldownMs || last >= row.createdAt))
                continue;
            const key = `${participant}:${String(row.conversationId)}`;
            let group = groups.get(key);
            if (!group) {
                group = {
                    userId: participant,
                    conversationId: String(row.conversationId),
                    conversationType: row.convType,
                    conversationName: row.convName,
                    senderIds: [],
                    count: 0,
                    oldest: row.createdAt,
                    previous: last,
                };
                groups.set(key, group);
            }
            group.count += 1;
            if (!group.senderIds.includes(sender))
                group.senderIds.push(sender);
            if (row.createdAt < group.oldest)
                group.oldest = row.createdAt;
            // rows arrive newest-last, so the final one wins
            group.newestText = row.text || group.newestText;
        }
    }
    return [...groups.values()];
};
/* ------------------------------------------------------------------ */
/* The job                                                             */
/* ------------------------------------------------------------------ */
const frontendUrl = () => (process.env.FRONTEND || process.env.CLIENT_URL || 'http://localhost:3000').replace(/\/+$/, '');
/** Emails people about chat messages they have not opened for `delayMs`. Safe to call every minute. */
export const sendUnreadChatReminders = async () => {
    const cfg = reminderConfig();
    if (!cfg.enabled)
        return;
    const now = Date.now();
    // Messages in the window [now - maxAge, now - delay], joined with their conversation's participants.
    const rows = await messageModel.aggregate([
        { $match: { createdAt: { $gte: new Date(now - cfg.maxAgeMs), $lte: new Date(now - cfg.delayMs) } } },
        { $sort: { createdAt: 1 } },
        { $lookup: { from: conversationModel.collection.name, localField: 'conversationId', foreignField: '_id', as: 'conv' } },
        { $unwind: '$conv' },
        {
            $project: {
                conversationId: 1, senderId: 1, readBy: 1, createdAt: 1, text: 1,
                participents: '$conv.participents',
                reminderSentAt: '$conv.reminderSentAt',
                convName: '$conv.name',
                convType: '$conv.type',
            },
        },
    ]);
    const groups = buildReminderGroups(rows, now, cfg.cooldownMs).slice(0, cfg.maxEmailsPerRun);
    if (groups.length === 0)
        return;
    // One query for every name and email we need.
    const userIds = new Set();
    for (const g of groups) {
        userIds.add(g.userId);
        g.senderIds.forEach(id => userIds.add(id));
    }
    const users = await User.find({ _id: { $in: [...userIds] } }).select('name email status').lean();
    const byId = new Map(users.map(u => [String(u._id), u]));
    let sent = 0;
    for (const group of groups) {
        const recipient = byId.get(group.userId);
        if (!recipient || recipient.status === 'inactive' || !recipient.email)
            continue;
        // Claim first, send second: if two servers run this job, only one of them gets modifiedCount 1.
        const key = reminderKey(group.userId);
        const claim = await conversationModel.updateOne({
            _id: group.conversationId,
            $or: [{ [key]: { $exists: false } }, { [key]: { $lt: new Date(now - cfg.cooldownMs) } }],
        }, { $set: { [key]: new Date(now) } }, { timestamps: false } // must not move the conversation in the chat list
        );
        if (claim.modifiedCount === 0)
            continue;
        try {
            const senderNames = group.senderIds.map(id => byId.get(id)?.name).filter(Boolean);
            const mail = generateChatReminderEmail({
                recipientName: recipient.name,
                conversationType: group.conversationType,
                conversationName: group.conversationName,
                senderNames,
                count: group.count,
                minutes: Math.max(1, Math.round((now - group.oldest.getTime()) / 60_000)),
                link: `${frontendUrl()}/chat?conversationId=${group.conversationId}`,
                preview: cfg.preview ? (group.newestText ? group.newestText.slice(0, 120) : 'Sent an attachment') : undefined,
            });
            await sendSystemMail({ to: recipient.email, subject: mail.subject, html: mail.html, text: mail.text });
            sent += 1;
        }
        catch (error) {
            // Undo the claim so the next run tries again.
            console.error(`[chat-reminder] email to ${recipient.email} failed:`, error);
            await conversationModel.updateOne({ _id: group.conversationId }, group.previous ? { $set: { [key]: group.previous } } : { $unset: { [key]: '' } }, { timestamps: false });
        }
    }
    if (sent > 0)
        console.log(`[chat-reminder] sent ${sent} reminder email(s)`);
};
