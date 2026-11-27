/**
 * Owner-controlled records ("sealed" records) and the integrity check.
 *
 * Every owner action sends, inside its signed body, the COMPLETE new protected state of each record it changes:
 *   { action, changes: [{ key: 'users/<id>', state: {...} | null }] }       (null = the record is deleted)
 * The server writes exactly that state and stores ownerSeal = { seq, hash } on the record; the history keeps the
 * exact signed body. The integrity check then compares every record with the LATEST signed state for it.
 *
 * The canonical form and the hash are the same as in owner-console/src/integrity.js: keep the two in step.
 *   hash = SHA-256( "SMB-OWNER-STATE-1\n<key>\n<canonical JSON of the state>" )
 *   canonical JSON = JSON with object keys sorted, arrays in order, no undefined
 */
import crypto from 'node:crypto'
import { OwnerLogEntryData, sha256Hex } from './signing.js'
import { isLocked, isLockedType, stateHasPlainMoney } from './vault.js'

export type RecordType = 'users' | 'salaries' | 'history' | 'companies' | 'projects' | 'milestones' | 'expenses' | 'certificates'
export const RECORD_TYPES: RecordType[] = ['users', 'salaries', 'history', 'companies', 'projects', 'milestones', 'expenses', 'certificates']
export const STATE_TAG = 'SMB-OWNER-STATE-1'

/* ------------------------------------------------------------------ */
/* Canonical form                                                      */
/* ------------------------------------------------------------------ */

export const canonicalJson = (value: unknown): string => {
    if (value === null || value === undefined) return 'null'
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (typeof value === 'object') {
        const obj = value as Record<string, unknown>
        return `{${Object.keys(obj).sort().filter(k => obj[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Not a finite number')
        return JSON.stringify(value === 0 ? 0 : value)   // -0 -> 0
    }
    return JSON.stringify(value)
}

export const stateHash = (key: string, state: unknown) => sha256Hex(`${STATE_TAG}\n${key}\n${canonicalJson(state)}`)

/* ------------------------------------------------------------------ */
/* Normalisers: database document -> protected state                   */
/* ------------------------------------------------------------------ */

const str = (v: unknown): string | null => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? null : String(v).trim())
const id = (v: unknown): string | null => (v === undefined || v === null || v === '' ? null : String(v))
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
/** A money field that may be locked (Phase 2): the locked text as it is, else the number. */
const money = (v: unknown): string | number | null => (isLocked(v) ? v : num(v))
const items = (v: unknown) => (Array.isArray(v) ? v : []).map((i: any) => ({ name: str(i?.name) ?? '', amount: num(i?.amount) ?? 0 }))
const isoDay = (v: unknown): string | null => {
    if (!v) return null
    const d = new Date(v as string)
    return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export const BANK_FIELDS = ['method', 'bankName', 'holderName', 'accountNumber', 'iban'] as const
const bank = (b: any) => Object.fromEntries(BANK_FIELDS.map(f => [f, str(b?.[f]) || null]))

export const userState = (u: any) => ({
    name: str(u.name),
    email: str(u.email)?.toLowerCase() ?? null,
    position: str(u.position) || null,
    role: str(u.role),
    status: str(u.status),
    companyId: id(u.companyId),
    canApproveDeliverables: u.canApproveDeliverables === true,
    salary: {
        amount: num(u.salary?.amount),
        currency: str(u.salary?.currency) || null,
        allowances: items(u.salary?.allowances),
    },
    bankDetails: bank(u.bankDetails),
})

export const salaryState = (s: any) => ({
    employeeId: id(s.employeeId),
    companyId: id(s.companyId),
    month: str(s.month),
    currency: str(s.currency),
    salary: num(s.salary),
    allowances: items(s.allowances),
    deductions: items(s.deductions),
    totalAllowances: num(s.totalAllowances),
    totalDeductions: num(s.totalDeductions),
    grossAmount: num(s.grossAmount),
    netPay: num(s.netPay),
    notes: str(s.notes) ?? '',
    status: str(s.status),
    paymentDetails: s.paymentDetails && Object.values(s.paymentDetails).some(v => v)
        ? { ...bank(s.paymentDetails), reference: str(s.paymentDetails.reference) || null }
        : null,
})

export const historyState = (h: any) => ({
    employeeId: id(h.employeeId),
    type: str(h.type),
    title: str(h.title),
    description: str(h.description) || null,
    effectiveDate: isoDay(h.effectiveDate),
    fromPosition: str(h.fromPosition) || null,
    toPosition: str(h.toPosition) || null,
    fromSalary: num(h.fromSalary),
    toSalary: num(h.toSalary),
    currency: str(h.currency) || null,
})

export const companyState = (c: any) => ({
    name: str(c.name), code: str(c.code), letterhead: str(c.letterhead) || null, legalName: str(c.legalName) || null,
    logo: str(c.logo) || null, brandColor: str(c.brandColor), address: str(c.address) || null, phone: str(c.phone) || null,
    website: str(c.website) || null, currency: str(c.currency),
    email: { fromName: str(c.email?.fromName) || null, fromEmail: str(c.email?.fromEmail) || null, replyTo: str(c.email?.replyTo) || null, footerNote: str(c.email?.footerNote) || null },
    signatory: { name: str(c.signatory?.name) || null, title: str(c.signatory?.title) || null, signature: str(c.signatory?.signature) || null },
    isActive: c.isActive !== false,
})

/** A project's owner-controlled part is its budget only; everything else stays on the website. */
export const projectState = (p: any) => ({ budget: money(p.budget) ?? 0 })

export const milestoneState = (m: any) => ({
    projectId: id(m.projectId), paymentMode: str(m.paymentMode) || 'percentage', paymentPercentage: money(m.paymentPercentage) ?? 0,
    paymentAmount: money(m.paymentAmount) ?? 0, currency: str(m.currency) || 'AED', paymentStatus: str(m.paymentStatus) || 'unpaid',
    invoicedAt: isoDay(m.invoicedAt), paidAt: isoDay(m.paidAt),
})

export const expenseState = (e: any) => ({
    companyId: id(e.companyId), projectId: id(e.projectId), addedBy: id(e.addedBy), description: str(e.description),
    category: str(e.category), vendor: str(e.vendor) || null, paymentMethod: str(e.paymentMethod) || null,
    amount: num(e.amount), taxes: (Array.isArray(e.taxes) ? e.taxes : []).map((t: any) => ({ name: str(t?.name) ?? '', percentage: num(t?.percentage) ?? 0, amount: num(t?.amount) ?? 0 })),
    totalTax: num(e.totalTax) ?? 0, totalAmount: num(e.totalAmount), currency: str(e.currency), date: isoDay(e.date),
    notes: str(e.notes) || null, status: str(e.status), rejectionReason: str(e.rejectionReason) || null, isDeleted: e.isDeleted === true,
})

/** An issued letter or certificate. Whether it was signed is not part of it (see checkIntegrity: "signed" rule). */
export const certificateState = (c: any) => ({
    employeeId: id(c.employeeId), companyId: id(c.companyId), companyName: str(c.companyName), kind: str(c.kind), typeKey: str(c.typeKey),
    title: str(c.title), subject: str(c.subject) ?? '', body: str(c.body), issueDate: isoDay(c.issueDate),
    signatory: { name: str(c.signatory?.name) || null, title: str(c.signatory?.title) || null },
    recipient: { name: str(c.recipient?.name), email: str(c.recipient?.email) || null, position: str(c.recipient?.position) || null },
    status: str(c.status), revokeReason: str(c.revokeReason) || null,
})

export const STATE_OF: Record<RecordType, (doc: any) => any> = {
    users: userState, salaries: salaryState, history: historyState, companies: companyState, projects: projectState,
    milestones: milestoneState, expenses: expenseState, certificates: certificateState,
}

/**
 * Records that may exist (or disappear) with no signed entry because nothing in them is money yet: a project with
 * budget 0, a milestone with no payment, an expense that is still pending (employees add and edit those).
 */
export const freeOfMoney = (type: RecordType, s: any) =>
    (type === 'projects' && (s?.budget ?? 0) === 0)
    || (type === 'milestones' && s?.paymentPercentage === 0 && s?.paymentAmount === 0 && s?.paymentStatus === 'unpaid')
    || (type === 'expenses' && s?.status === 'pending' && !s?.isDeleted)

/** An employee-history entry is owner-controlled when it carries salary figures. */
export const historyHasSalary = (h: any) => num(h?.fromSalary) !== null || num(h?.toSalary) !== null

export const keyOf = (type: RecordType, recordId: unknown) => `${type}/${String(recordId)}`
export const parseKey = (key: string): { type: RecordType; id: string } | null => {
    const m = /^(users|salaries|history|companies|projects|milestones|expenses|certificates)\/([0-9a-f]{24})$/.exec(key)
    return m ? { type: m[1] as RecordType, id: m[2] } : null
}

/** Field-by-field differences, e.g. [{ field: 'status', signed: 'pending', now: 'paid' }]. */
export const diffStates = (signed: unknown, now: unknown, path = ''): { field: string; signed: unknown; now: unknown }[] => {
    if (canonicalJson(signed) === canonicalJson(now)) return []
    const isObj = (v: unknown) => v && typeof v === 'object' && !Array.isArray(v)
    if (isObj(signed) && isObj(now)) {
        const keys = [...new Set([...Object.keys(signed as object), ...Object.keys(now as object)])].sort()
        return keys.flatMap(k => diffStates((signed as any)[k], (now as any)[k], path ? `${path}.${k}` : k))
    }
    return [{ field: path || '(record)', signed, now }]
}

/* ------------------------------------------------------------------ */
/* Integrity check                                                     */
/* ------------------------------------------------------------------ */

export interface CurrentRecord { key: string; label: string; state: any; signed?: boolean }
export interface IntegrityFlag { key: string; label: string; problem: string; fields?: { field: string; signed: unknown; now: unknown }[] }
export interface IntegrityResult {
    ok: boolean
    checked: number
    adoptedTypes: RecordType[]
    notAdopted: Record<string, number>
    flags: IntegrityFlag[]
}

/*
 * The history index (Phase 2). Once locking has started, the console signs a short outer body
 *   { v: 2, action, index, inner: { sha256, locked } }
 * whose `inner.locked` is the real request body, locked with the vault key. `index` lists, for each record the action
 * changed: its key, the hash of its new state (not for a plain amount of a locked type: a hash of a small state can be
 * guessed), and whether it was deleted, has no money yet, or is a pending expense. The server checks the index against
 * the plain inner body when the request arrives (ownerHttp.ts), so the server's own records check and the daily report
 * keep working from signed data without reading any body. Same function as owner-console/src/integrity.js.
 */
export interface IndexChange { key: string; hash?: string; deleted?: true; free?: true; pending?: true }
export interface HistoryIndex { action: string; types?: RecordType[]; signature?: true; changes: IndexChange[] }

export const historyIndex = (body: any): HistoryIndex => {
    const changes: IndexChange[] = []
    for (const c of Array.isArray(body?.changes) ? body.changes : []) {
        const p = typeof c?.key === 'string' ? parseKey(c.key) : null
        if (!p) continue
        const out: IndexChange = { key: c.key }
        if (!('state' in c)) { if (typeof c.hash === 'string') out.hash = c.hash }
        else if (c.state === null) out.deleted = true
        else {
            if (!(isLockedType(p.type) && stateHasPlainMoney(p.type, c.state))) out.hash = stateHash(c.key, c.state)
            if (freeOfMoney(p.type, c.state)) out.free = true
            if (p.type === 'expenses' && c.state?.status === 'pending') out.pending = true
        }
        changes.push(out)
    }
    return {
        action: String(body?.action ?? ''),
        ...(body?.action === 'adopt' && Array.isArray(body.types) ? { types: body.types.filter((t: any) => RECORD_TYPES.includes(t)) } : {}),
        ...(typeof body?.signatureSha256 === 'string' ? { signature: true as const } : {}),
        changes,
    }
}

export interface OuterBody { v: 2; action: string; index: HistoryIndex; inner: { sha256: string; locked: string } }
/** The signed outer body of a Phase 2 request, or null. */
export const outerBodyOf = (text: string): OuterBody | null => {
    let o: any
    try { o = JSON.parse(text) } catch { return null }
    return o && o.v === 2 && o.index && Array.isArray(o.index.changes) && typeof o.inner?.locked === 'string' ? o : null
}

interface SignedChange {
    seq: number; action: string; signature?: boolean
    hash?: string; deleted?: boolean; free?: boolean; pending?: boolean
    state?: any       // only when the body is plain (before locking); otherwise only the console has it
}

/**
 * The latest signed state per record, from the history. Three kinds of body:
 *   - plain (before locking): its hash must match the signed hash; the states are read from it
 *   - Phase 2 outer body: its hash must match; its signed index is used
 *   - a moved old body (now a locked value): its index comes from the signed "vault.history" batch that moved it
 */
export const latestSignedStates = (entries: OwnerLogEntryData[]) => {
    const latest = new Map<string, SignedChange>()
    const adopted = new Set<RecordType>()
    const sorted = [...entries].sort((a, b) => a.seq - b.seq)

    const moved = new Map<number, { lockedSha256: string; index: HistoryIndex }[]>()
    for (const e of sorted) {
        if (e.action !== 'vault.history' || !e.body || sha256Hex(e.body) !== e.request.bodyHash) continue
        let body: any
        try { body = JSON.parse(e.body) } catch { continue }
        if (body?.action !== 'vault.history' || !Array.isArray(body.entries)) continue
        for (const m of body.entries) if (m && typeof m.seq === 'number' && m.index) moved.set(m.seq, [...(moved.get(m.seq) ?? []), m])
    }

    for (const e of sorted) {
        if (!e.body) continue
        let result: any = null
        try { result = e.result ? JSON.parse(e.result) : null } catch { /* */ }
        if (result && result.ok === false) continue
        let index: HistoryIndex | null = null
        let plain: any = null
        if (isLocked(e.body)) {
            const bodySha = sha256Hex(e.body)
            index = moved.get(e.seq)?.find(m => m.lockedSha256 === bodySha)?.index ?? null
        } else {
            if (sha256Hex(e.body) !== e.request.bodyHash) continue
            const outer = outerBodyOf(e.body)
            if (outer) index = outer.index
            else {
                try { plain = JSON.parse(e.body) } catch { continue }
                try { index = historyIndex(plain) } catch { continue }
            }
        }
        if (!index || !Array.isArray(index.changes)) continue
        if (index.action === 'adopt' && Array.isArray(index.types)) for (const t of index.types) if (RECORD_TYPES.includes(t)) adopted.add(t)
        const plainStates = new Map<string, any>()
        if (plain && Array.isArray(plain.changes)) for (const c of plain.changes) if (typeof c?.key === 'string' && 'state' in c) plainStates.set(c.key, c.state)
        for (const c of index.changes) {
            if (typeof c?.key !== 'string' || !parseKey(c.key)) continue
            // "signature" stays true once any signed entry for the record carried a signature hash (a later revoke keeps it signed).
            latest.set(c.key, {
                seq: e.seq, action: String(index.action), signature: index.signature === true || latest.get(c.key)?.signature === true,
                deleted: c.deleted === true, free: c.free === true, pending: c.pending === true,
                // A plain body gives the state itself (and its hash, even where the index leaves the hash out).
                ...(plainStates.has(c.key)
                    ? { state: plainStates.get(c.key), ...(plainStates.get(c.key) !== null ? { hash: stateHash(c.key, plainStates.get(c.key)) } : {}) }
                    : typeof c.hash === 'string' ? { hash: c.hash } : {}),
            })
        }
    }
    return { latest, adopted }
}

/** A pending salary the payroll job created (never signed) is fine if it matches the employee's signed pay profile. */
export const pendingMatchesProfile = (s: any, profile: any) => {
    if (!profile || s.status !== 'pending') return false
    const allowances = (profile.salary?.allowances ?? []).filter((a: any) => a?.name && typeof a.amount === 'number' && a.amount > 0)
    return s.salary === profile.salary?.amount && s.currency === (profile.salary?.currency || 'AED') && s.companyId === profile.companyId
        && canonicalJson(s.allowances) === canonicalJson(allowances) && s.deductions.length === 0 && !s.paymentDetails && !s.notes
}

export const checkIntegrity = (entries: OwnerLogEntryData[], records: CurrentRecord[], types: RecordType[] = RECORD_TYPES): IntegrityResult => {
    const { latest, adopted } = latestSignedStates(entries)
    const flags: IntegrityFlag[] = []
    const notAdopted: Record<string, number> = {}
    const present = new Set<string>()
    const now = new Map(records.map(r => [r.key, r]))
    // The signed state of a record: from a plain body, or (when only its hash is signed) the record itself if it matches.
    const signedOf = (key: string) => {
        const l = latest.get(key)
        if (!l || l.deleted) return undefined
        if ('state' in l) return l.state
        const r = now.get(key)
        return r && l.hash && l.hash === stateHash(key, r.state) ? r.state : undefined
    }

    for (const r of records) {
        const type = parseKey(r.key)!.type
        present.add(r.key)
        const l = latest.get(r.key)
        if (!l) {
            if (!adopted.has(type)) { notAdopted[type] = (notAdopted[type] ?? 0) + 1; continue }
            if (type === 'salaries' && pendingMatchesProfile(r.state, signedOf(keyOf('users', r.state.employeeId)))) continue
            if (freeOfMoney(type, r.state)) continue
            flags.push({ key: r.key, label: r.label, problem: type === 'salaries' && r.state.status === 'pending'
                ? 'pending salary does not match the signed pay profile of the employee'
                : 'no signed entry: created or changed outside the Owner Console' })
            continue
        }
        if (l.deleted) { flags.push({ key: r.key, label: r.label, problem: `deleted by signed entry #${l.seq} but still present` }); continue }
        // An expense the owner left (or put back) as pending may still be edited by the employee who added it.
        if (type === 'expenses' && l.pending && freeOfMoney(type, r.state)) continue
        // A letter may show "Digitally signed" only if a signed entry for it carried a signature hash.
        if (type === 'certificates' && r.signed && !l.signature) flags.push({ key: r.key, label: r.label, problem: 'marked as signed, but no signed entry for it carried a signature' })
        if (!l.hash) { flags.push({ key: r.key, label: r.label, problem: `its last signed state (entry #${l.seq}) is locked: run Verify everything in the Owner Console` }); continue }
        if (l.hash !== stateHash(r.key, r.state)) {
            flags.push({ key: r.key, label: r.label, problem: `differs from signed entry #${l.seq}`, ...('state' in l ? { fields: diffStates(l.state, r.state) } : {}) })
        }
    }
    for (const [key, l] of latest) {
        const t = parseKey(key)!.type
        if (!types.includes(t) || present.has(key)) continue
        if (l.deleted || l.free) continue
        flags.push({ key, label: key, problem: `signed in entry #${l.seq} but missing from the database` })
    }
    return { ok: flags.length === 0, checked: records.length, adoptedTypes: [...adopted], notAdopted, flags }
}

export const randomObjectIdHex = () => crypto.randomBytes(12).toString('hex')
