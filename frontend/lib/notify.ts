// Browser notifications shown while the website is open (any page).
// For a closed website see lib/push.ts (Web Push).

export const ensureNotificationPermission = async (): Promise<NotificationPermission | 'unsupported'> => {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported'
    if (Notification.permission === 'default') return Notification.requestPermission()
    return Notification.permission
}

// renotify / vibrate are valid in browsers but missing from some TypeScript DOM typings
type ChatNotificationOptions = NotificationOptions & { renotify?: boolean; vibrate?: number[] }

/**
 * Shows a chat notification. Never throws.
 * It goes through the service worker (registration.showNotification) because Android Chrome does NOT allow
 * `new Notification()` (it throws "Illegal constructor") and iOS only supports the service worker way.
 * `new Notification()` stays as a fallback for desktop browsers where no service worker is registered yet.
 */
export const showChatNotification = async (opts: { title: string; body: string; conversationId: string }): Promise<void> => {
    if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return

    const url = `/chat?conversationId=${opts.conversationId}`
    // same tag = a newer message of the same chat replaces the old notification (it also de-duplicates with Web Push)
    const tag = `chat-${opts.conversationId}`

    try {
        const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration('/sw.js') : undefined

        if (registration) {
            const options: ChatNotificationOptions = {
                body: opts.body,
                tag,
                renotify: true, // a new message in the same chat still makes sound/vibration
                icon: '/icon-192-1.png',
                badge: '/badge-72-1.png',
                data: { url },
            }
            await registration.showNotification(opts.title, options)
            return
        }

        // Fallback (desktop only): no service worker registered
        const notification = new Notification(opts.title, { body: opts.body, tag, icon: '/icon-192-1.png' })
        notification.onclick = () => {
            window.focus()
            window.location.assign(url)
            notification.close()
        }
    } catch (error) {
        console.warn('Could not show chat notification:', error)
    }
}
