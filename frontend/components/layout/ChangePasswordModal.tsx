'use client'

import React, { useState } from 'react'

import ModalBox from '@/components/ui/ModalBox'
import Input from '@/components/ui/Input'
import ButtonEmerald from '@/components/ui/ButtonEmerald'
import { useAuth } from '@/context/AuthContext'
import { useToast } from '@/context/ToastContext'
import { changePassword } from '@/services/auth.services'
import { errorMessage } from '@/lib/utils'

const MIN_LENGTH = 8

/**
 * Change your own password. Needs the current one. Other devices are signed out; this one keeps
 * working with the fresh token the server returns. (Admin accounts cannot be reset by email.)
 */
const ChangePasswordModal = ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const { token, replaceToken } = useAuth()
    const toast = useToast()
    const [current, setCurrent] = useState('')
    const [next, setNext] = useState('')
    const [repeat, setRepeat] = useState('')
    const [saving, setSaving] = useState(false)

    const close = () => {
        setCurrent(''); setNext(''); setRepeat('')
        onClose()
    }

    const save = async () => {
        if (!token) return
        if (!current) return toast.showError('Enter your current password')
        if (next.length < MIN_LENGTH) return toast.showError(`The new password must be at least ${MIN_LENGTH} characters`)
        if (next !== repeat) return toast.showError('The two new passwords do not match')

        setSaving(true)
        try {
            const res = await changePassword(token, { currentPassword: current, newPassword: next })
            if (res.data?.token) replaceToken(res.data.token)
            toast.showSuccess(res.message || 'Password changed')
            close()
        } catch (error) {
            toast.showError(errorMessage(error, 'Could not change the password'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <ModalBox
            open={open}
            onClose={close}
            title="Change password"
            description="Your other devices will be signed out."
            size="md"
            footer={
                <div className="flex justify-end gap-2">
                    <button type="button" onClick={close} className="h-11 rounded-xl border border-charcoal/10 px-4 text-sm font-semibold text-charcoal/70 hover:bg-charcoal/5">
                        Cancel
                    </button>
                    <ButtonEmerald onClick={save} loading={saving} className="!h-11">Change password</ButtonEmerald>
                </div>
            }
        >
            <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
                <Input label="Current password" name="currentPassword" type="password" autoComplete="current-password" required value={current} handleChange={e => setCurrent(e.target.value)} showPasswordToggle />
                <Input label="New password" name="newPassword" type="password" autoComplete="new-password" required value={next} handleChange={e => setNext(e.target.value)} helperText={`At least ${MIN_LENGTH} characters.`} showPasswordToggle />
                <Input label="Repeat new password" name="repeatPassword" type="password" autoComplete="new-password" required value={repeat} handleChange={e => setRepeat(e.target.value)} showPasswordToggle />
                <button type="submit" hidden />
            </form>
        </ModalBox>
    )
}

export default ChangePasswordModal
