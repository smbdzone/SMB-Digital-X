import { io } from 'socket.io-client';

/**
 * Socket URL = NEXT_PUBLIC_SOCKET_URL if set, otherwise the origin of NEXT_PUBLIC_API_URL
 * (e.g. http://localhost:5001/api -> http://localhost:5001), so it always follows the API port.
 */
const resolveSocketUrl = (): string => {
    if (process.env.NEXT_PUBLIC_SOCKET_URL) return process.env.NEXT_PUBLIC_SOCKET_URL;

    const api = process.env.NEXT_PUBLIC_API_URL;
    if (api) {
        try {
            return new URL(api).origin;
        } catch {
            // fall through to the default
        }
    }
    return 'http://localhost:5000';
};

let authToken: string | null = null;

/**
 * The backend checks the same JWT as the REST API during the socket handshake
 * and takes the user id from it. `auth` is a function so a reconnect always sends the latest token.
 */
export const socket = io(resolveSocketUrl(), {
    autoConnect: false,
    withCredentials: true,
    auth: (cb) => cb({ token: authToken }),
});

export const connectSocket = (token: string) => {
    // Token changed (new login): drop the old connection so the handshake uses the new token.
    if (authToken && authToken !== token && socket.active) socket.disconnect();
    authToken = token;
    if (!socket.active) socket.connect();
};

export const disconnectSocket = () => {
    authToken = null;
    socket.disconnect();
};
