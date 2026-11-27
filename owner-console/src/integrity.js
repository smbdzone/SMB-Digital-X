/*
 * Owner-controlled records in the console: canonical form, state hash, normalisers, salary totals and the
 * integrity check. Same rules as backend/src/owner/ownerState.ts and salary.service.ts computeTotals:
 * keep them in step (the tests compare both).
 */
import { sha256Hex } from './crypto.js'

export const STATE_TAG = 'SMB-OWNER-STATE-1'
export const RECORD_TYPES = ['users', 'salaries', 'history', 'companies', 'projects', 'milestones', 'expenses', 'certificates']
export const BANK_FIELDS = ['method', 'bankName', 'holderName', 'accountNumber', 'iban']

export const canonicalJson = value => {
    if (value === null || value === undefined) return 'null'
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
    if (typeof value === 'object') return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new Error('Not a finite number'); return JSON.stringify(value === 0 ? 0 : value) }
    return JSON.stringify(value)
}
export const stateHash = (key, state) => sha256Hex(`${STATE_TAG}\n${key}\n${canonicalJson(state)}`)

/* ---------------- normalisers (same output as the server's) ---------------- */

const str = v => (typeof v === 'string' ? v.trim() : v === undefined || v === null ? null : String(v).trim())
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const items = v => (Array.isArray(v) ? v : []).map(i => ({ name: str(i?.name) ?? '', amount: num(i?.amount) ?? 0 }))
const bank = b => Object.fromEntries(BANK_FIELDS.map(f => [f, str(b?.[f]) || null]))

export const normalizeUser = u => ({
    name: str(u.name), email: str(u.email)?.toLowerCase() ?? null, position: str(u.position) || null,
    role: str(u.role), status: str(u.status), companyId: u.companyId ? String(u.companyId) : null,
    canApproveDeliverables: u.canApproveDeliverables === true,
    salary: { amount: num(u.salary?.amount), currency: str(u.salary?.currency) || null, allowances: items(u.salary?.allowances) },
    bankDetails: bank(u.bankDetails),
})
export const normalizeSalary = s => ({
    employeeId: s.employeeId ? String(s.employeeId) : null, companyId: s.companyId ? String(s.companyId) : null,
    month: str(s.month), currency: str(s.currency), salary: num(s.salary), allowances: items(s.allowances), deductions: items(s.deductions),
    totalAllowances: num(s.totalAllowances), totalDeductions: num(s.totalDeductions), grossAmount: num(s.grossAmount), netPay: num(s.netPay),
    notes: str(s.notes) ?? '', status: str(s.status),
    paymentDetails: s.paymentDetails && Object.values(s.paymentDetails).some(v => v) ? { ...bank(s.paymentDetails), reference: str(s.paymentDetails.reference) || null } : null,
})
export const normalizeHistory = h => {
    const d = h.effectiveDate ? new Date(h.effectiveDate) : null
    return {
        employeeId: h.employeeId ? String(h.employeeId) : null, type: str(h.type), title: str(h.title), description: str(h.description) || null,
        effectiveDate: d && !Number.isNaN(d.getTime()) ? d.toISOString() : null,
        fromPosition: str(h.fromPosition) || null, toPosition: str(h.toPosition) || null,
        fromSalary: num(h.fromSalary), toSalary: num(h.toSalary), currency: str(h.currency) || null,
    }
}

const iso = v => { if (!v) return null; const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d.toISOString() }
const idOf = v => (v === undefined || v === null || v === '' ? null : String(v))

export const normalizeCompany = c => ({
    name: str(c.name), code: str(c.code), letterhead: str(c.letterhead) || null, legalName: str(c.legalName) || null,
    logo: str(c.logo) || null, brandColor: str(c.brandColor), address: str(c.address) || null, phone: str(c.phone) || null,
    website: str(c.website) || null, currency: str(c.currency),
    email: { fromName: str(c.email?.fromName) || null, fromEmail: str(c.email?.fromEmail) || null, replyTo: str(c.email?.replyTo) || null, footerNote: str(c.email?.footerNote) || null },
    signatory: { name: str(c.signatory?.name) || null, title: str(c.signatory?.title) || null, signature: str(c.signatory?.signature) || null },
    isActive: c.isActive !== false,
})
export const normalizeProject = p => ({ budget: num(p.budget) ?? 0 })
export const normalizeMilestone = m => ({
    projectId: idOf(m.projectId), paymentMode: str(m.paymentMode) || 'percentage', paymentPercentage: num(m.paymentPercentage) ?? 0,
    paymentAmount: num(m.paymentAmount) ?? 0, currency: str(m.currency) || 'AED', paymentStatus: str(m.paymentStatus) || 'unpaid',
    invoicedAt: iso(m.invoicedAt), paidAt: iso(m.paidAt),
})
export const normalizeExpense = e => ({
    companyId: idOf(e.companyId), projectId: idOf(e.projectId), addedBy: idOf(e.addedBy), description: str(e.description),
    category: str(e.category), vendor: str(e.vendor) || null, paymentMethod: str(e.paymentMethod) || null,
    amount: num(e.amount), taxes: (Array.isArray(e.taxes) ? e.taxes : []).map(t => ({ name: str(t?.name) ?? '', percentage: num(t?.percentage) ?? 0, amount: num(t?.amount) ?? 0 })),
    totalTax: num(e.totalTax) ?? 0, totalAmount: num(e.totalAmount), currency: str(e.currency), date: iso(e.date),
    notes: str(e.notes) || null, status: str(e.status), rejectionReason: str(e.rejectionReason) || null, isDeleted: e.isDeleted === true,
})
export const normalizeCertificate = c => ({
    employeeId: idOf(c.employeeId), companyId: idOf(c.companyId), companyName: str(c.companyName), kind: str(c.kind), typeKey: str(c.typeKey),
    title: str(c.title), subject: str(c.subject) ?? '', body: str(c.body), issueDate: iso(c.issueDate),
    signatory: { name: str(c.signatory?.name) || null, title: str(c.signatory?.title) || null },
    recipient: { name: str(c.recipient?.name), email: str(c.recipient?.email) || null, position: str(c.recipient?.position) || null },
    status: str(c.status), revokeReason: str(c.revokeReason) || null,
})
export const NORMALIZE = { users: normalizeUser, salaries: normalizeSalary, history: normalizeHistory, companies: normalizeCompany,
    projects: normalizeProject, milestones: normalizeMilestone, expenses: normalizeExpense, certificates: normalizeCertificate }

/** No money attached yet: may exist (or go) without a signed entry. Same rule as the server. */
export const freeOfMoney = (type, s) =>
    (type === 'projects' && (s?.budget ?? 0) === 0)
    || (type === 'milestones' && s?.paymentPercentage === 0 && s?.paymentAmount === 0 && s?.paymentStatus === 'unpaid')
    || (type === 'expenses' && s?.status === 'pending' && !s?.isDeleted)

/* ---------------- money: cents, like the server ---------------- */

const toCents = v => Math.round((v + Number.EPSILON) * 100)
export const round2 = v => toCents(v) / 100
const sumMoney = vals => vals.reduce((t, v) => t + toCents(v), 0) / 100
/** Expense taxes and totals, exactly like the website (backend expense.controller computeTaxes). */
export const computeTaxes = (amount, taxes = []) => {
    const cents = toCents(amount)
    const calculated = taxes.map(t => ({ name: t.name, percentage: t.percentage, amount: Math.round((cents * t.percentage) / 100) / 100 }))
    const totalTax = sumMoney(calculated.map(t => t.amount))
    return { taxes: calculated, totalTax, totalAmount: sumMoney([amount, totalTax]) }
}

export const computeTotals = ({ salary, allowances = [], deductions = [] }) => {
    const totalAllowances = sumMoney(allowances.map(a => a.amount))
    const totalDeductions = sumMoney(deductions.map(d => d.amount))
    const grossAmount = sumMoney([salary, totalAllowances])
    const netPay = round2(grossAmount - totalDeductions)
    if (netPay < 0) throw new Error('Deductions cannot be more than the gross pay')
    return { totalAllowances, totalDeductions, grossAmount, netPay }
}

/* ---------------- integrity ---------------- */

const parseKey = key => { const m = /^(users|salaries|history|companies|projects|milestones|expenses|certificates)\/([0-9a-f]{24})$/.exec(key); return m ? { type: m[1], id: m[2] } : null }

/** Latest signed state per record, from history entries whose stored body matches the signed body hash. */
export const latestSignedStates = async entries => {
    const latest = new Map()
    const adopted = new Set()
    let lastAdoptSeq = 0
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
        if (!e.body || (await sha256Hex(e.body)) !== e.request.bodyHash) continue
        let result = null
        try { result = e.result ? JSON.parse(e.result) : null } catch { /* */ }
        if (result && result.ok === false) continue
        let body
        try { body = JSON.parse(e.body) } catch { continue }
        if (body?.action === 'adopt' && Array.isArray(body.types)) { body.types.forEach(t => RECORD_TYPES.includes(t) && adopted.add(t)); lastAdoptSeq = e.seq }
        if (!Array.isArray(body?.changes)) continue
        for (const c of body.changes) {
            if (typeof c?.key !== 'string' || !parseKey(c.key)) continue
            latest.set(c.key, { seq: e.seq, action: String(body.action), signature: typeof body.signatureSha256 === 'string', ...('state' in c ? { state: c.state } : {}), ...(c.hash ? { hash: c.hash } : {}) })
        }
    }
    return { latest, adopted, lastAdoptSeq }
}

export const diffStates = (signed, now, path = '') => {
    if (canonicalJson(signed) === canonicalJson(now)) return []
    const isObj = v => v && typeof v === 'object' && !Array.isArray(v)
    if (isObj(signed) && isObj(now)) {
        const keys = [...new Set([...Object.keys(signed), ...Object.keys(now)])].sort()
        return keys.flatMap(k => diffStates(signed[k], now[k], path ? `${path}.${k}` : k))
    }
    return [{ field: path || '(record)', signed, now }]
}

export const pendingMatchesProfile = (s, profile) => {
    if (!profile || s.status !== 'pending') return false
    const allowances = (profile.salary?.allowances ?? []).filter(a => a?.name && typeof a.amount === 'number' && a.amount > 0)
    return s.salary === profile.salary?.amount && s.currency === (profile.salary?.currency || 'AED') && s.companyId === profile.companyId
        && canonicalJson(s.allowances) === canonicalJson(allowances) && s.deductions.length === 0 && !s.paymentDetails && !s.notes
}

/** Every record vs. its latest signed state. records: [{ key, label, state }] as the server reports them. */
export const checkIntegrity = async (entries, records, types = RECORD_TYPES) => {
    const { latest, adopted } = await latestSignedStates(entries)
    const flags = []
    const notAdopted = {}
    const present = new Set()
    const signedOf = key => { const l = latest.get(key); return l && 'state' in l ? l.state : undefined }
    for (const r of records) {
        const type = parseKey(r.key)?.type
        if (!type) continue
        present.add(r.key)
        const l = latest.get(r.key)
        if (!l) {
            if (!adopted.has(type)) { notAdopted[type] = (notAdopted[type] ?? 0) + 1; continue }
            if (type === 'salaries' && pendingMatchesProfile(r.state, signedOf(`users/${r.state.employeeId}`))) continue
            if (freeOfMoney(type, r.state)) continue
            flags.push({ key: r.key, label: r.label, problem: type === 'salaries' && r.state.status === 'pending'
                ? 'pending salary does not match the signed pay profile of the employee'
                : 'no signed entry: created or changed outside the Owner Console' })
            continue
        }
        if ('state' in l && l.state === null) { flags.push({ key: r.key, label: r.label, problem: `deleted by signed entry #${l.seq} but still present` }); continue }
        if (type === 'expenses' && 'state' in l && l.state?.status === 'pending' && freeOfMoney(type, r.state)) continue
        if (type === 'certificates' && r.signed && !l.signature) flags.push({ key: r.key, label: r.label, problem: `marked as signed, but signed entry #${l.seq} carried no signature` })
        const expected = 'state' in l ? await stateHash(r.key, l.state) : l.hash
        if (expected !== await stateHash(r.key, r.state)) {
            flags.push({ key: r.key, label: r.label, problem: `differs from signed entry #${l.seq}`, ...('state' in l ? { fields: diffStates(l.state, r.state) } : {}) })
        }
    }
    for (const [key, l] of latest) {
        const t = parseKey(key).type
        if (!types.includes(t) || present.has(key)) continue
        if ('state' in l && (l.state === null || freeOfMoney(t, l.state))) continue
        flags.push({ key, label: key, problem: `signed in entry #${l.seq} but missing from the database` })
    }
    return { ok: flags.length === 0, checked: records.length, adoptedTypes: [...adopted], notAdopted, flags, latest }
}

/** A new record id (MongoDB ObjectId format: 4-byte time + 8 random bytes). */
export const newRecordId = () => {
    const t = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
    return t + [...globalThis.crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('')
}
