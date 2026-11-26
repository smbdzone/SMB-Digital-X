import User from '../model/user.model.js'
import Salary from '../model/salary.model.js'
import EmployeeHistory from '../model/employeeHistory.model.js'
import { badRequest } from '../utils/http.js'
import { ownerLogEntries } from './owner.service.js'
import {
    CurrentRecord, IntegrityResult, RECORD_TYPES, RecordType, STATE_OF, canonicalJson, checkIntegrity, historyState, keyOf,
    latestSignedStates, parseKey, salaryState, stateHash, userState,
} from './ownerState.js'

/** Every owner-controlled record as it is in the database now, in its protected form. */
export const currentRecords = async (types: RecordType[] = RECORD_TYPES): Promise<CurrentRecord[]> => {
    const users = await User.find().select('+bankDetails').lean()
    const nameOf = new Map(users.map(u => [String(u._id), u.name]))
    const out: CurrentRecord[] = []
    if (types.includes('users')) {
        for (const u of users) out.push({ key: keyOf('users', u._id), label: `Person: ${u.name} <${u.email}>`, state: userState(u) })
    }
    if (types.includes('salaries')) {
        for (const s of await Salary.find().sort({ month: 1 }).lean()) {
            out.push({ key: keyOf('salaries', s._id), label: `Salary ${s.month}: ${nameOf.get(String(s.employeeId)) ?? '?'}`, state: salaryState(s) })
        }
    }
    if (types.includes('history')) {
        const rows = await EmployeeHistory.find({ $or: [{ fromSalary: { $ne: null } }, { toSalary: { $ne: null } }] }).lean()
        for (const h of rows) out.push({ key: keyOf('history', h._id), label: `Salary history: ${nameOf.get(String(h.employeeId)) ?? '?'}, ${h.title}`, state: historyState(h) })
    }
    return out
}

export const runIntegrityCheck = async (): Promise<IntegrityResult> =>
    checkIntegrity(await ownerLogEntries(), await currentRecords())

/** The latest signed state of one record (undefined = never signed). */
export const signedStateOf = async (key: string) => {
    const { latest } = latestSignedStates(await ownerLogEntries())
    const l = latest.get(key)
    return l && 'state' in l ? l.state : undefined
}

/**
 * Checks a state the console sent: it must already be in canonical form (what the server would store for it),
 * so the hash the console signed is exactly the hash of what gets stored.
 */
export const assertCanonical = (key: string, state: unknown) => {
    const p = parseKey(key)
    if (!p) throw badRequest(`Not a record key: ${key}`)
    if (!state || typeof state !== 'object') throw badRequest(`${key}: state must be an object`)
    const normal = STATE_OF[p.type](state)
    if (canonicalJson(normal) !== canonicalJson(state)) throw badRequest(`${key}: state is not in canonical form`)
    return { ...p, hash: stateHash(key, state) }
}

export const sealOf = (key: string, state: unknown, seq: number | null = null) => ({ seq, hash: stateHash(key, state) })

export const MODEL_OF = { users: User, salaries: Salary, history: EmployeeHistory } as const

/** After the history entry is written: point each record's seal at it. */
export const setSealSeq = async (keys: string[], seq: number) => {
    for (const key of keys) {
        const p = parseKey(key)!
        await (MODEL_OF[p.type] as any).updateOne({ _id: p.id }, { $set: { 'ownerSeal.seq': seq } }, { timestamps: false })
    }
}

/**
 * For the payroll job: once people are adopted, only employees whose pay profile matches its last signed
 * state get a salary record; the others are skipped (and reported). Before adoption: no restriction.
 */
export const signedProfileFilter = async (): Promise<{ ids: Set<string>; reason: string } | undefined> => {
    const { latest, adopted } = latestSignedStates(await ownerLogEntries())
    if (!adopted.has('users')) return undefined
    const ids = new Set<string>()
    for (const r of await currentRecords(['users'])) {
        const l = latest.get(r.key)
        if (l && 'state' in l && l.state && stateHash(r.key, l.state) === stateHash(r.key, r.state)) ids.add(r.key.split('/')[1])
    }
    return { ids, reason: 'Pay profile changed outside the Owner Console (not signed)' }
}
