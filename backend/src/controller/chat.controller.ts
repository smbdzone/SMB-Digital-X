import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { Readable } from 'node:stream';
import { v2 as cloudinary } from 'cloudinary';
import conversationModel from '../model/conversation.model.js';
import messageModel from '../model/message.model.js';
import User from '../model/user.model.js';
import { createConversationService } from '../utils/createConversation.js';
import { sendPushToUsers } from '../services/push.service.js';
import { deleteFromCloudinary, uploadToCloudinary } from '../utils/cloudinary.js';
import {
    conversationRoom, emitConversationUpdate, emitToUsers, getViewerIds, leaveConversationRoom, unreadKey, userRoom,
} from '../utils/chat.socket.js';
import {
    AuthUser, asObjectId, asText, badRequest, forbidden, getAuth, isAdmin, isObjectId, notFound, paramId, queryString,
} from '../utils/http.js';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const getCloudinaryResourceType = (mimetype: string): 'image' | 'video' | 'raw' => {
    if (mimetype.startsWith('image/')) return 'image';
    if (mimetype.startsWith('video/')) return 'video';
    return 'raw';
};

const getIO = (req: Request) => req.app.get('io');

const isMember = (conversation: { participents: unknown[] }, userId: string) =>
    conversation.participents.some(p => String((p as any)?._id ?? p) === userId);

// Loads a conversation and makes sure the user is one of its participants.
const loadMemberConversation = async (id: string, userId: string) => {
    const conversation = await conversationModel.findById(id);
    if (!conversation) throw notFound('Conversation not found');
    if (!isMember(conversation, userId)) throw forbidden('Access denied');
    return conversation;
};

// Group management (rename, members, delete) is for admins and the person who created the conversation.
const canManage = (conversation: { createdBy?: unknown }, auth: AuthUser) =>
    isAdmin(auth) || (!!conversation.createdBy && String(conversation.createdBy) === auth.id);

const asIdArray = (value: unknown, field: string): string[] => {
    if (!Array.isArray(value)) throw badRequest(`${field} must be an array of user ids`);
    if (value.length > 200) throw badRequest(`${field} has too many items`);
    if (!value.every(isObjectId)) throw badRequest(`${field} contains an invalid user id`);
    return [...new Set(value.map(String))];
};

const assertUsersExist = async (ids: string[]) => {
    const found = await User.countDocuments({ _id: { $in: ids }, status: { $ne: 'inactive' } });
    if (found !== ids.length) throw badRequest('One or more users do not exist or are inactive');
};

const populateConversation = async (id: string | Types.ObjectId, userId?: string) => {
    const conversation: any = await conversationModel
        .findById(id)
        .populate({ path: 'participents', select: '-password' })
        .populate({ path: 'lastMessage', populate: { path: 'senderId', select: 'name _id' } })
        .lean();
    if (conversation && userId) conversation.myUnreadCount = Number(conversation.unreadCount?.[userId] ?? 0);
    return conversation;
};

/**
 * The unread counter stored on the conversation can drift (deleted messages, old data, races in older code).
 * The messages themselves are the truth: unread = messages sent by someone else that this user is not in `readBy`.
 * Returns { conversationId: count } and quietly repairs any stored counter that disagrees.
 */
const reconcileUnread = async (userId: string, conversations: { _id: any; unreadCount?: any }[]) => {
    const result: Record<string, number> = {};
    if (conversations.length === 0) return result;

    const me = new Types.ObjectId(userId);
    const rows = await messageModel.aggregate([
        {
            $match: {
                conversationId: { $in: conversations.map(c => c._id) },
                senderId: { $ne: me },
                readBy: { $ne: me },
            },
        },
        { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    const counts = new Map<string, number>(rows.map(r => [String(r._id), r.count as number]));

    const repairs: any[] = [];
    for (const c of conversations) {
        const id = String(c._id);
        const truth = counts.get(id) ?? 0;
        result[id] = truth;

        const stored = Number(c.unreadCount?.[userId] ?? 0);
        if (stored !== truth) {
            repairs.push({
                updateOne: {
                    filter: { _id: c._id },
                    update: { $set: { [unreadKey(userId)]: truth } },
                    timestamps: false, // repairing a counter must not move the conversation in the list
                },
            });
        }
    }
    if (repairs.length > 0) {
        conversationModel.bulkWrite(repairs).catch(err => console.error('Unread repair failed:', err));
    }
    return result;
};

// Marks everything in the conversation as read for this user, zeroes their counter and tells the sockets.
const markConversationAsRead = async (io: any, conversationId: string, userId: string) => {
    await Promise.all([
        messageModel.updateMany(
            { conversationId, readBy: { $ne: userId } },
            { $addToSet: { readBy: userId } }
        ),
        // timestamps:false -> opening a chat must not change updatedAt (it used to re-sort the list)
        conversationModel.updateOne(
            { _id: conversationId },
            { $set: { [unreadKey(userId)]: 0 } },
            { timestamps: false }
        ),
    ]);

    io?.to(userRoom(userId)).emit('unread-count-updated', { conversationId, unreadCount: 0 });
    io?.to(conversationRoom(conversationId)).emit('messages-read', { conversationId, userId });
};

// Best effort: a Cloudinary hiccup must never block deleting a message or conversation.
const removeAttachments = async (attachments: { public_id?: string; resource_type?: string }[]) => {
    await Promise.allSettled(
        attachments
            .filter(a => a.public_id)
            .map(a => {
                const type = a.resource_type === 'image' || a.resource_type === 'video' ? a.resource_type : 'raw';
                return deleteFromCloudinary(a.public_id as string, type);
            })
    );
};

// Tells the right people about added / removed members and keeps the socket rooms correct.
const notifyMembershipChange = async (
    io: any,
    conversationId: string,
    everyone: string[],
    added: string[],
    removed: string[]
) => {
    if (!io) return;

    const current = await populateConversation(conversationId);
    const participents = current ? current.participents.map((p: any) => String(p._id)) : [];

    emitToUsers(io, everyone, 'conversation-members-updated', { conversationId, participents, added, removed });

    for (const id of added) {
        emitToUsers(io, [id], 'conversation-created', current ? { ...current, myUnreadCount: 0 } : null);
    }
    for (const id of removed) {
        leaveConversationRoom(io, conversationId, id);
        emitToUsers(io, [id], 'removed-from-conversation', { conversationId });
    }
};

/* ------------------------------------------------------------------ */
/* Conversations                                                       */
/* ------------------------------------------------------------------ */

// POST /api/chat/conversation   { participents: [userId], type: 'individual' | 'group', name? }
export const createConversation = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const { participents, name, type } = req.body ?? {};

    if (!Array.isArray(participents) || participents.length < 1) throw badRequest('At least one participant is required');
    if (!type || !['individual', 'group'].includes(type)) throw badRequest('Invalid conversation type');

    const groupName = type === 'group' ? asText(name, 'name', { required: true, max: 100 }) : undefined;

    const ids = [...new Set<string>([auth.id, ...asIdArray(participents, 'participents')])];
    if (ids.length < 2) throw badRequest('Must have at least two participants');
    if (type === 'individual' && ids.length !== 2) throw badRequest('An individual conversation has exactly two participants');

    await assertUsersExist(ids);

    // Reuse the existing one-to-one conversation, in the same shape as a new one.
    if (type === 'individual') {
        const existing = await conversationModel.findOne({
            type: 'individual',
            participents: { $all: ids, $size: 2 },
        }).select('_id');

        if (existing) {
            res.status(200).json({
                success: true,
                message: 'Conversation already exists',
                data: await populateConversation(existing._id, auth.id),
            });
            return;
        }
    }

    const unreadCount: Record<string, number> = {};
    for (const id of ids) unreadCount[id] = 0;

    const result = await createConversationService({
        participents: ids,
        name: groupName,
        type,
        createdBy: auth.id,
        unreadCount,
    });

    if (!result.success) {
        res.status(500).json(result);
        return;
    }

    // The other participants see the new conversation immediately, without refreshing.
    const created: any = result.data;
    emitToUsers(getIO(req), ids.filter(id => id !== auth.id), 'conversation-created', { ...created, myUnreadCount: 0 });

    res.status(201).json({ ...result, data: { ...created, myUnreadCount: 0 } });
};

// GET /api/chat/conversation
export const getConversation = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);

    const conversations: any[] = await conversationModel
        .find({ participents: { $in: [auth.id] } })
        .populate({ path: 'participents', select: '-password' })
        .populate({ path: 'lastMessage', populate: { path: 'senderId', select: 'name _id' } })
        .sort({ updatedAt: -1 })
        .lean();

    // myUnreadCount is calculated from the messages, so it is always right.
    const unread = await reconcileUnread(auth.id, conversations);

    const data = conversations.map(c => ({ ...c, myUnreadCount: unread[String(c._id)] ?? 0 }));
    const totalUnread = data.reduce((total, c) => total + c.myUnreadCount, 0);

    res.status(200).json({
        success: true,
        message: 'Conversations retrieved',
        data,
        totalUnread,
    });
};

// GET /api/chat/conversation/:id
export const getConversationById = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);

    const conversation = await populateConversation(id);
    if (!conversation) throw notFound('Conversation not found');
    if (!isMember(conversation, auth.id)) throw forbidden('Access denied');

    const unread = await reconcileUnread(auth.id, [conversation]);

    res.status(200).json({
        success: true,
        message: 'Conversation retrieved',
        data: { ...conversation, myUnreadCount: unread[String(conversation._id)] ?? 0 },
    });
};

// PATCH /api/chat/conversation/:id   { name?, participents? }  - groups only; admin or the creator
// `lastMessage` in the body is ignored on purpose (it is maintained by the server).
export const updateConversation = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);
    const { name, participents } = req.body ?? {};

    const conversation = await conversationModel.findById(id);
    if (!conversation) throw notFound('Conversation not found');
    if (!canManage(conversation, auth)) throw forbidden('Only an admin or the creator can update this conversation');
    if (conversation.type !== 'group') throw badRequest('Only group conversations can be updated');

    const $set: Record<string, unknown> = {};
    const $unset: Record<string, ''> = {};
    let added: string[] = [];
    let removed: string[] = [];
    const before = conversation.participents.map(String);

    if (name !== undefined) $set.name = asText(name, 'name', { required: true, max: 100 });

    if (participents !== undefined) {
        const next = asIdArray(participents, 'participents');
        if (next.length < 2) throw badRequest('A group needs at least two participants');
        await assertUsersExist(next);

        added = next.filter(p => !before.includes(p));
        removed = before.filter(p => !next.includes(p));

        $set.participents = next.map(p => new Types.ObjectId(p));
        for (const p of added) $set[unreadKey(p)] = 0;
        for (const p of removed) $unset[unreadKey(p)] = '';
    }

    if (Object.keys($set).length === 0) throw badRequest('Nothing to update');

    await conversationModel.updateOne(
        { _id: id },
        { $set, ...(Object.keys($unset).length ? { $unset } : {}) }
    );

    const io = getIO(req);
    if (added.length || removed.length) {
        await notifyMembershipChange(io, id, [...new Set([...before, ...added])], added, removed);
    } else {
        await emitConversationUpdate(io, id);
    }

    res.status(200).json({
        success: true,
        message: 'Conversation updated successfully',
        data: await populateConversation(id, auth.id),
    });
};

// PATCH /api/chat/conversation/:id/read
// Call it when the user opens a chat, and again when a message arrives while the chat is open.
export const markAsRead = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);

    await loadMemberConversation(id, auth.id);
    await markConversationAsRead(getIO(req), id, auth.id);

    res.status(200).json({
        success: true,
        message: 'Conversation marked as read',
        data: { conversationId: id, unreadCount: 0 },
    });
};

// DELETE /api/chat/conversation/:id  - admin or the creator (it removes the chat for everyone)
export const deleteConversation = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);

    const conversation = await conversationModel.findById(id);
    if (!conversation) throw notFound('Conversation not found');
    if (!canManage(conversation, auth)) throw forbidden('Only an admin or the creator can delete this conversation');

    const withFiles = await messageModel
        .find({ conversationId: id, 'attachments.0': { $exists: true } })
        .select('attachments')
        .lean();

    await messageModel.deleteMany({ conversationId: id });
    await conversationModel.findByIdAndDelete(id);

    await removeAttachments(withFiles.flatMap(m => m.attachments ?? []));

    const io = getIO(req);
    emitToUsers(io, conversation.participents.map(String), 'conversation-deleted', { conversationId: id });
    io?.in(conversationRoom(id)).socketsLeave(conversationRoom(id));

    res.status(200).json({ success: true, message: 'Conversation deleted successfully' });
};

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

// POST /api/chat/message  (multipart: conversationId, text?, replyTo?, mentions?, files[])
export const createMessage = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const b = req.body ?? {};

    if (!isObjectId(b.conversationId)) throw badRequest('Conversation ID is required');
    const conversationId: string = b.conversationId;

    const text = asText(b.text, 'text', { max: 5000 });
    const files = ((req as any).files as Express.Multer.File[] | undefined) ?? [];
    if (!text && files.length === 0) throw badRequest('Message text or at least one file is required');

    const conversation = await loadMemberConversation(conversationId, auth.id);
    const participants = conversation.participents.map(String);

    // replyTo must be a message of this same conversation
    let replyTo: string | undefined;
    if (b.replyTo) {
        if (!isObjectId(b.replyTo)) throw badRequest('replyTo is not a valid message id');
        const exists = await messageModel.exists({ _id: b.replyTo, conversationId });
        if (!exists) throw badRequest('replyTo message was not found in this conversation');
        replyTo = b.replyTo;
    }

    // mentions can arrive as an array, a JSON string or a single id (multipart form); keep valid participants only
    let rawMentions: unknown = b.mentions;
    if (typeof rawMentions === 'string') {
        try { rawMentions = JSON.parse(rawMentions); } catch { rawMentions = [rawMentions]; }
    }
    const mentions = (Array.isArray(rawMentions) ? rawMentions : [])
        .filter(isObjectId)
        .filter(m => participants.includes(m));

    // Upload attachments
    let attachments: { url: string; public_id: string; resource_type: string; filename: string }[] = [];
    if (files.length > 0) {
        const results = await Promise.all(
            files.map(file =>
                uploadToCloudinary(file.buffer, {
                    folder: `chat_${conversationId}`,
                    resource_type: getCloudinaryResourceType(file.mimetype),
                    filename: file.originalname,
                })
            )
        );
        attachments = results.map((r, i) => ({
            url: r.url,
            public_id: r.public_id,
            resource_type: r.resource_type,
            filename: files[i].originalname,
        }));
    }

    const io = getIO(req);

    // People who have this chat open right now already "see" the message: it is read for them, no unread +1.
    const viewers = await getViewerIds(io, conversationId);
    const readBy = [...new Set([auth.id, ...participants.filter(p => viewers.has(p))])];

    const message = await messageModel.create({
        conversationId,
        senderId: auth.id,
        text,
        attachments,
        replyTo,
        mentions,
        readBy,
    });

    // ATOMIC update: two messages at the same moment can no longer overwrite each other's unread count.
    const $inc: Record<string, number> = {};
    for (const p of participants) {
        if (!readBy.includes(p)) $inc[unreadKey(p)] = 1;
    }
    await conversationModel.updateOne(
        { _id: conversationId },
        { $set: { lastMessage: message._id }, ...(Object.keys($inc).length ? { $inc } : {}) }
    );

    const populatedMessage = await messageModel
        .findById(message._id)
        .populate({ path: 'senderId', select: 'name _id' })
        .populate({ path: 'replyTo', populate: { path: 'senderId', select: 'name _id' } })
        .lean();

    // The message goes to everyone who has the chat open...
    io?.to(conversationRoom(conversationId)).emit('new-message', populatedMessage);
    // ...and every participant's list row + unread badge is updated, wherever they are in the app.
    await emitConversationUpdate(io, conversationId);

    // Browser push for everybody who is NOT looking at this chat right now.
    // IMPORTANT: it is no longer limited to users without a socket. On phones the socket stays "connected"
    // for a while after the screen locks / the app is switched (or the tab is frozen), so those users were
    // wrongly treated as online and never got a push. Duplicates are avoided because the page notification
    // and the push use the same `tag` (chat-<conversationId>): the newer one replaces the older one.
    // Runs in the background: sending is not slowed down.
    void (async () => {
        const senderName: string = (populatedMessage as any)?.senderId?.name ?? 'New message';
        const recipients: string[] = participants.filter(p => !readBy.includes(p));
        await sendPushToUsers(recipients, {
            title: conversation.type === 'group' ? `${conversation.name || 'Group'} · ${senderName}` : senderName,
            body: text ? text.slice(0, 120) : 'Sent an attachment',
            url: `/chat?conversationId=${conversationId}`,
            tag: `chat-${conversationId}`,
        });
    })().catch(err => console.error('Push notification error:', err));

    res.status(201).json({ success: true, message: 'Message sent', data: populatedMessage });
};

// GET /api/chat/message/:conversationId?limit=50&before=<messageId>&markRead=true
// Returns the newest `limit` messages (oldest first). Pass `before` = the oldest message you have to load older ones.
// Fetching messages no longer marks them read by itself: call PATCH /conversation/:id/read (or add markRead=true).
export const getMessages = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const conversationId = paramId(req, 'conversationId');
    await loadMemberConversation(conversationId, auth.id);

    const limit = Math.min(100, Math.max(1, parseInt(queryString(req.query.limit) ?? '50', 10) || 50));

    const filter: Record<string, unknown> = { conversationId: new Types.ObjectId(conversationId) };

    const before = queryString(req.query.before);
    if (before) {
        const reference = await messageModel
            .findOne({ _id: asObjectId(before, 'before'), conversationId })
            .select('createdAt')
            .lean();
        if (!reference) throw badRequest('before is not a message of this conversation');

        filter.$or = [
            { createdAt: { $lt: reference.createdAt } },
            { createdAt: reference.createdAt, _id: { $lt: reference._id } },
        ];
    }

    const rows = await messageModel
        .find(filter)
        .populate({ path: 'senderId', select: 'name _id' })
        .populate({ path: 'replyTo', populate: { path: 'senderId', select: 'name _id' } })
        .sort({ createdAt: -1, _id: -1 })
        .limit(limit + 1)
        .lean();

    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse();

    if (queryString(req.query.markRead) === 'true') {
        await markConversationAsRead(getIO(req), conversationId, auth.id);
    }

    res.status(200).json({
        success: true,
        message: 'Messages retrieved',
        data: messages,
        pagination: { limit, hasMore, nextCursor: hasMore ? messages[0]?._id ?? null : null },
    });
};

// DELETE /api/chat/message/:id  - the sender or an admin
export const deleteMessage = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);

    const message = await messageModel.findById(id);
    if (!message) throw notFound('Message not found');

    const senderId = String(message.senderId);
    if (senderId !== auth.id && !isAdmin(auth)) throw forbidden('Access denied');

    const conversationId = String(message.conversationId);
    const conversation = await conversationModel.findById(conversationId).select('participents').lean();

    await messageModel.findByIdAndDelete(id);

    // Everyone who had NOT read this message loses one unread (never below zero).
    if (conversation) {
        const readers = new Set(message.readBy.map(String));
        const ops = conversation.participents
            .map(String)
            .filter(p => p !== senderId && !readers.has(p))
            .map(p => ({
                updateOne: {
                    filter: { _id: conversationId, [unreadKey(p)]: { $gt: 0 } },
                    update: { $inc: { [unreadKey(p)]: -1 } },
                    timestamps: false,
                },
            }));
        if (ops.length > 0) await conversationModel.bulkWrite(ops as any);
    }

    // Last message of the conversation = newest remaining one
    const latest = await messageModel.findOne({ conversationId }).sort({ createdAt: -1, _id: -1 }).select('_id').lean();
    await conversationModel.updateOne({ _id: conversationId }, { $set: { lastMessage: latest?._id ?? null } });

    await removeAttachments(message.attachments ?? []);

    const io = getIO(req);
    io?.to(conversationRoom(conversationId)).emit('message-deleted', { messageId: id, conversationId });
    await emitConversationUpdate(io, conversationId);

    res.status(200).json({ success: true, message: 'Message deleted' });
};

/* ------------------------------------------------------------------ */
/* Participants (groups only)                                          */
/* ------------------------------------------------------------------ */

// GET /api/chat/conversation/:id/participants
export const getParticipants = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);

    const conversation: any = await conversationModel
        .findById(paramId(req))
        .populate({ path: 'participents', select: '-password' })
        .lean();
    if (!conversation) throw notFound('Conversation not found');
    if (!isMember(conversation, auth.id)) throw forbidden('Access denied');

    res.status(200).json({ success: true, data: conversation.participents });
};

// POST /api/chat/conversation/:id/participants   { userId }
export const addParticipant = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);
    if (!isAdmin(auth)) throw forbidden('Only admins can add participants');

    const newUserId = req.body?.userId;
    if (!isObjectId(newUserId)) throw badRequest('userId is not a valid id');

    const conversation = await conversationModel.findById(id);
    if (!conversation) throw notFound('Conversation not found');
    if (conversation.type !== 'group') throw badRequest('Participants can only be added to group conversations');
    if (isMember(conversation, newUserId)) throw badRequest('User already in conversation');

    await assertUsersExist([newUserId]);

    await conversationModel.updateOne(
        { _id: id },
        { $addToSet: { participents: new Types.ObjectId(newUserId) }, $set: { [unreadKey(newUserId)]: 0 } }
    );

    const everyone = [...conversation.participents.map(String), newUserId];
    await notifyMembershipChange(getIO(req), id, everyone, [newUserId], []);

    res.status(200).json({
        success: true,
        message: 'Participant added',
        data: await populateConversation(id, auth.id),
    });
};

// DELETE /api/chat/conversation/:id/participants/:userId
export const removeParticipant = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const id = paramId(req);
    const removeUserId = paramId(req, 'userId');
    if (!isAdmin(auth)) throw forbidden('Only admins can remove participants');

    const conversation = await conversationModel.findById(id);
    if (!conversation) throw notFound('Conversation not found');
    if (conversation.type !== 'group') throw badRequest('Participants can only be removed from group conversations');
    if (removeUserId === auth.id) throw badRequest('Cannot remove yourself');
    if (!isMember(conversation, removeUserId)) throw badRequest('User not in conversation');
    if (conversation.participents.length <= 2) throw badRequest('A group needs at least two participants');

    await conversationModel.updateOne(
        { _id: id },
        { $pull: { participents: new Types.ObjectId(removeUserId) }, $unset: { [unreadKey(removeUserId)]: '' } }
    );

    const everyone = conversation.participents.map(String);
    await notifyMembershipChange(getIO(req), id, everyone, [], [removeUserId]);

    res.status(200).json({
        success: true,
        message: 'Participant removed',
        data: await populateConversation(id, auth.id),
    });
};

/* ------------------------------------------------------------------ */
/* Attachments                                                         */
/* ------------------------------------------------------------------ */

// GET /api/chat/messages/:messageId/attachments/:attachmentIndex/download
export const downloadMessageAttachment = async (req: Request, res: Response): Promise<void> => {
    const auth = getAuth(req);
    const messageId = paramId(req, 'messageId');

    const rawIndex = req.params.attachmentIndex;
    const index = Number(Array.isArray(rawIndex) ? rawIndex[0] : rawIndex);
    if (!Number.isInteger(index) || index < 0) throw badRequest('Invalid attachment index');

    const message = await messageModel.findById(messageId).lean();
    if (!message) throw notFound('Message not found');

    const conversation = await conversationModel.findById(message.conversationId).select('participents').lean();
    if (!conversation) throw notFound('Conversation not found');
    if (!isMember(conversation, auth.id) && !isAdmin(auth)) throw forbidden('Access denied');

    const attachment = (message.attachments ?? [])[index] as
        | { public_id?: string; resource_type?: string; filename?: string }
        | undefined;
    if (!attachment) throw notFound('Attachment not found');
    if (!attachment.public_id) throw notFound('Cloudinary public ID not found');

    const filename = (attachment.filename || 'download').replace(/[\r\n"]/g, '').trim() || 'download';
    const resourceType =
        attachment.resource_type === 'image' ? 'image' : attachment.resource_type === 'video' ? 'video' : 'raw';

    const signedUrl = cloudinary.url(attachment.public_id, {
        resource_type: resourceType,
        type: 'upload',
        secure: true,
        sign_url: true,
    });

    const upstream = await fetch(signedUrl);
    if (!upstream.ok) {
        console.error('Cloudinary download failed:', upstream.status, upstream.statusText);
        res.status(502).json({ success: false, message: 'Unable to download file' });
        return;
    }
    if (!upstream.body) {
        res.status(502).json({ success: false, message: 'Cloudinary returned an empty file' });
        return;
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    Readable.fromWeb(upstream.body as any).pipe(res);
};
