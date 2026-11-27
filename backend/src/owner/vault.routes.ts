import { Request, Router } from 'express'
import Project from '../model/project.model.js'
import Milestone from '../model/milestone.model.js'
import OwnerLog from '../model/ownerLog.model.js'
import { badRequest, conflict } from '../utils/http.js'
import { appendOwnerLog, lockedPartsOf, ownerLogEntries } from './owner.service.js'
import { bodyText, jsonBody, owner, requireOwner } from './ownerHttp.js'
import { assertCanonical, currentRecords } from './ownerRecords.js'
import { STATE_OF, canonicalJson, checkIntegrity, historyIndex, outerBodyOf, stateHash } from './ownerState.js'
import { sha256Hex } from './signing.js'
import {
    LOCKED_FIELDS, LockedType, VAULT_FINISH_PATH, VAULT_START_PATH, isLocked, isLockedType, stateHasPlainMoney, stateIsLocked, vaultFinished, vaultStarted,
} from './vault.js'

/*
 * "Lock existing data" (Phase 2), driven by the Owner Console. The server cannot lock or unlock anything (it has no
 * vault key); it checks that each step replaces a plain value with a locked one, in one database update per record or
 * history entry, so stopping at any point leaves every value either plain or locked, never both.
 *
 *   GET  /vault/status                                   started? finished? how much is still plain
 *   POST /vault/start         { action: 'vault.start', totals }                 (locked body) before-totals, kept locked
 *   POST /vault/lock-records  { action: 'vault.lock', changes: [{ key, state, from }] }    (locked body) up to 100
 *        state = the record's state with its amounts locked; from = hash of its current plain state
 *   POST /vault/lock-history  { action: 'vault.history', entries: [{ seq, bodyHash, lockedSha256, index }] }
 *        + the locked bodies as extra parts (same order). A plain body: it holds only numbers, hashes and indexes, and
 *        the server's records check reads the indexes from it later.
 *   POST /vault/finish        { action: 'vault.finish' }                        (locked body) nothing plain left
 *
 * Order: records first, then history (an old history body may hold a plain amount whose hash is left out of its
 * index; by then each such record has a newer, locked signed state).
 */
const router = Router()
const MAX_RECORDS = 100
const MAX_ENTRIES = 200

const requireLockedBody = (req: Request) => {
    if (!(req as any).ownerInnerChecked) throw badRequest('This step must be sent with its body locked (Owner Console v1.3.0 or later)')
}

/** Records whose amounts are still plain (other than 0, which means "not set yet"). */
const plainMoneyFilter = (type: LockedType) => ({ $or: LOCKED_FIELDS[type].map(f => ({ [f]: { $type: 'number', $ne: 0 } })) })
const plainRecordCounts = async () => ({
    projects: await Project.countDocuments(plainMoneyFilter('projects')),
    milestones: await Milestone.countDocuments(plainMoneyFilter('milestones')),
})

/** none | locked (moved old body) | outer (Phase 2 body) | plain */
const bodyKind = (body?: string | null) => (!body ? 'none' : isLocked(body) ? 'locked' : outerBodyOf(body) ? 'outer' : 'plain')
const plainEntryCount = async () => {
    let n = 0
    for (const e of await ownerLogEntries()) if (bodyKind(e.body) === 'plain' && e.action !== 'vault.history') n++
    return n
}

router.get('/vault/status', requireOwner, async (_req, res) => {
    const data = {
        started: await vaultStarted(), finished: await vaultFinished(),
        plain: { ...(await plainRecordCounts()), historyBodies: await plainEntryCount() },
    }
    await appendOwnerLog({ action: 'read.vault', request: owner(res).request, result: { started: data.started, finished: data.finished } })
    res.json({ success: true, data })
})

router.post('/vault/start', requireOwner, async (req, res) => {
    requireLockedBody(req)
    const b = jsonBody(req)
    if (b.action !== 'vault.start' || !b.totals || typeof b.totals !== 'object') throw badRequest("Send { action: 'vault.start', totals }")
    if (await vaultStarted()) throw conflict('Locking has already started')
    // Locking re-signs every amount as it is now, so the records must first match their signed states.
    // Every type that has records must be adopted (a type with no records yet has nothing to adopt).
    const check = checkIntegrity(await ownerLogEntries(), await currentRecords())
    const missing = Object.keys(check.notAdopted)
    if (missing.length) throw conflict(`Adopt the existing records first (not adopted yet: ${missing.join(', ')})`)
    if (!check.ok) throw conflict(`The records check is not clean (${check.flags.length} finding(s)). Run Verify everything and resolve them first.`)
    if (req.originalUrl !== VAULT_START_PATH) throw badRequest('Unexpected path')
    const entry = await appendOwnerLog({ action: 'vault.start', request: owner(res).request, body: bodyText(req), result: { ok: true } })
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/vault/lock-records', requireOwner, async (req, res) => {
    requireLockedBody(req)
    const b = jsonBody(req)
    if (b.action !== 'vault.lock' || !Array.isArray(b.changes) || !b.changes.length || b.changes.length > MAX_RECORDS) throw badRequest(`Send { action: 'vault.lock', changes: [1-${MAX_RECORDS} records] }`)
    if (!(await vaultStarted())) throw conflict('Start locking first')
    const keys = new Set<string>()
    const plan: { key: string; type: LockedType; id: string; hash: string; plain: Record<string, unknown>; locked: Record<string, string> }[] = []
    for (const c of b.changes) {
        const { type, id, hash } = assertCanonical(c?.key, c?.state)
        if (!isLockedType(type)) throw badRequest(`${c.key}: only project budgets and milestone payments are locked`)
        if (keys.has(c.key)) throw badRequest(`${c.key} is listed twice`)
        keys.add(c.key)
        if (!stateIsLocked(type, c.state)) throw badRequest(`${c.key}: every amount must be locked`)
        const doc: any = type === 'projects' ? await Project.findById(id).lean() : await Milestone.findById(id).lean()
        if (!doc) throw conflict(`${c.key} no longer exists. Reload and try again.`)
        const now = STATE_OF[type](doc)
        if (stateHash(c.key, now) !== c.from) throw conflict(`${c.key} changed since you loaded it. Reload and try again.`)
        if (!stateHasPlainMoney(type, now)) throw conflict(`${c.key} has no plain amount to lock (already locked, or not set). Reload and try again.`)
        // Locking changes only the amounts: everything else must stay exactly as it is.
        const rest = (s: any) => Object.fromEntries(Object.entries(s).filter(([k]) => !(LOCKED_FIELDS[type] as readonly string[]).includes(k)))
        if (canonicalJson(rest(now)) !== canonicalJson(rest(c.state))) throw badRequest(`${c.key}: locking may change only the amounts`)
        const fields = LOCKED_FIELDS[type] as readonly string[]
        plan.push({ key: c.key, type, id, hash, plain: Object.fromEntries(fields.map(f => [f, doc[f] === undefined ? { $exists: false } : doc[f]])), locked: Object.fromEntries(fields.map(f => [f, c.state[f]])) })
    }
    // The history entry first: if the process stops before the records are written, they are still plain and unchanged,
    // and sending the batch again finishes the job.
    const entry = await appendOwnerLog({ action: 'vault.lock', recordId: plan.length === 1 ? plan[0].id : `${plan.length} records`, request: owner(res).request, body: bodyText(req), result: { ok: true, records: plan.length } })
    let written = 0
    for (const p of plan) {
        // One update per record, and only while it still holds exactly the plain values that were checked.
        const model: any = p.type === 'projects' ? Project : Milestone
        const r = await model.updateOne({ _id: p.id, ...p.plain }, { $set: { ...p.locked, ownerSeal: { seq: entry.seq, hash: p.hash } } }, { timestamps: false })
        if (r.modifiedCount === 1) written++
        else console.error(`[owner] vault.lock: ${p.key} changed while it was being locked; it stays plain`)
    }
    res.json({ success: true, data: { locked: written, log: { seq: entry.seq, head: entry.hash } } })
})

const HEX64 = /^[0-9a-f]{64}$/
router.post('/vault/lock-history', requireOwner, async (req, res) => {
    const b = jsonBody(req)
    const parts = lockedPartsOf(req)
    if (b.action !== 'vault.history' || !Array.isArray(b.entries) || !b.entries.length || b.entries.length > MAX_ENTRIES) throw badRequest(`Send { action: 'vault.history', entries: [1-${MAX_ENTRIES} entries] }`)
    if (Object.keys(b).sort().join(',') !== 'action,entries') throw badRequest('Unexpected fields')
    if (parts.length !== b.entries.length) throw badRequest('Send one locked body per entry')
    if (!(await vaultStarted())) throw conflict('Start locking first')
    const plain = await plainRecordCounts()
    if (plain.projects || plain.milestones) throw conflict('Lock the project budgets and milestone payments first')

    const seqs = new Set<number>()
    const plan: { seq: number; plainBody: string; locked: string }[] = []
    for (let i = 0; i < b.entries.length; i++) {
        const m = b.entries[i], locked = parts[i]
        if (!m || Object.keys(m).sort().join(',') !== 'bodyHash,index,lockedSha256,seq' || !Number.isSafeInteger(m.seq) || !HEX64.test(m.bodyHash) || !HEX64.test(m.lockedSha256)) throw badRequest(`Entry ${i + 1}: malformed`)
        if (seqs.has(m.seq)) throw badRequest(`Entry #${m.seq} is listed twice`)
        seqs.add(m.seq)
        if (!isLocked(locked) || sha256Hex(locked) !== m.lockedSha256) throw badRequest(`Entry #${m.seq}: the locked body does not match its signed hash`)
        const e = await OwnerLog.findOne({ seq: m.seq }).lean()
        if (!e) throw conflict(`Entry #${m.seq} does not exist`)
        if (e.action === 'vault.history') throw badRequest(`Entry #${m.seq} is itself a move batch and stays as it is`)
        if (bodyKind(e.body) !== 'plain') throw conflict(`Entry #${m.seq} has no plain body (already moved?). Reload and try again.`)
        if (e.request.bodyHash !== m.bodyHash || sha256Hex(e.body!) !== m.bodyHash) throw conflict(`Entry #${m.seq}: its stored body does not match its signed hash. Run Verify everything.`)
        let expected: string
        try { expected = canonicalJson(historyIndex(JSON.parse(e.body!))) } catch { throw conflict(`Entry #${m.seq}: its body is not readable`) }
        if (canonicalJson(m.index) !== expected) throw badRequest(`Entry #${m.seq}: the index does not match its body`)
        plan.push({ seq: m.seq, plainBody: e.body!, locked })
    }
    // The batch entry first (it holds the indexes the server reads later), then one update per entry: the plain body is
    // replaced by its locked form only while it is still exactly that plain body. The signed body hash stays.
    const entry = await appendOwnerLog({ action: 'vault.history', recordId: `${plan.length} entries`, request: owner(res).request, body: bodyText(req), result: { ok: true, entries: plan.length } })
    let moved = 0
    for (const p of plan) {
        const r = await OwnerLog.updateOne({ seq: p.seq, body: p.plainBody }, { $set: { body: p.locked } })
        if (r.modifiedCount === 1) moved++
    }
    res.json({ success: true, data: { moved, log: { seq: entry.seq, head: entry.hash } } })
})

router.post('/vault/finish', requireOwner, async (req, res) => {
    requireLockedBody(req)
    const b = jsonBody(req)
    if (b.action !== 'vault.finish') throw badRequest("Send { action: 'vault.finish' }")
    if (!(await vaultStarted())) throw conflict('Start locking first')
    if (await vaultFinished()) throw conflict('Locking is already finished')
    const plain = { ...(await plainRecordCounts()), historyBodies: await plainEntryCount() }
    if (plain.projects || plain.milestones || plain.historyBodies) {
        throw conflict(`Still plain: ${plain.projects} project budget(s), ${plain.milestones} milestone payment(s), ${plain.historyBodies} history bod(ies). Continue locking first.`)
    }
    if (req.originalUrl !== VAULT_FINISH_PATH) throw badRequest('Unexpected path')
    const entry = await appendOwnerLog({ action: 'vault.finish', request: owner(res).request, body: bodyText(req), result: { ok: true } })
    res.json({ success: true, data: { log: { seq: entry.seq, head: entry.hash } } })
})

export default router
