import ChatSidebar from '@/components/chat/ChatSidebar'
import ChatWindow from '@/components/chat/ChatWindow'
import React from 'react'

const page = async () => {

    return (
        <div className='grid items-start grid-cols-4 gap-0'>
            <div className='col-span-1 hidden lg:block'>
                <ChatSidebar />
            </div>
            <div className='col-span-4 lg:col-span-3'>
                <ChatWindow />
            </div>
        </div>
    )
}

export default page