import http from 'http';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import app from './index.js';
import dotenv from 'dotenv';
import conversationModel from './model/conversation.model.js';
import User from './model/user.model.js';
import { isObjectId } from './utils/http.js';
import { conversationRoom, userRoom } from './utils/chat.socket.js';
import { checkAllLetterheadAssets } from './email/letterheads.js';

dotenv.config();

const AUTH_COOKIE_NAME = 'smb-token';

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: [process.env.CLIENT_URL || 'http://localhost:3000', process.env.FRONTEND].filter(Boolean) as string[],
        credentials: true,
    },
});

app.set('io', io);

/**
 * Every socket must prove who it is with the same JWT as the REST API.
 * The client sends it as `io(url, { auth: { token } })`; an "Authorization: Bearer" header or
 * the `smb-token` cookie also work. The user id always comes from the token, never from the client.
 */
io.use(async (socket, next) => {
    try {
        let token: string | undefined = socket.handshake.auth?.token;

        if (!token) {
            const header = socket.handshake.headers.authorization;
            if (header?.startsWith('Bearer ')) token = header.split(' ')[1];
        }

        if (!token) {
            const cookie = socket.handshake.headers.cookie ?? '';
            const match = cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${AUTH_COOKIE_NAME}=`));
            if (match) token = decodeURIComponent(match.slice(AUTH_COOKIE_NAME.length + 1));
        }

        if (!token) return next(new Error('Authentication required'));

        const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id?: string; role?: string; iat?: number };
        if (!payload?.id) return next(new Error('Invalid token'));

        // Same account checks as the REST middleware (isVerified): the account must still exist and be
        // active, the token must be newer than the last password change, and the role comes from the DB.
        const account = await User.findById(payload.id).select('passwordChangedAt role status').lean();
        if (!account || account.status === 'inactive') return next(new Error('Account not available'));
        if (account.passwordChangedAt && payload.iat !== undefined
            && payload.iat < Math.floor(account.passwordChangedAt.getTime() / 1000)) {
            return next(new Error('Password was changed. Please log in again.'));
        }

        socket.data.userId = String(payload.id);
        socket.data.role = account.role;
        next();
    } catch {
        next(new Error('Invalid or expired token'));
    }
});

io.on('connection', (socket) => {
    const userId: string = socket.data.userId;

    // Personal room: unread counts, conversation list updates, "you were added/removed" events.
    socket.join(userRoom(userId));

    // Older clients still emit this; the room is already joined from the token, so it is a no-op.
    socket.on('identify-user', () => {
        socket.join(userRoom(userId));
    });

    // Only participants may listen to a conversation.
    socket.on('join-conversation', async (conversationId: string, ack?: (r: { ok: boolean; message?: string }) => void) => {
        try {
            if (!isObjectId(conversationId)) throw new Error('Invalid conversation ID');

            const allowed = await conversationModel.exists({ _id: conversationId, participents: userId });
            if (!allowed) throw new Error('Access denied');

            socket.join(conversationRoom(conversationId));
            ack?.({ ok: true });
        } catch (error) {
            ack?.({ ok: false, message: error instanceof Error ? error.message : 'Unable to join' });
        }
    });

    socket.on('leave-conversation', (conversationId: string) => {
        if (!isObjectId(conversationId)) return;
        socket.leave(conversationRoom(conversationId));
    });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Letters need backend/assets (fonts + letterhead artwork). Warn loudly at startup if it was not deployed.
checkAllLetterheadAssets();

export { io };
