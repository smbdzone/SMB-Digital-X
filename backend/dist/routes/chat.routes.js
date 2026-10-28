import express from 'express';
import { createConversation, getConversation, getConversationById, updateConversation, markAsRead, deleteConversation, createMessage, getMessages, deleteMessage, getParticipants, addParticipant, removeParticipant, downloadMessageAttachment, } from '../controller/chat.controller.js';
import { isVerified } from '../middlewares/isVerified.js';
import { upload } from '../middlewares/multer.js';
const router = express.Router();
// Conversation routes
router.post('/conversation', isVerified, createConversation);
router.get('/conversation', isVerified, getConversation);
router.get('/conversation/:id', isVerified, getConversationById);
router.patch('/conversation/:id/read', isVerified, markAsRead);
router.patch('/conversation/:id', isVerified, updateConversation);
router.delete('/conversation/:id', isVerified, deleteConversation);
// Participant routes (only for group chats)
router.get('/conversation/:id/participants', isVerified, getParticipants);
router.post('/conversation/:id/participants', isVerified, addParticipant);
router.delete('/conversation/:id/participants/:userId', isVerified, removeParticipant);
// Message routes - use upload.array('files', 5) for multiple files
router.post('/message', isVerified, upload.array('files', 5), createMessage);
router.get('/message/:conversationId', isVerified, getMessages);
router.delete('/message/:id', isVerified, deleteMessage);
router.get('/messages/:messageId/attachments/:attachmentIndex/download', isVerified, downloadMessageAttachment);
export default router;
