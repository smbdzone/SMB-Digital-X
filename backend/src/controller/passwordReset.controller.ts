import crypto from 'node:crypto'
import { Request, Response } from 'express'
import User from '../model/user.model.js'
import { generatePasswordChangedEmail, generatePasswordResetEmail } from '../email/authMessages.js'
import { sendSystemMail } from '../email/email.js'
import { asEmail, badRequest, escapeRegex } from '../utils/http.js'

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const CODE_VALID_MINUTES = 10      // how long a code works
const RESEND_COOLDOWN_SECONDS = 60 // minimum gap between two codes for the same account
const MAX_WRONG_ATTEMPTS = 5       // after this the code is dead and a new one is needed
const MIN_PASSWORD_LENGTH = 8

// Same answer whether or not the email exists, so nobody can find out who has an account.
const GENERIC_MESSAGE = 'If an account exists for this email, a verification code has been sent.'
const INVALID_CODE_MESSAGE = 'Invalid or expired code'

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

// Keyed hash: even with a copy of the database, a 6-digit code cannot be brute-forced offline
// without the server secret.
const hashCode = (userId: string, code: string): string =>
    crypto.createHmac('sha256', process.env.JWT_SECRET!).update(`${userId}:${code}`).digest('hex')

const safeEqual = (a: string, b: string): boolean => {
    const x = Buffer.from(a)
    const y = Buffer.from(b)
    return x.length === y.length && crypto.timingSafeEqual(x, y)
}

const readEmail = (body: any): string => {
    const email = asEmail(body?.email, 'email')
    if (!email) throw badRequest('email is required')
    return email
}

const readCode = (body: any): string => {
    const code = typeof body?.code === 'string' ? body.code.trim() : typeof body?.code === 'number' ? String(body.code) : ''
    if (!/^\d{6}$/.test(code)) throw badRequest('code must be the 6-digit number from the email')
    return code
}

// Emails are matched ignoring upper/lower case, so "Ali@x.com" finds "ali@x.com".
const emailFilter = (email: string) => ({ email: new RegExp(`^${escapeRegex(email)}$`, 'i') })

// Finds the account and checks the code. Wrong codes are counted; too many wrong codes kill the code.
const checkCode = async (email: string, code: string) => {
    const user = await User.findOne(emailFilter(email))
        .select('+passwordResetCodeHash +passwordResetExpires +passwordResetAttempts')

    if (!user || !user.passwordResetCodeHash || !user.passwordResetExpires || user.passwordResetExpires.getTime() < Date.now()) {
        throw badRequest(INVALID_CODE_MESSAGE)
    }

    if ((user.passwordResetAttempts ?? 0) >= MAX_WRONG_ATTEMPTS) {
        await User.updateOne({ _id: user._id }, { $unset: { passwordResetCodeHash: '', passwordResetExpires: '' }, $set: { passwordResetAttempts: 0 } })
        throw badRequest('Too many wrong attempts. Please request a new code.')
    }

    if (!safeEqual(hashCode(String(user._id), code), user.passwordResetCodeHash)) {
        await User.updateOne({ _id: user._id }, { $inc: { passwordResetAttempts: 1 } })
        throw badRequest(INVALID_CODE_MESSAGE)
    }

    return user
}

/* ------------------------------------------------------------------ */
/* Controllers                                                         */
/* ------------------------------------------------------------------ */

// POST /api/auth/forgot-password   { email }
export const forgotPasswordController = async (req: Request, res: Response): Promise<void> => {
    const email = readEmail(req.body)

    const user = await User.findOne(emailFilter(email)).select('+passwordResetSentAt')

    // Unknown email, inactive account, or a code was sent a moment ago: answer the same way and do nothing.
    const tooSoon = user?.passwordResetSentAt
        && Date.now() - user.passwordResetSentAt.getTime() < RESEND_COOLDOWN_SECONDS * 1000

    if (!user || user.status === 'inactive' || tooSoon) {
        res.status(200).json({ success: true, message: GENERIC_MESSAGE })
        return
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')

    await User.updateOne({ _id: user._id }, {
        $set: {
            passwordResetCodeHash: hashCode(String(user._id), code),
            passwordResetExpires: new Date(Date.now() + CODE_VALID_MINUTES * 60 * 1000),
            passwordResetAttempts: 0,
            passwordResetSentAt: new Date(),
        },
    })

    try {
        const mail = generatePasswordResetEmail(user.name, code, CODE_VALID_MINUTES)
        await sendSystemMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text })
    } catch (error) {
        // Logged for the admin; the visitor still gets the generic answer (see GENERIC_MESSAGE).
        console.error('Failed to send password reset email:', error instanceof Error ? error.message : error)
    }

    res.status(200).json({ success: true, message: GENERIC_MESSAGE })
}

// POST /api/auth/verify-reset-code   { email, code }
// Optional step so the frontend can check the code before showing the "new password" form.
// It does not use up the code; /reset-password checks it again.
export const verifyResetCodeController = async (req: Request, res: Response): Promise<void> => {
    await checkCode(readEmail(req.body), readCode(req.body))
    res.status(200).json({ success: true, message: 'Code verified' })
}

// POST /api/auth/reset-password   { email, code, newPassword }
export const resetPasswordController = async (req: Request, res: Response): Promise<void> => {
    const email = readEmail(req.body)
    const code = readCode(req.body)

    const newPassword = req.body?.newPassword ?? req.body?.password
    if (typeof newPassword !== 'string' || newPassword.length < MIN_PASSWORD_LENGTH) {
        throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`)
    }
    if (newPassword.length > 128) throw badRequest('Password must be at most 128 characters')

    const user = await checkCode(email, code)

    // Saved as a document so the bcrypt hashing hook runs.
    user.password = newPassword
    user.passwordChangedAt = new Date()   // signs out every device that logged in before this moment
    user.set('passwordResetCodeHash', undefined)
    user.set('passwordResetExpires', undefined)
    user.set('passwordResetAttempts', 0)
    user.set('passwordResetSentAt', undefined)
    await user.save()

    try {
        const mail = generatePasswordChangedEmail(user.name)
        await sendSystemMail({ to: user.email, subject: mail.subject, html: mail.html, text: mail.text })
    } catch (error) {
        console.error('Failed to send password changed email:', error instanceof Error ? error.message : error)
    }

    res.status(200).json({ success: true, message: 'Password reset successfully. You can now log in.' })
}
