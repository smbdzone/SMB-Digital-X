import webpush from 'web-push'
import pushSubscriptionModel from '../model/pushSubscription.model.js'

// Web Push is optional: without the VAPID keys in .env everything else keeps working.
const enabled = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)

if (enabled) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT || 'mailto:admin@example.com',
        process.env.VAPID_PUBLIC_KEY as string,
        process.env.VAPID_PRIVATE_KEY as string
    )
} else {
    console.warn('Web Push is disabled: set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to enable it.')
}

export interface PushPayload {
    title: string
    body: string
    url: string   // page opened when the notification is clicked
    tag?: string  // same tag = replaces the previous notification instead of stacking
}

/** Sends a browser push notification to every device of the given users. Never throws. */
export const sendPushToUsers = async (userIds: string[], payload: PushPayload): Promise<void> => {
    if (!enabled || userIds.length === 0) return

    const subscriptions = await pushSubscriptionModel.find({ userId: { $in: userIds } }).lean()
    const body = JSON.stringify(payload)

    await Promise.all(
        subscriptions.map(async (sub) => {
            try {
                await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: sub.keys as { p256dh: string; auth: string } },
                    body,
                    // high urgency: Android in battery-saver/Doze mode delays normal-urgency pushes by minutes.
                    // TTL: if the phone is offline, keep the message for up to 1 day instead of dropping it.
                    { TTL: 60 * 60 * 24, urgency: 'high' }
                )
            } catch (error: any) {
                // 404 / 410 = the user revoked permission or removed the browser: forget this device.
                if (error?.statusCode === 404 || error?.statusCode === 410) {
                    await pushSubscriptionModel.deleteOne({ _id: sub._id })
                } else {
                    console.error('Push notification failed:', error?.statusCode || error?.message)
                }
            }
        })
    )
}
