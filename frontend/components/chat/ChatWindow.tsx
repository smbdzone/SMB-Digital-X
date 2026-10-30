'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { FiSend, FiSettings, FiPaperclip, FiX, FiDownload, FiLoader, FiTrash2 } from 'react-icons/fi';
import { IoMdArrowRoundBack } from 'react-icons/io';
import {
    FaFilePdf, FaFileWord, FaFileExcel, FaFileImage,
    FaFileVideo, FaFileAudio, FaFileArchive, FaFilePowerpoint, FaFile,
} from 'react-icons/fa';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import {
    fetchMessages,
    sendMessage,
    deleteMessage,
    downloadAttachment,
    Message,
} from '@/services/chat.services';
import { useChat } from '@/context/ChatContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { socket } from '@/lib/socket';
import { errorMessage } from '@/lib/utils';
import ParticipantModal from './ParticipantModal';

// Limits enforced by the backend (multer + chat.controller)
const MAX_FILES = 5;                    // upload.array('files', 5)
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_TEXT = 5000;                  // message text
const PAGE_SIZE = 50;                   // GET /chat/message returns the newest 50 by default

const getFileExtension = (filename?: string) => {
    if (!filename) return '';
    const parts = filename.split('.');
    if (parts.length < 2) return '';
    return parts.pop()?.toLowerCase() || '';
};

const getFileIcon = (filename?: string) => {
    const ext = getFileExtension(filename);

    switch (ext) {
        case 'pdf':
            return <FaFilePdf className="size-4 text-red-500" />;
        case 'doc':
        case 'docx':
            return <FaFileWord className="size-4 text-blue-600" />;
        case 'xls':
        case 'xlsx':
        case 'csv':
            return <FaFileExcel className="size-4 text-green-600" />;
        case 'ppt':
        case 'pptx':
            return <FaFilePowerpoint className="size-4 text-orange-500" />;
        case 'jpg':
        case 'jpeg':
        case 'png':
        case 'gif':
        case 'webp':
        case 'bmp':
        case 'svg':
        case 'ico':
        case 'tiff':
        case 'tif':
            return <FaFileImage className="size-4 text-green-600" />;
        case 'mp4':
        case 'webm':
        case 'mov':
        case 'avi':
        case 'mkv':
        case 'm4v':
            return <FaFileVideo className="size-4 text-purple-600" />;
        case 'mp3':
        case 'wav':
        case 'ogg':
        case 'aac':
        case 'm4a':
        case 'flac':
            return <FaFileAudio className="size-4 text-pink-500" />;
        case 'zip':
        case 'rar':
        case '7z':
        case 'tar':
        case 'gz':
            return <FaFileArchive className="size-4 text-yellow-600" />;
        default:
            return <FaFile className="size-4 text-gray-500" />;
    }
};


const formatTime = (date: string) =>
    new Date(date).toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        month: '2-digit',
        day: '2-digit',
    });

// Adds messages to a list without duplicates (the same message can arrive from the HTTP response,
// the socket and a re-fetch) and keeps them oldest -> newest.
const mergeMessages = (current: Message[], incoming: Message[]): Message[] => {
    const byId = new Map<string, Message>();
    current.forEach((msg) => byId.set(msg._id, msg));
    incoming.forEach((msg) => byId.set(msg._id, msg));

    return Array.from(byId.values()).sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return diff !== 0 ? diff : a._id.localeCompare(b._id);
    });
};

// Joins the conversation's socket room. Only people who joined the room receive `new-message`
// and are counted as having read a message the moment it arrives. Never throws.
const joinRoom = (conversationId: string): Promise<{ ok: boolean; message?: string }> =>
    new Promise((resolve) => {
        if (!socket.connected) {
            resolve({ ok: false, message: 'offline' });
            return;
        }

        socket
            .timeout(4000)
            .emit(
                'join-conversation',
                conversationId,
                (err: Error | null, result?: { ok: boolean; message?: string }) => {
                    if (err) {
                        resolve({ ok: false, message: 'timeout' });
                        return;
                    }
                    resolve(result ?? { ok: false });
                }
            );
    });

const ChatWindow = () => {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const conversationId = searchParams.get('conversationId');

    const { conversations, initialized, clearUnread, markRead, allConversations } = useChat();
    const { user, token } = useAuth();
    const toast = useToast();
    const myId = user?.id ?? user?._id;
    const isAdmin = user?.role === 'admin';

    // Latest values for async code / socket handlers, without re-running their effects.
    const toastRef = useRef(toast);
    const myIdRef = useRef(myId);
    useEffect(() => {
        toastRef.current = toast;
        myIdRef.current = myId;
    });

    const containerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    // set before older messages are prepended, used to keep the scroll position
    const restoreScrollRef = useRef<{ height: number; top: number } | null>(null);
    // true while a chat is being opened: scroll to the newest message once it is rendered
    const initialScrollRef = useRef(false);
    // true while the user is at the bottom: keeps the view there when images/videos finish loading
    const pinnedRef = useRef(false);
    // the message input (used to focus it when the user starts typing anywhere)
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    // set when a message is sent so the input gets focus back once it is enabled again
    const refocusAfterSendRef = useRef(false);

    const [messages, setMessages] = useState<Message[]>([]);
    const [hasMore, setHasMore] = useState(false);
    const [message, setMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [sending, setSending] = useState(false);
    const [newMessages, setNewMessages] = useState(0);
    const [showParticipantModal, setShowParticipantModal] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [downloadingFile, setDownloadingFile] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);

    const conversation = conversations.find((c) => c._id === conversationId);

    // ============================================================
    // CLOSE CHAT
    // ============================================================

    const closeChat = useCallback(() => {
        const params = new URLSearchParams(searchParams.toString());
        params.delete('conversationId');
        router.replace(params.toString() ? `${pathname}?${params}` : pathname);
    }, [router, pathname, searchParams]);

    // The conversation was deleted, or I was removed from it, while it was open.
    useEffect(() => {
        if (conversationId && initialized && !conversation) {
            closeChat();
            toastRef.current.showInfo('This conversation is no longer available');
        }
    }, [conversationId, initialized, conversation, closeChat]);

    // ============================================================
    // SCROLL
    // ============================================================

    const isNearBottom = useCallback(() => {
        const container = containerRef.current;
        if (!container) return true;
        return container.scrollHeight - container.scrollTop - container.clientHeight < 120;
    }, []);

    const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
        const container = containerRef.current;
        if (!container) return;
        container.scrollTo({ top: container.scrollHeight, behavior });
        setNewMessages(0);
    }, []);

    // Images / videos change the height when they finish loading: stay at the bottom if the user is there.
    const keepPinned = () => {
        const container = containerRef.current;
        if (container && pinnedRef.current) container.scrollTop = container.scrollHeight;
    };

    // After older messages were added on top, keep what the user was looking at in place.
    useLayoutEffect(() => {
        const restore = restoreScrollRef.current;
        const container = containerRef.current;
        if (restore && container) {
            container.scrollTop = container.scrollHeight - restore.height + restore.top;
            restoreScrollRef.current = null;
        }
    }, [messages]);

    // First open of a chat: jump to the newest message AFTER the messages are rendered (no animation).
    useLayoutEffect(() => {
        if (!initialScrollRef.current || loading) return;
        const container = containerRef.current;
        if (!container) return;
        container.scrollTop = container.scrollHeight;
        if (messages.length > 0) initialScrollRef.current = false;
    }, [loading, messages]);

    // ============================================================
    // OPEN CONVERSATION
    //  1. join the socket room   2. load the newest messages   3. mark the conversation as read
    // Messages are replaced by what the server returns for THIS conversation (nothing is kept from the previous chat).
    // ============================================================

    useEffect(() => {
        if (!token || !conversationId) {
            setMessages([]);
            setHasMore(false);
            return;
        }

        let cancelled = false;
        initialScrollRef.current = true;
        pinnedRef.current = true;
        setMessages([]);
        setHasMore(false);
        setNewMessages(0);
        setLoading(true);
        clearUnread(conversationId); // the badge disappears immediately

        const open = async () => {
            try {
                const joined = await joinRoom(conversationId);
                if (cancelled) return;
                if (!joined.ok && joined.message && joined.message !== 'offline' && joined.message !== 'timeout') {
                    toastRef.current.showError(joined.message);
                }

                const response = await fetchMessages(token, conversationId, { limit: PAGE_SIZE });
                if (cancelled) return;

                const loaded = response.data ?? [];
                // realtime messages that arrived while loading are kept
                setMessages((prev) => mergeMessages(prev, loaded));
                setHasMore(Boolean(response.pagination?.hasMore));

                // Fetching messages does not mark them read on the backend: do it explicitly.
                void markRead(conversationId);
            } catch (error) {
                if (!cancelled) {
                    console.error(error);
                    toastRef.current.showError(errorMessage(error, 'Failed to load messages'));
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void open();

        return () => {
            cancelled = true;
        };
    }, [token, conversationId, clearUnread, markRead]);

    // ============================================================
    // KEEP THE ROOM JOINED (reconnects) + LEAVE ON CLOSE
    // After a reconnect the socket is in no room and may have missed messages:
    // join again and fetch the newest messages again.
    // ============================================================

    useEffect(() => {
        if (!token || !conversationId) return;

        let cancelled = false;

        const handleConnect = async () => {
            await joinRoom(conversationId);
            if (cancelled) return;
            try {
                const response = await fetchMessages(token, conversationId, { limit: PAGE_SIZE });
                if (cancelled) return;
                setMessages((prev) => mergeMessages(prev, response.data ?? []));
                void markRead(conversationId);
            } catch (error) {
                console.error(error);
            }
        };

        socket.on('connect', handleConnect);

        return () => {
            cancelled = true;
            socket.off('connect', handleConnect);
            if (socket.connected) socket.emit('leave-conversation', conversationId);
        };
    }, [token, conversationId, markRead]);

    // ============================================================
    // NOTIFICATION PERMISSION
    // ============================================================

    useEffect(() => {
        if (typeof window === 'undefined' || !('Notification' in window)) return;

        if (Notification.permission === 'default') {
            void Notification.requestPermission();
        }
    }, []);

    // ============================================================
    // TYPE ANYWHERE: pressing a character key focuses the message input,
    // so the user does not have to click it first. The key is typed into it.
    // ============================================================

    useEffect(() => {
        if (!conversationId || !conversation) return;

        const handleKeyPress = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
            if (showParticipantModal) return;

            // a printable character, or the first key of an IME composition (Urdu, Arabic, Chinese...)
            if (e.key.length !== 1 && e.key !== 'Process') return;

            const target = e.target as HTMLElement | null;
            const tag = target?.tagName;
            // already typing somewhere (this input, the search box, a form field...)
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
            // Space on a focused button / link must keep working as a click
            if ((tag === 'BUTTON' || tag === 'A') && e.key === ' ') return;

            textareaRef.current?.focus();
        };

        window.addEventListener('keydown', handleKeyPress);
        return () => window.removeEventListener('keydown', handleKeyPress);
    }, [conversationId, conversation, showParticipantModal]);

    // After sending, the input is disabled for a moment and loses focus: give it back.
    useEffect(() => {
        if (!sending && refocusAfterSendRef.current) {
            refocusAfterSendRef.current = false;
            textareaRef.current?.focus();
        }
    }, [sending]);

    // ============================================================
    // REALTIME: new-message / message-deleted / messages-read  (conversation room)
    // The unread badge is NOT handled here: the server counts a message as read for people
    // who joined the room, and the list/badges are updated by the user-room events in ChatContext.
    // ============================================================

    useEffect(() => {
        if (!conversationId) return;

        const handleMessage = (incoming: Message) => {
            if (String(incoming.conversationId) !== conversationId) return;

            const mine = incoming.senderId?._id?.toString() === myIdRef.current?.toString();
            const nearBottom = isNearBottom();

            setMessages((prev) => mergeMessages(prev, [incoming]));

            if (mine || nearBottom) {
                requestAnimationFrame(() => scrollToBottom());
            } else {
                setNewMessages((count) => count + 1);
            }

            if (
                !mine &&
                typeof window !== 'undefined' &&
                'Notification' in window &&
                Notification.permission === 'granted'
            ) {
                new Notification(incoming.senderId?.name || 'New message', {
                    body: incoming.text || 'Sent an attachment',
                });
            }
        };

        const handleDeleted = (data: { messageId: string; conversationId: string }) => {
            if (String(data.conversationId) !== conversationId) return;
            setMessages((prev) => prev.filter((msg) => msg._id !== data.messageId));
        };

        // someone opened the chat: everything is read for that user now
        const handleRead = (data: { conversationId: string; userId: string }) => {
            if (String(data.conversationId) !== conversationId || !data.userId) return;
            setMessages((prev) =>
                prev.map((msg) =>
                    (msg.readBy ?? []).includes(data.userId)
                        ? msg
                        : { ...msg, readBy: [...(msg.readBy ?? []), data.userId] }
                )
            );
        };

        socket.on('new-message', handleMessage);
        socket.on('message-deleted', handleDeleted);
        socket.on('messages-read', handleRead);

        return () => {
            socket.off('new-message', handleMessage);
            socket.off('message-deleted', handleDeleted);
            socket.off('messages-read', handleRead);
        };
    }, [conversationId, isNearBottom, scrollToBottom]);

    // ============================================================
    // LOAD OLDER MESSAGES
    // ============================================================

    const handleLoadOlder = async () => {
        if (!token || !conversationId || loadingOlder || !hasMore || messages.length === 0) return;

        const container = containerRef.current;
        setLoadingOlder(true);

        try {
            const response = await fetchMessages(token, conversationId, {
                limit: PAGE_SIZE,
                before: messages[0]._id,
            });

            if (container) {
                restoreScrollRef.current = { height: container.scrollHeight, top: container.scrollTop };
            }
            setMessages((prev) => mergeMessages(prev, response.data ?? []));
            setHasMore(Boolean(response.pagination?.hasMore));
        } catch (error) {
            console.error(error);
            toast.showError(errorMessage(error, 'Failed to load older messages'));
        } finally {
            setLoadingOlder(false);
        }
    };

    // ============================================================
    // SEND MESSAGE
    // ============================================================

    const handleSend = async () => {
        if (!token || !conversationId) return;

        const text = message.trim();
        if (!text && selectedFiles.length === 0) return;
        if (sending) return;

        refocusAfterSendRef.current = true;
        setSending(true);

        const formData = new FormData();
        formData.append('conversationId', conversationId);
        if (text) formData.append('text', text);
        selectedFiles.forEach((file) => formData.append('files', file));

        const previousMessage = message;
        const previousFiles = selectedFiles;

        setMessage('');
        setSelectedFiles([]);

        try {
            const response = await sendMessage(token, formData);

            // Show it right away from the HTTP response (the socket copy is de-duplicated by id).
            if (response.data) {
                const sent = response.data;
                setMessages((prev) => mergeMessages(prev, [sent]));
                requestAnimationFrame(() => scrollToBottom());
            }
        } catch (error) {
            console.error(error);
            toast.showError(errorMessage(error, 'Failed to send message'));
            setMessage(previousMessage);
            setSelectedFiles(previousFiles);
        } finally {
            setSending(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void handleSend();
        }
    };

    // ============================================================
    // DELETE MESSAGE (the sender or an admin)
    // ============================================================

    const handleDeleteMessage = async (messageId: string) => {
        if (!token || deletingId) return;
        if (!confirm('Delete this message?')) return;

        setDeletingId(messageId);
        try {
            await deleteMessage(token, messageId);
            setMessages((prev) => prev.filter((msg) => msg._id !== messageId));
        } catch (error) {
            console.error(error);
            toast.showError(errorMessage(error, 'Failed to delete message'));
        } finally {
            setDeletingId(null);
        }
    };

    // ============================================================
    // FILE SELECT
    // ============================================================

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;

        if (files) {
            const incoming = Array.from(files);

            const tooBig = incoming.filter((file) => file.size > MAX_FILE_SIZE);
            if (tooBig.length > 0) {
                toast.showError(
                    `${tooBig.map((file) => file.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} larger than 10 MB`
                );
            }

            const accepted = incoming.filter((file) => file.size <= MAX_FILE_SIZE);
            const next = [...selectedFiles, ...accepted];
            if (next.length > MAX_FILES) {
                toast.showError(`You can attach up to ${MAX_FILES} files per message`);
            }
            setSelectedFiles(next.slice(0, MAX_FILES));
        }

        e.target.value = '';
    };

    const removeFile = (index: number) => {
        setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
    };

    // ============================================================
    // DOWNLOAD
    // ============================================================

    const handleAttachmentDownload = async (
        messageId: string,
        attachmentIndex: number,
        filename: string | undefined,
        attachmentKey: string
    ) => {
        if (!token || downloadingFile) return;

        try {
            setDownloadingFile(attachmentKey);

            const blob = await downloadAttachment(token, messageId, attachmentIndex);
            const blobUrl = window.URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || 'download';
            link.style.display = 'none';

            document.body.appendChild(link);
            link.click();
            link.remove();

            window.URL.revokeObjectURL(blobUrl);
        } catch (error) {
            console.error('Download error:', error);
            toast.showError(error instanceof Error ? error.message : 'Failed to download file');
        } finally {
            setDownloadingFile(null);
        }
    };

    // ============================================================
    // EMPTY CHAT
    // ============================================================

    if (!conversationId || !conversation) {
        return (
            <div className="flex h-[79dvh] items-center justify-center rounded-[10px] border bg-white">
                <div className="text-center">
                    <FiSend className="mx-auto mb-4 size-8 text-gray-400" />
                    <h2 className="font-semibold text-charcoal">Select a chat</h2>
                    <p className="mt-2 text-sm text-gray-500">Choose a conversation to start messaging.</p>
                </div>
            </div>
        );
    }

    const name =
        conversation.type === 'group'
            ? conversation.name || 'Group'
            : conversation.participents?.find((p) => p._id !== myId)?.name || 'Conversation';

    // ============================================================
    // RENDER
    // ============================================================

    return (
        <>
            <div className="flex h-[79dvh] w-full flex-col overflow-hidden rounded-[10px] border border-gray-200 bg-white">
                {/* HEADER */}
                <div className="flex items-center justify-between bg-charcoal p-3 px-4 text-white">
                    <button
                        type="button"
                        onClick={closeChat}
                        className="flex items-center gap-1 rounded-2xl bg-emerald-light p-1 px-2 text-emerald"
                    >
                        <IoMdArrowRoundBack />
                        <span className="hidden sm:block">Close</span>
                    </button>

                    <div className="truncate px-3 text-sm font-semibold">{name}</div>

                    <button
                        type="button"
                        aria-label="Chat settings"
                        className="rounded-full p-2 hover:bg-white/10"
                        onClick={() => setShowParticipantModal(true)}
                    >
                        <FiSettings className="size-5" />
                    </button>
                </div>

                {/* MESSAGES */}
                <div
                    ref={containerRef}
                    onScroll={() => {
                        const near = isNearBottom();
                        pinnedRef.current = near;
                        if (near) setNewMessages(0);
                    }}
                    className="relative flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-thumb-charcoal"
                >
                    {loading ? (
                        <div className="flex h-full items-center justify-center text-sm text-charcoal/40">
                            Loading messages...
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-charcoal/40">
                            No messages yet.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {hasMore && (
                                <div className="flex justify-center">
                                    <button
                                        type="button"
                                        onClick={() => void handleLoadOlder()}
                                        disabled={loadingOlder}
                                        className="flex items-center gap-2 rounded-full bg-charcoal/5 px-4 py-1.5 text-xs font-semibold text-charcoal/70 transition hover:bg-charcoal/10 disabled:opacity-60"
                                    >
                                        {loadingOlder && <FiLoader className="size-3 animate-spin" />}
                                        {loadingOlder ? 'Loading...' : 'Load older messages'}
                                    </button>
                                </div>
                            )}

                            {messages.map((msg) => {
                                const mine = msg.senderId?._id?.toString() === myId?.toString();
                                const canDelete = mine || isAdmin;
                                const seen = mine && (msg.readBy ?? []).some((id) => id !== myId);

                                return (
                                    <div
                                        key={msg._id}
                                        data-message-id={msg._id}
                                        className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
                                    >
                                        <div
                                            className={`group/msg max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${mine
                                                    ? 'rounded-br-md bg-blue-500 text-white'
                                                    : 'rounded-bl-md bg-charcoal/[0.05] text-charcoal'
                                                }`}
                                        >
                                            {!mine && (
                                                <p className="mb-1 text-xs font-semibold text-charcoal/50">
                                                    {msg.senderId?.name}
                                                </p>
                                            )}

                                            {msg.text && (
                                                <p className="whitespace-pre-wrap break-words">{msg.text}</p>
                                            )}

                                            {msg.attachments && msg.attachments.length > 0 && (
                                                <div className="mt-2 space-y-2">
                                                    {msg.attachments.map((att, idx) => {
                                                        const attachmentKey = `${msg._id}-${idx}`;
                                                        const isDownloading = downloadingFile === attachmentKey;
                                                        const filename = att.filename || 'download';
                                                        const resourceType = att.resource_type || '';
                                                        const isImage = resourceType.startsWith('image');
                                                        const isVideo = resourceType.startsWith('video');
                                                        const isAudio = resourceType.startsWith('audio');

                                                        const downloadBtn = (
                                                            className: string,
                                                            title = 'Download'
                                                        ) => (
                                                            <button
                                                                type="button"
                                                                onClick={() =>
                                                                    handleAttachmentDownload(
                                                                        msg._id,
                                                                        idx,
                                                                        filename,
                                                                        attachmentKey
                                                                    )
                                                                }
                                                                disabled={isDownloading}
                                                                className={className}
                                                                title={title}
                                                            >
                                                                {isDownloading ? (
                                                                    <FiLoader className="size-4 animate-spin" />
                                                                ) : (
                                                                    <FiDownload className="size-4" />
                                                                )}
                                                            </button>
                                                        );

                                                        return (
                                                            <div key={attachmentKey} className="relative">
                                                                {isImage ? (
                                                                    <div className="group relative inline-block overflow-hidden rounded-lg">
                                                                        <img
                                                                            src={att.url}
                                                                            alt={filename}
                                                                            onLoad={keepPinned}
                                                                            className="max-h-64 max-w-full rounded-lg object-contain"
                                                                        />
                                                                        {downloadBtn(
                                                                            'absolute bottom-2 right-2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white opacity-0 shadow-md transition group-hover:opacity-100 hover:bg-black/80 disabled:opacity-70'
                                                                        )}
                                                                    </div>
                                                                ) : isVideo ? (
                                                                    <div className="relative inline-block">
                                                                        <video
                                                                            controls
                                                                            preload="metadata"
                                                                            onLoadedMetadata={keepPinned}
                                                                            className="max-h-64 max-w-full rounded-lg"
                                                                        >
                                                                            <source src={att.url} />
                                                                            Your browser does not support video playback.
                                                                        </video>
                                                                        {downloadBtn(
                                                                            'absolute right-2 top-2 flex size-9 items-center justify-center rounded-full bg-black/60 text-white shadow-md hover:bg-black/80 disabled:opacity-70'
                                                                        )}
                                                                    </div>
                                                                ) : isAudio ? (
                                                                    <div className="flex items-center gap-2 rounded-lg bg-charcoal/5 p-2">
                                                                        <audio controls className="max-w-full">
                                                                            <source src={att.url} />
                                                                            Your browser does not support audio playback.
                                                                        </audio>
                                                                        {downloadBtn(
                                                                            'flex size-9 shrink-0 items-center justify-center rounded-full bg-charcoal text-white hover:bg-charcoal/80 disabled:opacity-70'
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        type="button"
                                                                        onClick={() =>
                                                                            handleAttachmentDownload(
                                                                                msg._id,
                                                                                idx,
                                                                                filename,
                                                                                attachmentKey
                                                                            )
                                                                        }
                                                                        disabled={isDownloading}
                                                                        className="flex max-w-full items-center gap-3 rounded-lg bg-charcoal/5 px-3 py-2 text-xs transition hover:bg-charcoal/10 disabled:opacity-60"
                                                                    >
                                                                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white shadow-sm">
                                                                            {isDownloading ? (
                                                                                <FiLoader className="size-4 animate-spin" />
                                                                            ) : (
                                                                                getFileIcon(filename)
                                                                            )}
                                                                        </span>
                                                                        <span className="max-w-[220px] truncate text-left">
                                                                            {filename}
                                                                        </span>
                                                                        {!isDownloading && (
                                                                            <FiDownload className="ml-auto size-4 shrink-0 text-charcoal/50" />
                                                                        )}
                                                                    </button>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            <div className="mt-1 flex items-center justify-between gap-3">
                                                <p
                                                    className={`text-[10px] ${mine ? 'text-white/60' : 'text-charcoal/35'}`}
                                                >
                                                    {formatTime(msg.createdAt)}
                                                    {seen && ' · Seen'}
                                                </p>

                                                {canDelete && (
                                                    <button
                                                        type="button"
                                                        onClick={() => void handleDeleteMessage(msg._id)}
                                                        disabled={deletingId === msg._id}
                                                        title="Delete message"
                                                        className={`opacity-0 transition group-hover/msg:opacity-100 focus:opacity-100 disabled:opacity-60 ${mine ? 'text-white/70 hover:text-white' : 'text-charcoal/40 hover:text-red-500'}`}
                                                    >
                                                        {deletingId === msg._id ? (
                                                            <FiLoader className="size-3 animate-spin" />
                                                        ) : (
                                                            <FiTrash2 className="size-3" />
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {newMessages > 0 && (
                        <button
                            type="button"
                            onClick={() => scrollToBottom()}
                            className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white px-4 py-2 text-xs font-semibold shadow-lg ring-1 ring-charcoal/10"
                        >
                            ↓ {newMessages} {newMessages === 1 ? 'New message' : 'New messages'}
                        </button>
                    )}
                </div>

                {/* COMPOSER */}
                <div className="border-t border-charcoal/5 p-3">
                    {selectedFiles.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                            {selectedFiles.map((file, idx) => (
                                <div key={idx} className="flex items-center gap-1 rounded bg-charcoal/5 px-2 py-1 text-xs">
                                    <span className="max-w-24 truncate">{file.name}</span>
                                    <button type="button" onClick={() => removeFile(idx)} className="text-red-500">
                                        <FiX />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="flex items-end gap-2">
                        <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={sending || selectedFiles.length >= MAX_FILES}
                            title={`Attach files (max ${MAX_FILES}, 10 MB each)`}
                            className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-charcoal/10 hover:bg-charcoal/5 disabled:opacity-50"
                        >
                            <FiPaperclip className="size-4" />
                        </button>

                        <input
                            type="file"
                            ref={fileInputRef}
                            multiple
                            accept="*/*"
                            className="hidden"
                            onChange={handleFileSelect}
                        />

                        <textarea
                            ref={textareaRef}
                            value={message}
                            onChange={(e) => setMessage(e.target.value.slice(0, MAX_TEXT))}
                            onKeyDown={handleKeyDown}
                            rows={1}
                            disabled={sending}
                            placeholder="Write a message..."
                            className="min-h-11 max-h-32 flex-1 resize-none rounded-xl border border-charcoal/10 bg-surface px-3 py-3 text-sm outline-none focus:border-blue-500"
                        />

                        <button
                            type="button"
                            onClick={() => void handleSend()}
                            disabled={(!message.trim() && selectedFiles.length === 0) || sending}
                            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-blue-500 text-white disabled:opacity-40"
                        >
                            {sending ? <FiLoader className="size-4 animate-spin" /> : <FiSend className="size-4" />}
                        </button>
                    </div>
                </div>
            </div>

            <ParticipantModal
                isOpen={showParticipantModal}
                onClose={() => setShowParticipantModal(false)}
                conversationId={conversationId}
                conversation={conversation}
                onUpdate={allConversations}
                onDeleted={closeChat}
            />
        </>
    );
};

export default ChatWindow;
