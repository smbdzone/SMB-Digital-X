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

export type RecordType = 'users' | 'salaries' | 'history'
export const RECORD_TYPES: RecordType[] = ['users', 'salaries', 'history']
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

export const STATE_OF: Record<RecordType, (doc: any) => any> = { users: userState, salaries: salaryState, history: historyState }

/** An employee-history entry is owner-controlled when it carries salary figures. */
export const historyHasSalary = (h: any) => num(h?.fromSalary) !== null || num(h?.toSalary) !== null

export const keyOf = (type: RecordType, recordId: unknown) => `${type}/${String(recordId)}`
export const parseKey = (key: string): { type: RecordType; id: string } | null => {
    const m = /^(users|salaries|history)\/([0-9a-f]{24})$/.exec(key)
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

export interface CurrentRecord { key: string; label: string; state: any }
export interface IntegrityFlag { key: string; label: string; problem: string; fields?: { field: string; signed: unknown; now: unknown }[] }
export interface IntegrityResult {
    ok: boolean
    checked: number
    adoptedTypes: RecordType[]
    notAdopted: Record<string, number>
    flags: IntegrityFlag[]
}

interface SignedChange { seq: number; action: string; state?: any; hash?: string }

/** The latest signed state per record, from the history (only entries whose stored body matches the signed hash). */
export const latestSignedStates = (entries: OwnerLogEntryData[]) => {
    const latest = new Map<string, SignedChange>()
    const adopted = new Set<RecordType>()
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
        if (!e.body || sha256Hex(e.body) !== e.request.bodyHash) continue
        let result: any = null
        try { result = e.result ? JSON.parse(e.result) : null } catch { /* */ }
        if (result && result.ok === false) continue
        let body: any
        try { body = JSON.parse(e.body) } catch { continue }
        if (body?.action === 'adopt' && Array.isArray(body.types)) for (const t of body.types) if (RECORD_TYPES.includes(t)) adopted.add(t)
        if (!Array.isArray(body?.changes)) continue
        for (const c of body.changes) {
            if (typeof c?.key !== 'string' || !parseKey(c.key)) continue
            latest.set(c.key, { seq: e.seq, action: String(body.action), ...('state' in c ? { state: c.state } : {}), ...(c.hash ? { hash: c.hash } : {}) })
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
    const signedOf = (key: string) => { const l = latest.get(key); return l && 'state' in l ? l.state : undefined }

    for (const r of records) {
        const type = parseKey(r.key)!.type
        present.add(r.key)
        const l = latest.get(r.key)
        if (!l) {
            if (!adopted.has(type)) { notAdopted[type] = (notAdopted[type] ?? 0) + 1; continue }
            if (type === 'salaries' && pendingMatchesProfile(r.state, signedOf(keyOf('users', r.state.employeeId)))) continue
            flags.push({ key: r.key, label: r.label, problem: type === 'salaries' && r.state.status === 'pending'
                ? 'pending salary does not match the signed pay profile of the employee'
                : 'no signed entry: created or changed outside the Owner Console' })
            continue
        }
        if ('state' in l && l.state === null) { flags.push({ key: r.key, label: r.label, problem: `deleted by signed entry #${l.seq} but still present` }); continue }
        const expected = 'state' in l ? stateHash(r.key, l.state) : l.hash
        if (expected !== stateHash(r.key, r.state)) {
            flags.push({ key: r.key, label: r.label, problem: `differs from signed entry #${l.seq}`, ...('state' in l ? { fields: diffStates(l.state, r.state) } : {}) })
        }
    }
    for (const [key, l] of latest) {
        const t = parseKey(key)!.type
        if (!types.includes(t) || present.has(key)) continue
        if ('state' in l && l.state === null) continue
        flags.push({ key, label: key, problem: `signed in entry #${l.seq} but missing from the database` })
    }
    return { ok: flags.length === 0, checked: records.length, adoptedTypes: [...adopted], notAdopted, flags }
}

export const randomObjectIdHex = () => crypto.randomBytes(12).toString('hex')
