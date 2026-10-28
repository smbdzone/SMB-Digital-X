'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/context/AuthContext';
import {
  Conversation,
  fetchConversation,
  markConversationRead,
} from '@/services/chat.services';
import { socket, connectSocket, disconnectSocket } from '@/lib/socket';

export type { Conversation } from '@/services/chat.services';

interface ConversationUpdatedEvent {
  conversationId: string;
  lastMessage: Conversation['lastMessage'];
  updatedAt: string;
  unreadCount: number;
}

interface UnreadCountUpdate {
  conversationId: string;
  unreadCount: number;
}

interface ChatContextType {
  conversations: Conversation[];
  loading: boolean;
  // true after the first successful load (used to tell "not loaded yet" from "does not exist")
  initialized: boolean;
  error: string | null;

  // { conversationId: unread messages of the logged-in user }
  unreadCounts: Record<string, number>;
  totalUnread: number;

  // Reload the list in the background (no loading skeleton)
  allConversations: () => Promise<void>;

  // Local only: set the badge to 0
  clearUnread: (conversationId: string) => void;

  // Local badge to 0 + PATCH /chat/conversation/:id/read
  markRead: (conversationId: string) => Promise<void>;

  setUnreadCount: (conversationId: string, count: number) => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const timeOf = (c: Conversation) =>
  new Date(c.updatedAt || c.lastMessage?.createdAt || 0).getTime();

const sortByRecent = (list: Conversation[]) =>
  [...list].sort((a, b) => timeOf(b) - timeOf(a));

export const ChatProvider = ({ children }: { children: React.ReactNode }) => {
  const { token } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});

  // Latest list for socket handlers (so they do not need to be re-registered on every change)
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const loadRequest = useRef(0);

  // ------------------------------------------------------------
  // Load the list. myUnreadCount comes from the server and is calculated from the messages.
  // ------------------------------------------------------------
  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!token) return;
      const requestId = ++loadRequest.current;

      try {
        if (!silent) setLoading(true);
        setError(null);

        const response = await fetchConversation(token);
        if (requestId !== loadRequest.current) return;

        const data = response.data ?? [];
        setConversations(sortByRecent(data));

        const counts: Record<string, number> = {};
        data.forEach((conversation) => {
          counts[conversation._id] = Number(conversation.myUnreadCount ?? 0);
        });
        setUnreadCounts(counts);
        setInitialized(true);
      } catch (err: any) {
        if (requestId !== loadRequest.current) return;
        console.error('Failed to fetch conversations:', err);
        setError(err?.message || 'Failed to load conversations');
      } finally {
        if (!silent && requestId === loadRequest.current) setLoading(false);
      }
    },
    [token]
  );

  const allConversations = useCallback(() => loadConversations(true), [loadConversations]);

  // Initial load / token change
  useEffect(() => {
    if (!token) {
      loadRequest.current++;
      setConversations([]);
      setUnreadCounts({});
      setInitialized(false);
      return;
    }
    void loadConversations(false);
  }, [token, loadConversations]);

  // ------------------------------------------------------------
  // Socket connection (the JWT is sent in the handshake)
  // ------------------------------------------------------------
  useEffect(() => {
    if (!token) {
      disconnectSocket();
      return;
    }
    connectSocket(token);
  }, [token]);

  // ------------------------------------------------------------
  // Socket events that go to the user's own room
  // ------------------------------------------------------------
  useEffect(() => {
    if (!token) return;

    let hasConnected = socket.connected;

    // After a reconnect we may have missed events: reload the list.
    const handleConnect = () => {
      if (hasConnected) void loadConversations(true);
      hasConnected = true;
    };

    const handleConnectError = (err: Error) => {
      console.warn('Chat socket connection failed:', err.message);
    };

    // New last message / new updatedAt / this user's unread count
    const handleConversationUpdated = (data: ConversationUpdatedEvent) => {
      if (!data?.conversationId) return;

      const known = conversationsRef.current.some((c) => c._id === data.conversationId);
      if (!known) {
        // e.g. the first message of a conversation this client has not loaded yet
        void loadConversations(true);
        return;
      }

      setConversations((prev) =>
        sortByRecent(
          prev.map((c) =>
            c._id === data.conversationId
              ? {
                  ...c,
                  lastMessage: data.lastMessage ?? null,
                  updatedAt: data.updatedAt ?? c.updatedAt,
                }
              : c
          )
        )
      );

      setUnreadCounts((prev) => ({
        ...prev,
        [data.conversationId]: Math.max(0, Number(data.unreadCount) || 0),
      }));
    };

    const handleUnreadCountUpdated = ({ conversationId, unreadCount }: UnreadCountUpdate) => {
      if (!conversationId) return;
      setUnreadCounts((prev) => ({
        ...prev,
        [conversationId]: Math.max(0, Number(unreadCount) || 0),
      }));
    };

    // Someone started a conversation with me / added me to a group
    const handleConversationCreated = (conversation: Conversation | null) => {
      if (!conversation?._id) {
        void loadConversations(true);
        return;
      }
      setConversations((prev) =>
        prev.some((c) => c._id === conversation._id)
          ? prev.map((c) => (c._id === conversation._id ? { ...c, ...conversation } : c))
          : sortByRecent([conversation, ...prev])
      );
      setUnreadCounts((prev) => ({
        ...prev,
        [conversation._id]: Number(conversation.myUnreadCount ?? 0),
      }));
    };

    // Deleted, or I was removed from it
    const handleConversationGone = ({ conversationId }: { conversationId: string }) => {
      if (!conversationId) return;
      setConversations((prev) => prev.filter((c) => c._id !== conversationId));
      setUnreadCounts((prev) => {
        if (!(conversationId in prev)) return prev;
        const next = { ...prev };
        delete next[conversationId];
        return next;
      });
    };

    // Members added / removed: the event only has ids, reload to get the populated participants
    const handleMembersUpdated = () => {
      void loadConversations(true);
    };

    socket.on('connect', handleConnect);
    socket.on('connect_error', handleConnectError);
    socket.on('conversation-updated', handleConversationUpdated);
    socket.on('unread-count-updated', handleUnreadCountUpdated);
    socket.on('conversation-created', handleConversationCreated);
    socket.on('conversation-deleted', handleConversationGone);
    socket.on('removed-from-conversation', handleConversationGone);
    socket.on('conversation-members-updated', handleMembersUpdated);

    return () => {
      socket.off('connect', handleConnect);
      socket.off('connect_error', handleConnectError);
      socket.off('conversation-updated', handleConversationUpdated);
      socket.off('unread-count-updated', handleUnreadCountUpdated);
      socket.off('conversation-created', handleConversationCreated);
      socket.off('conversation-deleted', handleConversationGone);
      socket.off('removed-from-conversation', handleConversationGone);
      socket.off('conversation-members-updated', handleMembersUpdated);
    };
  }, [token, loadConversations]);

  // ------------------------------------------------------------
  // Unread helpers
  // ------------------------------------------------------------
  const setUnreadCount = useCallback((conversationId: string, count: number) => {
    setUnreadCounts((prev) => ({
      ...prev,
      [conversationId]: Math.max(0, count),
    }));
  }, []);

  const clearUnread = useCallback((conversationId: string) => {
    setUnreadCounts((prev) => (prev[conversationId] ? { ...prev, [conversationId]: 0 } : prev));
  }, []);

  const markRead = useCallback(
    async (conversationId: string) => {
      clearUnread(conversationId);
      if (!token) return;
      try {
        await markConversationRead(token, conversationId);
      } catch (err) {
        console.error('Failed to mark conversation as read:', err);
      }
    },
    [token, clearUnread]
  );

  const totalUnread = useMemo(
    () => Object.values(unreadCounts).reduce((sum, count) => sum + (count || 0), 0),
    [unreadCounts]
  );

  return (
    <ChatContext.Provider
      value={{
        conversations,
        loading,
        initialized,
        error,
        unreadCounts,
        totalUnread,
        allConversations,
        clearUnread,
        markRead,
        setUnreadCount,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);

  if (!context) {
    throw new Error('useChat must be used inside ChatProvider');
  }

  return context;
};
