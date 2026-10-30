'use client'

import React, { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import ChatSidebar from '@/components/chat/ChatSidebar'
import ChatWindow from '@/components/chat/ChatWindow'
import EnableNotifications from '@/components/chat/EnableNotifications'

const ChatLayout = () => {
    const searchParams = useSearchParams()
    const hasConversation = Boolean(searchParams.get('conversationId'))

    return (
        <>
        <EnableNotifications />
        <div className='grid items-start grid-cols-4 gap-0'>
            {/* Mobile: the conversation list, hidden once a chat is open. Large screens: always shown, as before. */}
            <div className={`col-span-4 lg:col-span-1 ${hasConversation ? 'hidden lg:block' : 'block'}`}>
                <ChatSidebar />
            </div>

            {/* Mobile: only shown after a conversation is selected. Large screens: always shown, as before. */}
            <div className={`col-span-4 lg:col-span-3 ${hasConversation ? 'block' : 'hidden lg:block'}`}>
                <ChatWindow />
            </div>
        </div>
        </>
    )
}

const page = () => (
    <Suspense fallback={null}>
        <ChatLayout />
    </Suspense>
)

export default page