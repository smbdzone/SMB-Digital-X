//frontend/components/layout/InstallButton.tsx
'use client'

import React, { useEffect, useState } from 'react'

type InstallEvent = Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const InstallButton = () => {
    const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null)
    const [installed, setInstalled] = useState(false)
    const [ios, setIos] = useState(false)
    const [showIosHelp, setShowIosHelp] = useState(false)

    useEffect(() => {
        setInstalled(
            window.matchMedia('(display-mode: standalone)').matches ||
            (navigator as Navigator & { standalone?: boolean }).standalone === true
        )
        setIos(
            /iphone|ipad|ipod/i.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
        )

        const onPrompt = (event: Event) => {
            event.preventDefault() // stop the browser's own mini-bar, we show our button instead
            setInstallEvent(event as InstallEvent)
        }
        const onInstalled = () => {
            setInstalled(true)
            setInstallEvent(null)
        }

        window.addEventListener('beforeinstallprompt', onPrompt)
        window.addEventListener('appinstalled', onInstalled)
        return () => {
            window.removeEventListener('beforeinstallprompt', onPrompt)
            window.removeEventListener('appinstalled', onInstalled)
        }
    }, [])

    if (installed) return null

    const handleClick = async () => {
        if (installEvent) {
            await installEvent.prompt()
            await installEvent.userChoice
            setInstallEvent(null) // the event can only be used once
        } else {
            setShowIosHelp((value) => !value)
        }
    }

    // Android/desktop Chrome: only when the browser says the site is installable. iPhone: always (shows help).
    if (!installEvent && !ios) return null

    return (
        <div className='relative'>
            <button
                type='button'
                onClick={handleClick}
                className='rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700'
            >
                Install app
            </button>
            {showIosHelp && (
                <div className='absolute right-0 z-50 mt-2 w-64 rounded-md border bg-white p-3 text-sm text-gray-800 shadow-lg'>
                    Tap the Share button in Safari, then choose <b>Add to Home Screen</b>.
                </div>
            )}
        </div>
    )
}

export default InstallButton