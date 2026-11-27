/*
 * Owner-controlled records in the console: canonical form, state hash, normalisers, salary totals and the
 * integrity check. Same rules as backend/src/owner/ownerState.ts and salary.service.ts computeTotals:
 * keep them in step (the tests compare both).
 */
import { sha256Hex } from './crypto.js'
import { bodyPlace, isLocked, isLockedType, stateHasPlainMoney, unlockState, unlockValue } from './vault.js'

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
/** A money field that may be locked (Phase 2): the locked text as it is, else the number. */
const moneyField = v => (isLocked(v) ? v : num(v))
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
export const normalizeProject = p => ({ budget: moneyField(p.budget) ?? 0 })
export const normalizeMilestone = m => ({
    projectId: idOf(m.projectId), paymentMode: str(m.paymentMode) || 'percentage', paymentPercentage: moneyField(m.paymentPercentage) ?? 0,
    paymentAmount: moneyField(m.paymentAmount) ?? 0, currency: str(m.currency) || 'AED', paymentStatus: str(m.paymentStatus) || 'unpaid',
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

/* ---------------- money rules (Phase 2: checked here, the server can no longer read the amounts) ---------------- */

/** Share of the budget a milestone takes: the typed value wins, the other follows (same rule as the website had). */
export const percentOf = (m, budget) => (m.paymentMode === 'amount' ? (budget > 0 ? (m.paymentAmount ?? 0) / budget * 100 : 0) : (m.paymentPercentage ?? 0))

/** A project budget: 0 or more, cents; the milestones must stay within 100% of it. Throws with the reason. */
export const checkBudget = (budget, milestones) => {
    if (!(typeof budget === 'number' && budget >= 0) || round2(budget) !== budget) throw new Error('The budget must be an amount of 0 or more')
    const used = milestones.reduce((s, m) => s + percentOf(m, budget), 0)
    if (used > 100.0001) throw new Error(`With this budget the milestone payments would be ${round2(used)}% of it. Lower them first.`)
}

/** A milestone payment state (plain amounts) against its project's budget and the other milestones. Throws with the reason. */
export const checkMilestonePayment = (s, budget, others) => {
    if (s.paymentMode !== 'percentage' && s.paymentMode !== 'amount') throw new Error("paymentMode must be 'percentage' or 'amount'")
    if (!(s.paymentPercentage >= 0 && s.paymentPercentage <= 100) || !(s.paymentAmount >= 0)) throw new Error('Payment must be 0-100% and an amount of 0 or more')
    const expected = s.paymentMode === 'percentage'
        ? { paymentPercentage: s.paymentPercentage, paymentAmount: round2(budget * s.paymentPercentage / 100) }
        : { paymentPercentage: budget > 0 ? round2(s.paymentAmount / budget * 100) : 0, paymentAmount: s.paymentAmount }
    if (expected.paymentPercentage !== s.paymentPercentage || expected.paymentAmount !== s.paymentAmount) throw new Error(`Percentage and amount do not match the project budget (${budget})`)
    if (s.paymentMode === 'amount' && budget <= 0 && s.paymentAmount > 0) throw new Error('The project budget is 0. Set a budget first')
    const used = others.reduce((sum, o) => sum + percentOf(o, budget), 0) + percentOf(s, budget)
    if (used > 100.0001) throw new Error(`Milestone payments cannot exceed 100% of the project budget (this makes ${round2(used)}%)`)
    if (!/^[A-Z]{3}$/.test(s.currency)) throw new Error('currency must be a 3-letter code')
}

/**
 * The finance figures the website dashboard used to show, calculated here from unlocked data.
 *   projects: [{ id, name, budget, milestones: [plain milestone states] }]
 *   expenses: plain expense states; month: 'YYYY-MM'
 * Projects have no currency of their own: budgets are counted in BUDGET_CURRENCY (as the website did) and only
 * expenses in that currency are subtracted from them; other currencies are listed separately, never mixed.
 */
export const BUDGET_CURRENCY = 'AED'
export const financeTotals = (projects, expenses, month) => {
    const add = (t, cur, v) => { t[cur] = round2((t[cur] ?? 0) + v) }
    const counted = expenses.filter(e => !e.isDeleted && (e.status === 'approved' || e.status === 'reimbursed'))
    const spent = {}, thisMonth = {}, pending = {}
    for (const e of counted) { add(spent, e.currency ?? '?', e.totalAmount ?? 0); if (String(e.date ?? '').slice(0, 7) === month) add(thisMonth, e.currency ?? '?', e.totalAmount ?? 0) }
    for (const e of expenses.filter(x => !x.isDeleted && x.status === 'pending')) add(pending, e.currency ?? '?', e.totalAmount ?? 0)
    const perProject = projects.map(p => {
        const ms = p.milestones.map(m => ({ ...m, amount: m.paymentMode === 'amount' ? (m.paymentAmount ?? 0) : round2(p.budget * (m.paymentPercentage ?? 0) / 100) }))
        const byStatus = st => sumMoney(ms.filter(m => m.paymentStatus === st).map(m => m.amount))
        const allocated = sumMoney(ms.map(m => m.amount))
        const allocatedPercent = round2(ms.reduce((s, m) => s + percentOf(m, p.budget), 0))
        const projectSpent = {}
        for (const e of counted.filter(x => x.projectId === p.id)) add(projectSpent, e.currency ?? '?', e.totalAmount ?? 0)
        return {
            id: p.id, name: p.name, budget: p.budget, allocated, allocatedPercent, unallocated: round2(Math.max(0, p.budget - allocated)),
            paid: byStatus('paid'), invoiced: byStatus('invoiced'), notInvoiced: byStatus('unpaid'), spent: projectSpent,
            remaining: round2(p.budget - (projectSpent[BUDGET_CURRENCY] ?? 0)),
        }
    })
    const totalBudget = sumMoney(projects.map(p => p.budget))
    return {
        totalBudget, spent, thisMonth, pending,
        remainingBudget: round2(totalBudget - (spent[BUDGET_CURRENCY] ?? 0)),
        milestones: { allocated: sumMoney(perProject.map(p => p.allocated)), paid: sumMoney(perProject.map(p => p.paid)), invoiced: sumMoney(perProject.map(p => p.invoiced)) },
        perProject,
    }
}

/* ---------------- integrity ---------------- */

const parseKey = key => { const m = /^(users|salaries|history|companies|projects|milestones|expenses|certificates)\/([0-9a-f]{24})$/.exec(key); return m ? { type: m[1], id: m[2] } : null }

/*
 * The history index (Phase 2): the same function as the server's (backend/src/owner/ownerState.ts historyIndex).
 * Once locking has started, every signed body is { v: 2, action, index, inner: { sha256, locked } }; the server reads
 * only the index, and this console unlocks the inner body and checks the index against it.
 */
export const historyIndex = async body => {
    const changes = []
    for (const c of Array.isArray(body?.changes) ? body.changes : []) {
        const p = typeof c?.key === 'string' ? parseKey(c.key) : null
        if (!p) continue
        const out = { key: c.key }
        if (!('state' in c)) { if (typeof c.hash === 'string') out.hash = c.hash }
        else if (c.state === null) out.deleted = true
        else {
            // A plain amount of a locked type never goes into the index as a hash (a hash of a small state can be guessed).
            if (!(isLockedType(p.type) && stateHasPlainMoney(p.type, c.state))) out.hash = await stateHash(c.key, c.state)
            if (freeOfMoney(p.type, c.state)) out.free = true
            if (p.type === 'expenses' && c.state?.status === 'pending') out.pending = true
        }
        changes.push(out)
    }
    return {
        action: String(body?.action ?? ''),
        ...(body?.action === 'adopt' && Array.isArray(body.types) ? { types: body.types.filter(t => RECORD_TYPES.includes(t)) } : {}),
        ...(typeof body?.signatureSha256 === 'string' ? { signature: true } : {}),
        changes,
    }
}

/** The signed outer body of a Phase 2 request, or null. */
export const outerBodyOf = text => {
    let o
    try { o = JSON.parse(text) } catch { return null }
    return o && o.v === 2 && o.index && Array.isArray(o.index.changes) && typeof o.inner?.locked === 'string' ? o : null
}

/**
 * Every entry's real body, unlocked where needed, and what is wrong with any of them:
 *   - plain body (before locking): used when its hash matches the signed hash (otherwise ignored, as before)
 *   - outer body: its inner body must unlock (bound to this entry's one-time code), match inner.sha256, and say
 *     exactly what the signed index says
 *   - moved old body (a locked value): must unlock, match the signed body hash, and be covered by a signed move batch
 *     whose index matches it
 * Returns { bodies: Map(seq -> body text), problems: [{ seq, problem }] }.
 */
export const readBodies = async (entries, vaultKey) => {
    const sorted = [...entries].sort((a, b) => a.seq - b.seq)
    const problems = []
    const bodies = new Map()
    const moved = new Map()
    for (const e of sorted) {
        if (e.action !== 'vault.history' || !e.body || (await sha256Hex(e.body)) !== e.request.bodyHash) continue
        let b
        try { b = JSON.parse(e.body) } catch { continue }
        if (b?.action === 'vault.history' && Array.isArray(b.entries)) for (const m of b.entries) if (m && typeof m.seq === 'number') moved.set(m.seq, [...(moved.get(m.seq) ?? []), m])
    }
    const unlockBody = async (e, text) => {
        if (!vaultKey) { problems.push({ seq: e.seq, problem: 'its body is locked and the vault key is not unlocked' }); return null }
        try { return await unlockValue(vaultKey, bodyPlace(e.request.nonce), text) } catch {
            problems.push({ seq: e.seq, problem: 'its locked body does not unlock: it was changed, moved from another entry, or locked with another key' })
            return null
        }
    }
    for (const e of sorted) {
        if (!e.body) continue
        if (isLocked(e.body)) {
            const text = await unlockBody(e, e.body)
            if (text === null) continue
            if (typeof text !== 'string' || (await sha256Hex(text)) !== e.request.bodyHash) { problems.push({ seq: e.seq, problem: 'its unlocked body does not match the signed body hash' }); continue }
            const lockedSha = await sha256Hex(e.body)
            const m = (moved.get(e.seq) ?? []).find(x => x.lockedSha256 === lockedSha)
            let parsed = null
            try { parsed = JSON.parse(text) } catch { /* */ }
            if (!m) problems.push({ seq: e.seq, problem: 'its body was locked, but no signed move batch covers it' })
            else if (canonicalJson(m.index) !== canonicalJson(await historyIndex(parsed))) problems.push({ seq: e.seq, problem: 'the signed index in its move batch does not match its body' })
            bodies.set(e.seq, text)
            continue
        }
        if ((await sha256Hex(e.body)) !== e.request.bodyHash) continue
        const outer = outerBodyOf(e.body)
        if (!outer) { bodies.set(e.seq, e.body); continue }
        const inner = await unlockBody(e, outer.inner.locked)
        if (inner === null) continue
        let ib = null
        try { ib = JSON.parse(inner) } catch { /* */ }
        if (typeof inner !== 'string' || (await sha256Hex(inner)) !== outer.inner.sha256 || !ib) { problems.push({ seq: e.seq, problem: 'its unlocked body does not match the signed hash' }); continue }
        if (String(ib.action ?? '') !== outer.action || canonicalJson(outer.index) !== canonicalJson(await historyIndex(ib))) {
            problems.push({ seq: e.seq, problem: 'its signed index does not match its body' })
            continue
        }
        bodies.set(e.seq, inner)
    }
    return { bodies, problems }
}

/** Latest signed state per record, from the bodies readBodies accepted. */
export const latestSignedStates = async (entries, vaultKey) => {
    const latest = new Map()
    const adopted = new Set()
    let lastAdoptSeq = 0
    const { bodies, problems } = await readBodies(entries, vaultKey)
    for (const e of [...entries].sort((a, b) => a.seq - b.seq)) {
        const text = bodies.get(e.seq)
        if (text === undefined) continue
        let result = null
        try { result = e.result ? JSON.parse(e.result) : null } catch { /* */ }
        if (result && result.ok === false) continue
        let body
        try { body = JSON.parse(text) } catch { continue }
        if (body?.action === 'adopt' && Array.isArray(body.types)) { body.types.forEach(t => RECORD_TYPES.includes(t) && adopted.add(t)); lastAdoptSeq = e.seq }
        if (!Array.isArray(body?.changes)) continue
        for (const c of body.changes) {
            if (typeof c?.key !== 'string' || !parseKey(c.key)) continue
            // "signature" stays true once any signed entry for the record carried a signature hash (a later revoke keeps it signed).
            latest.set(c.key, { seq: e.seq, action: String(body.action), signature: typeof body.signatureSha256 === 'string' || latest.get(c.key)?.signature === true, ...('state' in c ? { state: c.state } : {}), ...(c.hash ? { hash: c.hash } : {}) })
        }
    }
    return { latest, adopted, lastAdoptSeq, bodyProblems: problems, bodies }
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

/** Field differences, with locked amounts unlocked for reading where they still unlock (a value that does not is shown as it is). */
const diffShown = async (key, signed, now, vaultKey) => {
    if (!vaultKey) return diffStates(signed, now)
    const open = async s => { try { return await unlockState(vaultKey, key, s) } catch { return s } }
    return diffStates(await open(signed), await open(now))
}

export const pendingMatchesProfile = (s, profile) => {
    if (!profile || s.status !== 'pending') return false
    const allowances = (profile.salary?.allowances ?? []).filter(a => a?.name && typeof a.amount === 'number' && a.amount > 0)
    return s.salary === profile.salary?.amount && s.currency === (profile.salary?.currency || 'AED') && s.companyId === profile.companyId
        && canonicalJson(s.allowances) === canonicalJson(allowances) && s.deductions.length === 0 && !s.paymentDetails && !s.notes
}

/**
 * Every record vs. its latest signed state. records: [{ key, label, state }] as the server reports them.
 * vaultKey: needed once bodies are locked (Phase 2); bodyProblems lists history bodies that failed their checks.
 */
export const checkIntegrity = async (entries, records, types = RECORD_TYPES, vaultKey = null) => {
    const { latest, adopted, bodyProblems } = await latestSignedStates(entries, vaultKey)
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
        if (type === 'certificates' && r.signed && !l.signature) flags.push({ key: r.key, label: r.label, problem: 'marked as signed, but no signed entry for it carried a signature' })
        const expected = 'state' in l ? await stateHash(r.key, l.state) : l.hash
        if (expected !== await stateHash(r.key, r.state)) {
            flags.push({ key: r.key, label: r.label, problem: `differs from signed entry #${l.seq}`, ...('state' in l ? { fields: await diffShown(r.key, l.state, r.state, vaultKey) } : {}) })
        }
    }
    for (const [key, l] of latest) {
        const t = parseKey(key).type
        if (!types.includes(t) || present.has(key)) continue
        if ('state' in l && (l.state === null || freeOfMoney(t, l.state))) continue
        flags.push({ key, label: key, problem: `signed in entry #${l.seq} but missing from the database` })
    }
    return { ok: flags.length === 0 && bodyProblems.length === 0, checked: records.length, adoptedTypes: [...adopted], notAdopted, flags, latest, bodyProblems }
}

/** A new record id (MongoDB ObjectId format: 4-byte time + 8 random bytes). */
export const newRecordId = () => {
    const t = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0')
    return t + [...globalThis.crypto.getRandomValues(new Uint8Array(8))].map(b => b.toString(16).padStart(2, '0')).join('')
}
