import mongoose, { Document } from 'mongoose';

export interface IConversation extends Document {
  type: 'individual' | 'group';
  name?: string;
  participents: mongoose.Types.ObjectId[];
  createdBy?: mongoose.Types.ObjectId;

  unreadCount: Map<string, number>;

  lastMessage: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
  reminderSentAt: Map<string, Date>;
}

const conversationSchema = new mongoose.Schema<IConversation>(
  {
    type: {
      type: String,
      enum: ['individual', 'group'],
      required: true,
    },

    name: {
      type: String,
      trim: true,
    },

    participents: [
      {
        type: mongoose.Types.ObjectId,
        ref: 'users',
        required: true,
      },
    ],

    // Who created the conversation (can rename / delete a group besides admins).
    createdBy: {
      type: mongoose.Types.ObjectId,
      ref: 'users',
    },

    unreadCount: {
      type: Map,
      of: {
        type: Number,
        default: 0,
      },
      default: {},
    },
    reminderSentAt: { type: Map, of: Date, default: {} },

    lastMessage: {
      type: mongoose.Types.ObjectId,
      ref: 'message',
      default: null,
    },
  },
  { timestamps: true }
);

conversationSchema.index({ participents: 1 });
conversationSchema.index({ updatedAt: -1 });

const conversationModel = mongoose.model<IConversation>(
  'conversation',
  conversationSchema
);

export default conversationModel;