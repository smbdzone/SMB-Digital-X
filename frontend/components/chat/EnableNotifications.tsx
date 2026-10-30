'use client'

import React, { useEffect, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { enablePush, pushSupported } from '@/lib/push'

type Mode = 'hidden' | 'prompt' | 'denied' | 'ios-install'

const DISMISS_KEY = 'notifications-banner-dismissed'

const isIos = () =>
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS reports itself as a Mac
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

const isInstalledApp = () =>
    window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

/**
 * Small banner on the chat page. Browsers (especially phones) only allow the notification permission prompt
 * after a tap, so the user presses the button here instead of the site asking automatically.
 *  - iPhone/iPad: Web Push only works when the site is added to the Home Screen -> shows how.
 *  - Permission blocked: tells the user to allow it in the browser settings.
 *  - Already allowed / not supported: shows nothing.
 */
const EnableNotifications = () => {
    const { token } = useAuth()
    const [mode, setMode] = useState<Mode>('hidden')
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        if (!token || typeof window === 'undefined') return

        let dismissed = false
        try {
            dismissed = window.localStorage.getItem(DISMISS_KEY) === '1'
        } catch {
            /* storage can be blocked: just show the banner */
        }

        if (isIos() && !isInstalledApp()) {
            setMode(dismissed ? 'hidden' : 'ios-install')
            return
        }

        if (!pushSupported()) return setMode('hidden')

        if (Notification.permission === 'granted') return setMode('hidden')
        if (Notification.permission === 'denied') return setMode(dismissed ? 'hidden' : 'denied')
        setMode('prompt')
    }, [token])

    const dismiss = () => {
        try {
            window.localStorage.setItem(DISMISS_KEY, '1')
        } catch {
            /* ignore */
        }
        setMode('hidden')
    }

    const handleEnable = async () => {
        if (!token || busy) return
        setBusy(true)
        // Runs inside the click handler, so the browser allows the permission prompt.
        const ok = await enablePush(token)
        setBusy(false)

        if (ok) return setMode('hidden')
        setMode(Notification.permission === 'denied' ? 'denied' : 'prompt')
    }

    if (mode === 'hidden') return null

    return (
        <div className='mb-3 flex flex-col gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-black sm:flex-row sm:items-center sm:justify-between'>
            <p>
                {mode === 'prompt' && 'Turn on notifications to get new chat messages even when this website is closed.'}
                {mode === 'denied' &&
                    'Notifications are blocked for this site. Allow them in your browser/site settings, then reload this page.'}
                {mode === 'ios-install' &&
                    'To get chat notifications on iPhone/iPad: tap the Share button, choose "Add to Home Screen", then open the app from your Home Screen and turn on notifications.'}
            </p>

            <div className='flex shrink-0 items-center gap-2'>
                {mode === 'prompt' && (
                    <button
                        type='button'
                        onClick={handleEnable}
                        disabled={busy}
                        className='rounded-md bg-blue-600 px-3 py-1.5 font-medium text-white hover:bg-blue-700 disabled:opacity-60'
                    >
                        {busy ? 'Enabling...' : 'Enable notifications'}
                    </button>
                )}
                {mode !== 'prompt' && (
                    <button
                        type='button'
                        onClick={dismiss}
                        className='rounded-md border border-blue-300 px-3 py-1.5 font-medium hover:bg-blue-100'
                    >
                        Got it
                    </button>
                )}
            </div>
        </div>
    )
}

export default EnableNotifications
