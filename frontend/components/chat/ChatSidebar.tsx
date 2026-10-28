'use client';

import React, { useEffect, useMemo, useState } from 'react';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
  FiSearch,
  FiPlus,
  FiMessageCircle,
  FiUsers,
  FiUser,
  FiImage,
  FiPaperclip,
  FiVideo,
  FiX,
} from 'react-icons/fi';

import { useChat } from '@/context/ChatContext';
import ConversationForm from './ConversationForm';
import ModalBox from '../ui/ModalBox';
import { fetchAllEmployees } from '@/services/auth.services';
import { useAuth } from '@/context/AuthContext';
import { Conversation, createConversation } from '@/services/chat.services';
import { useToast } from '@/context/ToastContext';
import { errorMessage } from '@/lib/utils';

interface ChatSidebarProps {
  onCreateGroup?: () => void;
}

const ChatSidebar = ({ onCreateGroup }: ChatSidebarProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // unreadCounts = this user's unread messages per conversation (from the server, kept live by the socket)
  const { conversations, loading, unreadCounts, allConversations } = useChat();

  const { token, user } = useAuth();
  const toast = useToast();
  const myId = user?.id ?? user?._id;

  const [search, setSearch] = useState('');

  const [employees, setEmployees] = useState<any[]>([]);
  const [openModal, setOpenModal] = useState(false);
  const [openType, setOpenType] = useState<'individual' | 'group' | null>(null);

  useEffect(() => {
    if (!token) return;
    const loadEmployees = async () => {
      try {
        const response = await fetchAllEmployees(token);
        if (response.success) {
          setEmployees(response.data || []);
        }
      } catch (error) {
        console.error('Failed to load employees', error);
      }
    };
    void loadEmployees();
  }, [token]);

  const activeConversationId = searchParams.get('conversationId');

  // --------------------------------------------------------
  // Conversation name
  // Individual chats show the OTHER person (matched by id, not by name).
  // --------------------------------------------------------

  const getConversationName = (conversation: Conversation) => {
    if (conversation.type === 'group') {
      return conversation.name || 'Group';
    }

    const other = conversation.participents?.find((participant) => participant._id !== myId);
    return other?.name || 'Conversation';
  };

  // --------------------------------------------------------
  // Search conversations
  // --------------------------------------------------------

  const filteredConversations = useMemo(() => {
    if (!search.trim()) {
      return conversations;
    }

    const query = search.trim().toLowerCase();

    return conversations.filter((conversation) => {
      const name =
        conversation.type === 'group'
          ? conversation.name || ''
          : conversation.participents
              ?.filter((participant) => participant._id !== myId)
              .map((participant) => participant?.name || '')
              .join(' ') || '';

      const lastMessage = conversation.lastMessage?.text || '';

      return name.toLowerCase().includes(query) || lastMessage.toLowerCase().includes(query);
    });
  }, [conversations, search, myId]);

  // The context keeps the list ordered (newest activity first); sort again as a safety measure.
  const sortedConversations = useMemo(() => {
    return [...filteredConversations].sort((a, b) => {
      const dateA = new Date(a.updatedAt || a.lastMessage?.createdAt || 0).getTime();
      const dateB = new Date(b.updatedAt || b.lastMessage?.createdAt || 0).getTime();
      return dateB - dateA;
    });
  }, [filteredConversations]);

  // --------------------------------------------------------
  // Last message preview
  // --------------------------------------------------------

  const getLastMessage = (conversation: Conversation) => {
    const message = conversation.lastMessage;

    if (!message) {
      return 'No messages yet';
    }

    const sender = message.senderId;
    const senderIsMe = !!sender && sender._id === myId;
    const prefix = senderIsMe
      ? 'You: '
      : conversation.type === 'group' && sender?.name
        ? `${sender.name}: `
        : '';

    if (message.text?.trim()) {
      return `${prefix}${message.text}`;
    }

    const first = message.attachments?.[0];
    if (first) {
      const type = first.resource_type || '';
      const Icon = type === 'image' ? FiImage : type === 'video' ? FiVideo : FiPaperclip;
      const label = type === 'image' ? 'Photo' : type === 'video' ? 'Video' : 'File';

      return (
        <span className="flex items-center gap-1">
          <Icon size={13} />
          {prefix}
          {label}
        </span>
      );
    }

    return 'New message';
  };

  // --------------------------------------------------------
  // Message time
  // --------------------------------------------------------

  const getMessageTime = (conversation: Conversation) => {
    const date = conversation.lastMessage?.createdAt || conversation.updatedAt;

    if (!date) {
      return '';
    }

    const messageDate = new Date(date);

    if (Number.isNaN(messageDate.getTime())) {
      return '';
    }

    const now = new Date();
    const isToday = messageDate.toDateString() === now.toDateString();

    if (isToday) {
      return messageDate.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
    }

    return messageDate.toLocaleDateString([], {
      day: '2-digit',
      month: 'short',
    });
  };

  const handleCreateConversation = async (
    participantIds: string[],
    type: 'individual' | 'group',
    name?: string
  ) => {
    if (!token) return;
    try {
      const response = await createConversation(token, {
        participents: participantIds,
        type,
        name,
      });
      toast.showSuccess(
        type === 'group' ? 'Group created successfully' : 'Conversation started successfully'
      );
      setOpenModal(false);
      setOpenType(null);
      // make sure the new conversation is in the list before it is opened
      await allConversations();
      if (response.data) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('conversationId', response.data._id);
        router.replace(`${pathname}?${params.toString()}`);
      }
    } catch (error) {
      console.error(error);
      toast.showError(errorMessage(error, 'Failed to create conversation'));
    }
  };

  // --------------------------------------------------------
  // Select conversation
  // (the chat window joins the room and marks the conversation as read on the server)
  // --------------------------------------------------------

  const selectConversation = (conversation: Conversation) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('conversationId', conversation._id);
    router.replace(`${pathname}?${params.toString()}`);
  };

  const clearSearch = () => {
    setSearch('');
  };

  // --------------------------------------------------------
  // Loading
  // --------------------------------------------------------

  if (loading) {
    return (
      <aside className="flex h-full w-full flex-col border-r border-zinc-200 bg-white">
        {/* Header */}
        <div className="border-b border-zinc-200 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div className="h-6 w-28 animate-pulse rounded bg-zinc-200" />

            <div className="h-9 w-9 animate-pulse rounded-lg bg-zinc-200" />
          </div>

          <div className="h-10 w-full animate-pulse rounded-xl bg-zinc-100" />
        </div>

        {/* Conversations */}
        <div className="space-y-2 p-3">
          {Array.from({ length: 7 }).map((_, index) => (
            <div key={index} className="flex items-center gap-3 p-2">
              <div className="h-12 w-12 animate-pulse rounded-full bg-zinc-200" />

              <div className="flex-1 space-y-2">
                <div className="h-4 w-32 animate-pulse rounded bg-zinc-200" />

                <div className="h-3 w-24 animate-pulse rounded bg-zinc-100" />
              </div>
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className=" border-r border-zinc-200 bg-white col-span-1 flex h-[79dvh] flex-col gap-3 overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-charcoal">
      {/* HEADER */}
      <div className="border-b border-zinc-200 p-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Messages</h2>

            <p className="mt-0.5 text-xs text-zinc-500">
              {conversations.length} conversation
              {conversations.length !== 1 ? 's' : ''}
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setOpenModal(true);
              setOpenType(null);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
            title="Create new conversation"
          >
            <FiPlus size={18} />
          </button>
        </div>

        {/* SEARCH */}
        <div className="relative">
          <FiSearch
            size={17}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
          />

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="h-10 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-9 pr-9 text-sm text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-blue-400 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />

          {search && (
            <button
              type="button"
              onClick={clearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-700"
            >
              <FiX size={16} />
            </button>
          )}
        </div>
      </div>

      {/* CONVERSATIONS */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sortedConversations.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-zinc-100">
              {search ? (
                <FiSearch size={23} className="text-zinc-400" />
              ) : (
                <FiMessageCircle size={23} className="text-zinc-400" />
              )}
            </div>

            <h3 className="text-sm font-semibold text-zinc-800">
              {search ? 'No conversations found' : 'No conversations'}
            </h3>

            <p className="mt-1 text-xs text-zinc-500">
              {search ? 'Try a different search.' : 'Your conversations will appear here.'}
            </p>

            {!search && onCreateGroup && (
              <button
                type="button"
                onClick={onCreateGroup}
                className="mt-4 flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-blue-700"
              >
                <FiPlus size={14} />
                Create group
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-0.5 p-2">
            {sortedConversations.map((conversation) => {
              const isActive = activeConversationId === conversation._id;

              const unread = unreadCounts[conversation._id] || 0;

              return (
                <button
                  key={conversation._id}
                  type="button"
                  onClick={() => selectConversation(conversation)}
                  className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
                    isActive ? 'bg-blue-50' : 'hover:bg-zinc-50'
                  }`}
                >
                  {/* AVATAR */}
                  <div className="relative shrink-0">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-full ${
                        conversation.type === 'group' ? 'bg-blue-100' : 'bg-zinc-100'
                      }`}
                    >
                      {conversation.type === 'group' ? (
                        <FiUsers size={20} className="text-blue-700" />
                      ) : (
                        <FiUser size={20} className="text-zinc-500" />
                      )}
                    </div>
                  </div>

                  {/* CONTENT */}
                  <div className="min-w-0 flex-1">
                    {/* Name + Time */}
                    <div className="flex items-center justify-between gap-2">
                      <h3
                        className={`truncate text-sm ${
                          unread > 0
                            ? 'font-semibold text-zinc-950'
                            : 'font-medium text-zinc-800'
                        }`}
                      >
                        {getConversationName(conversation)}
                      </h3>

                      <span
                        className={`shrink-0 text-[10px] ${
                          unread > 0 ? 'font-medium text-blue-600' : 'text-zinc-400'
                        }`}
                      >
                        {getMessageTime(conversation)}
                      </span>
                    </div>

                    {/* Message + unread */}
                    <div className="mt-1 flex items-center gap-2">
                      <div
                        className={`min-w-0 flex-1 truncate text-xs ${
                          unread > 0 ? 'font-medium text-zinc-700' : 'text-zinc-500'
                        }`}
                      >
                        {getLastMessage(conversation)}
                      </div>

                      {unread > 0 && (
                        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold leading-none text-white">
                          {unread > 99 ? '99+' : unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <ModalBox
        open={openModal}
        onClose={() => {
          setOpenModal(false);
          setOpenType(null);
        }}
        title={
          openType === 'individual'
            ? 'Start Conversation'
            : openType === 'group'
              ? 'Create Group'
              : 'New Conversation'
        }
        size="md"
      >
        {!openType ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setOpenType('individual')}
              className="flex w-full items-center gap-4 rounded-xl border border-charcoal/10 p-4 text-left hover:border-blue-400 hover:bg-blue-50"
            >
              <FiMessageCircle />
              <div>
                <h4 className="text-sm font-semibold">Start Conversation</h4>
                <p className="mt-1 text-xs text-charcoal/40">Start a private conversation.</p>
              </div>
            </button>
            {user?.role === 'admin' && (
              <button
                type="button"
                onClick={() => setOpenType('group')}
                className="flex w-full items-center gap-4 rounded-xl border border-charcoal/10 p-4 text-left hover:border-blue-400 hover:bg-blue-50"
              >
                <FiUsers />
                <div>
                  <h4 className="text-sm font-semibold">Create Group</h4>
                  <p className="mt-1 text-xs text-charcoal/40">Create a group with employees.</p>
                </div>
              </button>
            )}
          </div>
        ) : (
          <ConversationForm
            type={openType}
            employees={employees}
            currentUserId={myId}
            loading={false}
            onBack={() => setOpenType(null)}
            onSubmit={handleCreateConversation}
          />
        )}
      </ModalBox>
    </aside>
  );
};

export default ChatSidebar;
