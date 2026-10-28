'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FiTrash2, FiUserPlus, FiX } from 'react-icons/fi';
import ModalBox from '../ui/ModalBox';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  Conversation,
  ChatUser,
  getParticipants,
  addParticipant,
  removeParticipant,
  updateConversation,
  deleteConversation,
} from '@/services/chat.services';
import { fetchAllEmployees } from '@/services/auth.services';
import { errorMessage } from '@/lib/utils';

interface ParticipantModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  // Needed to know the type (individual / group), the name and who created it
  conversation?: Conversation;
  onUpdate?: () => void;
  // Called after the conversation was deleted (the chat window closes itself)
  onDeleted?: () => void;
}

const GROUP_NAME_MAX = 100;

const ParticipantModal: React.FC<ParticipantModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  conversation,
  onUpdate,
  onDeleted,
}) => {
  const { token, user } = useAuth();
  const toast = useToast();

  // the toast object changes on every render of the provider: keep it out of effect dependencies
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  });

  const [participants, setParticipants] = useState<ChatUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [employees, setEmployees] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedAdd, setSelectedAdd] = useState<string>('');
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const myId = user?.id ?? user?._id;
  const isAdmin = user?.role === 'admin';
  const isGroup = conversation?.type === 'group';

  // Backend rules:
  //  - add / remove participants: admin only, groups only
  //  - rename / delete a group: admin or the person who created it
  const canManageMembers = isAdmin && isGroup;
  const isCreator = !!conversation?.createdBy && String(conversation.createdBy) === myId;
  const canManageGroup = isGroup && (isAdmin || isCreator);

  useEffect(() => {
    if (isOpen) setGroupName(conversation?.name ?? '');
  }, [isOpen, conversation?.name]);

  useEffect(() => {
    if (!isOpen || !token) return;

    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [partsResp, empResp] = await Promise.all([
          getParticipants(token, conversationId),
          // the list of people to add is only needed by the admin of a group
          canManageMembers ? fetchAllEmployees(token) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        if (partsResp.success) setParticipants(partsResp.data || []);
        if (empResp?.success) setEmployees(empResp.data || []);
      } catch (error) {
        if (!cancelled) toastRef.current.showError(errorMessage(error, 'Failed to load participants'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [isOpen, token, conversationId, canManageMembers]);

  const handleAdd = async () => {
    if (!selectedAdd || !token) return;
    try {
      setBusy(true);
      const resp = await addParticipant(token, conversationId, selectedAdd);
      toast.showSuccess('Participant added');
      setParticipants(resp.data?.participents || []);
      setSelectedAdd('');
      setShowAdd(false);
      onUpdate?.();
    } catch (error) {
      toast.showError(errorMessage(error, 'Error adding participant'));
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (userId: string) => {
    if (!token) return;
    if (!confirm('Remove this participant?')) return;
    try {
      setBusy(true);
      const resp = await removeParticipant(token, conversationId, userId);
      toast.showSuccess('Participant removed');
      setParticipants(resp.data?.participents || []);
      onUpdate?.();
    } catch (error) {
      toast.showError(errorMessage(error, 'Error removing participant'));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!token) return;
    const name = groupName.trim();
    if (!name) {
      toast.showError('Group name is required');
      return;
    }
    try {
      setBusy(true);
      await updateConversation(token, conversationId, { name });
      toast.showSuccess('Group renamed');
      onUpdate?.();
    } catch (error) {
      toast.showError(errorMessage(error, 'Failed to rename group'));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!token) return;
    if (!confirm('Delete this group for everyone? All its messages will be removed.')) return;
    try {
      setBusy(true);
      await deleteConversation(token, conversationId);
      toast.showSuccess('Group deleted');
      onClose();
      onDeleted?.();
      onUpdate?.();
    } catch (error) {
      toast.showError(errorMessage(error, 'Failed to delete group'));
    } finally {
      setBusy(false);
    }
  };

  const availableEmployees = employees.filter(
    (emp) => !participants.some((p) => p._id === emp._id) && emp._id !== myId
  );

  const nameChanged = groupName.trim() !== '' && groupName.trim() !== (conversation?.name ?? '');

  return (
    <ModalBox
      open={isOpen}
      onClose={onClose}
      title={isGroup ? 'Group details' : 'Participants'}
      size="md"
    >
      <div className="space-y-4">
        {canManageGroup && (
          <div>
            <label className="mb-2 block text-sm font-medium text-charcoal">Group name</label>
            <div className="flex items-center gap-2">
              <input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value.slice(0, GROUP_NAME_MAX))}
                className="flex-1 rounded-lg border border-charcoal/10 p-2 text-sm outline-none focus:border-blue-500"
              />
              <button
                type="button"
                onClick={handleRename}
                disabled={!nameChanged || busy}
                className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Save
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-charcoal/40">Loading...</div>
        ) : (
          <>
            <div className="max-h-64 space-y-2 overflow-y-auto">
              {participants.map((p) => (
                <div key={p._id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    <p className="text-xs text-charcoal/40">{p.email}</p>
                  </div>
                  {canManageMembers && p._id !== myId && participants.length > 2 && (
                    <button
                      type="button"
                      onClick={() => handleRemove(p._id)}
                      disabled={busy}
                      className="rounded-full p-1 text-red-500 hover:bg-red-50 disabled:opacity-40"
                      title="Remove participant"
                    >
                      <FiX />
                    </button>
                  )}
                </div>
              ))}
            </div>

            {canManageMembers && (
              <div className="border-t pt-4">
                {!showAdd ? (
                  <button
                    type="button"
                    onClick={() => setShowAdd(true)}
                    className="flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    <FiUserPlus /> Add Participant
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <select
                      value={selectedAdd}
                      onChange={(e) => setSelectedAdd(e.target.value)}
                      className="flex-1 rounded-lg border border-charcoal/10 p-2 text-sm outline-none focus:border-blue-500"
                    >
                      <option value="">Select employee</option>
                      {availableEmployees.map((emp) => (
                        <option key={emp._id} value={emp._id}>
                          {emp.name} ({emp.email})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAdd}
                      disabled={!selectedAdd || busy}
                      className="rounded-lg bg-blue-500 px-4 py-2 text-sm text-white disabled:opacity-40"
                    >
                      Add
                    </button>
                    <button
                      onClick={() => setShowAdd(false)}
                      className="rounded-lg border border-charcoal/10 px-4 py-2 text-sm"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )}

            {canManageGroup && (
              <div className="border-t pt-4">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={busy}
                  className="flex items-center gap-2 text-sm font-medium text-red-600 hover:text-red-700 disabled:opacity-40"
                >
                  <FiTrash2 /> Delete group
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ModalBox>
  );
};

export default ParticipantModal;
