import mongoose, { Schema } from 'mongoose'
import { getOwnerKey, ownerLogEntries, ownerReportAddress, sendOwnerMail } from './owner.service.js'
import { GENESIS, OwnerLogEntryData, shortHash, verifyChain } from './signing.js'
import { checkIntegrity } from './ownerState.js'
import { currentRecords } from './ownerRecords.js'

/*
 * Daily report to the owner's private email (OWNER_REPORT_EMAIL): yesterday's owner actions (Asia/Dubai days),
 * the history (chain) fingerprint and entry count, whether the server's own check of the whole chain and every
 * signature passed, and the key fingerprint. Sent at most once per day: the day is claimed before sending.
 *
 * The server writes this report, so it is only as honest as the server. Its value: once in the owner's mailbox
 * it cannot be changed, so a later rewrite of the history will not match an earlier report.
 */
const DUBAI_OFFSET = '+04:00'   // Asia/Dubai has no daylight saving time

const reportSchema = new Schema({
    _id: { type: String },                     // the day reported on, YYYY-MM-DD (Dubai)
    claimedAt: { type: Date, required: true },
    sentAt: Date,
    chainOk: Boolean,
    count: Number,
    head: String,
}, { versionKey: false, collection: 'ownerreports' })
const OwnerReport = (mongoose.models.OwnerReport as mongoose.Model<any>) || mongoose.model('OwnerReport', reportSchema)

const dubaiDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)

/** "Yesterday" in Dubai, and its start and end as instants. */
export const reportDay = (now = new Date()) => {
    const today = dubaiDay(now)
    const start = new Date(new Date(`${today}T00:00:00${DUBAI_OFFSET}`).getTime() - 24 * 3600_000)
    return { day: dubaiDay(start), start, end: new Date(start.getTime() + 24 * 3600_000) }
}

const describe = (e: OwnerLogEntryData) => {
    let result = ''
    try {
        const r = e.result ? JSON.parse(e.result) : null
        if (r && r.ok === false) result = `  FAILED: ${r.error ?? ''}`
        else if (r?.count !== undefined) result = `  (${r.count} records)`
        else if (r?.slipEmail) result = `  (slip email: ${r.slipEmail})`
    } catch { /* keep it short */ }
    const time = new Date(e.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' })
    return `  #${e.seq}  ${time}  ${e.action}${e.recordId ? `  ${e.recordId}` : ''}${result}`
}

export interface OwnerReportResult {
    sent: boolean
    reason?: string
    day: string
    actions?: number
    chainOk?: boolean
    recordsOk?: boolean
    flags?: number
    count?: number
    chainFingerprint?: string
}

export const sendDailyOwnerReport = async (now = new Date()): Promise<OwnerReportResult> => {
    const { day, start, end } = reportDay(now)
    if (!ownerReportAddress()) return { sent: false, reason: 'OWNER_REPORT_EMAIL is not set', day }
    const key = await getOwnerKey()
    if (!key) return { sent: false, reason: 'the Owner Console is not set up', day }

    try {
        await OwnerReport.create({ _id: day, claimedAt: new Date() })
    } catch (error) {
        if ((error as { code?: number })?.code === 11000) return { sent: false, reason: 'already sent for this day', day }
        throw error
    }

    try {
        const entries = await ownerLogEntries()
        const check = await verifyChain(entries, key.publicKey)
        const integrity = checkIntegrity(entries, await currentRecords())
        const notAdopted = Object.entries(integrity.notAdopted).map(([t, n]) => `${n} ${t}`).join(', ')
        const head = entries.length ? check.head : GENESIS
        const yesterday = entries.filter(e => { const t = new Date(e.at).getTime(); return t >= start.getTime() && t < end.getTime() })

        const lines = [
            `Owner Console daily report for ${day} (Dubai time)`,
            '',
            check.ok ? 'History check: PASSED (every link and every owner signature is valid)' : 'History check: FAILED. Someone changed the owner history:',
            ...check.problems.slice(0, 20).map(p => `  - entry #${p.seq}: ${p.problem}`),
            ...(check.problems.length > 20 ? [`  ... and ${check.problems.length - 20} more`] : []),
            '',
            integrity.ok
                ? `Records check: PASSED (${integrity.checked} owner-controlled records match their last signed state)`
                : `Records check: FAILED. ${integrity.flags.length} record(s) were changed outside the Owner Console:`,
            ...integrity.flags.slice(0, 20).map(f => `  - ${f.label}: ${f.problem}${f.fields?.length ? ` (${f.fields.map(x => `${x.field}: signed ${JSON.stringify(x.signed)}, now ${JSON.stringify(x.now)}`).join('; ')})` : ''}`),
            ...(integrity.flags.length > 20 ? [`  ... and ${integrity.flags.length - 20} more`] : []),
            ...(notAdopted ? [`Not adopted yet (not checked): ${notAdopted}. Use "Adopt current records" in the console.`] : []),
            '',
            `Chain fingerprint: ${shortHash(head)}   (entries: ${check.count})`,
            `Key fingerprint:   ${key.fingerprint}`,
            '',
            yesterday.length ? `Owner actions on ${day}: ${yesterday.length}` : `No owner actions on ${day}.`,
            ...yesterday.map(describe),
            '',
            'Compare the chain fingerprint and entry count with "Verify everything" in your Owner Console.',
            'Keep these emails: an older report that no longer matches means the history was rewritten.',
        ]
        await sendOwnerMail(`Owner Console daily report ${day}${check.ok && integrity.ok ? '' : ' - CHECK FAILED'}`, lines)
        await OwnerReport.updateOne({ _id: day }, { $set: { sentAt: new Date(), chainOk: check.ok, count: check.count, head } })
        return { sent: true, day, actions: yesterday.length, chainOk: check.ok, recordsOk: integrity.ok, flags: integrity.flags.length, count: check.count, chainFingerprint: shortHash(head) }
    } catch (error) {
        await OwnerReport.deleteOne({ _id: day, sentAt: { $exists: false } })   // let the next run try again
        throw error
    }
}
