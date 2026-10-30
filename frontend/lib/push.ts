import { apiClient } from '@/lib/apiClient'

// Web Push: lets the server notify this browser even when the website is closed.
// Needs: public/sw.js (service worker), NEXT_PUBLIC_VAPID_PUBLIC_KEY, HTTPS (localhost is fine) and the backend /api/push routes.

const toKey = (base64: string) => {
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
    return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}

// true when the saved subscription was created with the same VAPID public key we use now
const usesSameKey = (subscription: PushSubscription, key: Uint8Array) => {
    const current = subscription.options?.applicationServerKey
    if (!current) return true
    const saved = new Uint8Array(current)
    return saved.length === key.length && saved.every((value, index) => value === key[index])
}

export const pushSupported = () =>
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window

/**
 * Asks permission (if needed), registers the service worker and saves this device on the server. Never throws.
 * On phones this must be called from a tap (button click) the first time, otherwise the permission prompt is blocked.
 */
export const enablePush = async (token: string): Promise<boolean> => {
    const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
    if (!pushSupported() || !publicKey) return false

    try {
        const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
        if (permission !== 'granted') return false

        // updateViaCache: 'none' = the browser always checks for a new sw.js (otherwise phones can keep an old copy for a long time)
        const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        await navigator.serviceWorker.ready

        const key = toKey(publicKey)
        let subscription = await registration.pushManager.getSubscription()

        // A subscription made with another VAPID key can never receive pushes: drop it and subscribe again.
        if (subscription && !usesSameKey(subscription, key)) {
            await subscription.unsubscribe()
            subscription = null
        }

        subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })

        await apiClient('/push/subscribe', { method: 'POST', token, body: JSON.stringify(subscription.toJSON()) })
        return true
    } catch (error) {
        console.warn('Push notifications could not be enabled:', error)
        return false
    }
}

/** Removes this device from the server and the browser. Call it on logout so the next person does not get these messages. */
export const disablePush = async (token: string): Promise<void> => {
    if (!pushSupported()) return

    try {
        const registration = await navigator.serviceWorker.getRegistration('/sw.js')
        const subscription = await registration?.pushManager.getSubscription()
        if (!subscription) return

        await apiClient('/push/unsubscribe', {
            method: 'POST',
            token,
            body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => { /* the server also deletes dead subscriptions by itself */ })

        await subscription.unsubscribe()
    } catch (error) {
        console.warn('Push notifications could not be disabled:', error)
    }
}
