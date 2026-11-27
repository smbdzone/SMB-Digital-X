import { Router } from 'express'
import { badRequest, conflict } from '../utils/http.js'
import { appendOwnerLog, ownerLogEntries } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner } from './ownerHttp.js'
import { MODEL_OF, assertCanonical, currentRecords, setSealSeq } from './ownerRecords.js'
import { RECORD_TYPES, RecordType, canonicalJson, latestSignedStates } from './ownerState.js'

/*
 * Integrity: the console fetches every owner-controlled record in its protected form and checks it, in the
 * browser, against the latest signed state in the history (owner-console/src/integrity.js).
 * Adopt: one signed entry that accepts today's records (of the types not adopted yet) as the starting point.
 */
const router = Router()

router.get('/integrity', requireOwner, async (_req, res) => {
    const records = await currentRecords()
    await appendOwnerLog({ action: 'read.integrity', request: owner(res).request, result: { records: records.length } })
    res.json({ success: true, data: { records, types: RECORD_TYPES } })
})

router.post('/adopt', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    if (b.action !== 'adopt') throw badRequest("action must be 'adopt'")
    const types: RecordType[] = Array.isArray(b.types) ? b.types : []
    if (!types.length || types.some(t => !RECORD_TYPES.includes(t)) || new Set(types).size !== types.length) throw badRequest('types must list record types to adopt')
    if (!Array.isArray(b.changes)) throw badRequest('changes is required')

    // Each type can be adopted once. After that, a record with no signed entry is a finding, not a candidate.
    const { adopted } = latestSignedStates(await ownerLogEntries())
    const again = types.filter(t => adopted.has(t))
    if (again.length) throw conflict(`Already adopted: ${again.join(', ')}`)

    // The signed list must be exactly today's records, unchanged since the console loaded them.
    const current = await currentRecords(types)
    const byKey = new Map(current.map(r => [r.key, r]))
    if (b.changes.length !== current.length) throw conflict('The records changed since you loaded them. Reload and check the summary again.')
    const checked: { key: string; type: RecordType; id: string; hash: string }[] = []
    for (const c of b.changes) {
        const { type, id, hash } = assertCanonical(c?.key, c?.state)
        const now = byKey.get(c.key)
        if (!types.includes(type) || !now || canonicalJson(now.state) !== canonicalJson(c.state)) {
            throw conflict(`The record ${now?.label ?? c.key} changed since you loaded it. Reload and check the summary again.`)
        }
        checked.push({ key: c.key, type, id, hash })
    }
    // Everything checked: only now write the seals.
    for (const c of checked) await (MODEL_OF[c.type] as any).updateOne({ _id: c.id }, { $set: { ownerSeal: { seq: null, hash: c.hash } } }, { timestamps: false })
    const keys = checked.map(c => c.key)
    const o = owner(res)
    const entry = await appendOwnerLog({ action: 'adopt', recordId: types.join(','), request: o.request, body: bodyText(req), result: { ok: true, records: keys.length } })
    await setSealSeq(keys, entry.seq)
    res.json({ success: true, data: { adopted: types, records: keys.length, seq: entry.seq } })
})

export default router
