import mongoose, { Schema } from 'mongoose'

// One row per browser/device that agreed to receive push notifications.
const pushSubscriptionSchema = new Schema(
    {
        userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
        // Unique address of the browser's push service for this device
        endpoint: { type: String, required: true, unique: true },
        keys: {
            p256dh: { type: String, required: true },
            auth: { type: String, required: true },
        },
        userAgent: { type: String },
    },
    { timestamps: true }
)

export default mongoose.model('PushSubscription', pushSubscriptionSchema)
