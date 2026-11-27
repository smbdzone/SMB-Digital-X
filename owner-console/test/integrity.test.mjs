// Unit tests for owner-console/src/integrity.js (records check). Run: node --test owner-console/test/integrity.test.mjs
// The live API tests also check that the backend computes the same canonical form and hashes.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/crypto.js'
import * as I from '../src/integrity.js'

const uid = 'aaaaaaaaaaaaaaaaaaaaaaaa', sid = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const person = I.normalizeUser({ name: ' Ann ', email: 'Ann@X.test', role: 'employee', status: 'active', companyId: 'cccccccccccccccccccccccc', salary: { amount: 5000, currency: 'AED', allowances: [{ name: 'Housing', amount: 1000 }] }, bankDetails: { iban: 'AE01' } })
const salary = (() => { const s = I.normalizeSalary({ employeeId: uid, companyId: 'cccccccccccccccccccccccc', month: '2026-12', currency: 'AED', salary: 5000, allowances: [{ name: 'Housing', amount: 1000 }], deductions: [], status: 'pending' }); return { ...s, ...I.computeTotals(s) } })()

/** A history entry whose stored body matches its signed body hash (signature not needed for the records check). */
let seq = 0
const entry = async (body, result = { ok: true }) => { const text = JSON.stringify(body); return { seq: ++seq, body: text, request: { bodyHash: await c.sha256Hex(text) }, result: JSON.stringify(result) } }

test('canonical JSON ignores key order; normalisers are stable', () => {
    assert.equal(I.canonicalJson({ b: 1, a: [2, { d: 0, c: -0 }] }), I.canonicalJson({ a: [2, { c: 0, d: 0 }], b: 1 }))
    assert.equal(person.name, 'Ann'); assert.equal(person.email, 'ann@x.test'); assert.equal(person.bankDetails.holderName, null)
    assert.equal(I.canonicalJson(I.normalizeUser(person)), I.canonicalJson(person))
    assert.equal(I.canonicalJson(I.normalizeSalary(salary)), I.canonicalJson(salary))
})

test('salary totals in cents: no floating point errors; negative net refused', () => {
    assert.deepEqual(I.computeTotals({ salary: 0.1, allowances: [{ name: 'a', amount: 0.2 }], deductions: [] }), { totalAllowances: 0.2, totalDeductions: 0, grossAmount: 0.3, netPay: 0.3 })
    assert.throws(() => I.computeTotals({ salary: 10, deductions: [{ name: 'x', amount: 11 }] }), /Deductions/)
})

test('records check: not adopted -> counted, not flagged; adopted -> matches', async () => {
    seq = 0
    const records = [{ key: `users/${uid}`, label: 'Ann', state: person }, { key: `salaries/${sid}`, label: 'Dec', state: salary }]
    let r = await I.checkIntegrity([], records)
    assert.equal(r.ok, true); assert.deepEqual(r.notAdopted, { users: 1, salaries: 1 })
    const adopt = await entry({ action: 'adopt', types: ['users', 'salaries', 'history'], changes: records.map(x => ({ key: x.key, state: x.state })) })
    r = await I.checkIntegrity([adopt], records)
    assert.equal(r.ok, true); assert.deepEqual(r.notAdopted, {})
})

test('records check: field changes, rollback, unsigned records, missing records, forged bodies', async () => {
    seq = 0
    const records = [{ key: `users/${uid}`, label: 'Ann', state: person }, { key: `salaries/${sid}`, label: 'Dec', state: salary }]
    const adopt = await entry({ action: 'adopt', types: ['users', 'salaries', 'history'], changes: records.map(x => ({ key: x.key, state: x.state })) })
    const newBank = { ...person, bankDetails: { ...person.bankDetails, iban: 'AE02' } }
    const change = await entry({ action: 'user.update', changes: [{ key: `users/${uid}`, state: newBank }] })

    // the record still has the old IBAN (an older signed state put back): flagged, field named
    let r = await I.checkIntegrity([adopt, change], records)
    const f = r.flags.find(x => x.key === `users/${uid}`)
    assert.deepEqual(f.fields, [{ field: 'bankDetails.iban', signed: 'AE02', now: 'AE01' }])

    // salary paid outside the console
    r = await I.checkIntegrity([adopt], [records[0], { ...records[1], state: { ...salary, status: 'paid' } }])
    assert.deepEqual(r.flags[0].fields, [{ field: 'status', signed: 'pending', now: 'paid' }])

    // a new admin with no signed entry
    const evil = { key: 'users/dddddddddddddddddddddddd', label: 'Evil', state: { ...person, role: 'admin' } }
    r = await I.checkIntegrity([adopt], [...records, evil])
    assert.match(r.flags[0].problem, /no signed entry/)

    // a signed record deleted from the database
    r = await I.checkIntegrity([adopt], [records[0]])
    assert.match(r.flags[0].problem, /missing/)

    // a stored body edited after signing does not count
    const forged = { ...change, body: change.body.replace('AE02', 'AE01') }
    r = await I.checkIntegrity([adopt, forged], records)
    assert.equal(r.ok, true)   // the forged entry is ignored: the record is compared with the adopted state, which it matches

    // an entry the server marked as failed does not count either
    const failed = await entry({ action: 'user.update', changes: [{ key: `users/${uid}`, state: newBank }] }, { ok: false })
    r = await I.checkIntegrity([adopt, failed], records)
    assert.equal(r.ok, true)
})

test('pending salaries made by the payroll job: fine if they match the signed pay profile', async () => {
    seq = 0
    const adopt = await entry({ action: 'adopt', types: ['users', 'salaries', 'history'], changes: [{ key: `users/${uid}`, state: person }] })
    const ok = { key: `salaries/${sid}`, label: 'Dec', state: salary }
    assert.equal((await I.checkIntegrity([adopt], [{ key: `users/${uid}`, label: 'Ann', state: person }, ok])).ok, true)
    const inflated = { ...ok, state: { ...salary, salary: 9000, ...I.computeTotals({ ...salary, salary: 9000 }) } }
    const r = await I.checkIntegrity([adopt], [{ key: `users/${uid}`, label: 'Ann', state: person }, inflated])
    assert.match(r.flags[0].problem, /does not match the signed pay profile/)
})

test('new record ids look like MongoDB ObjectIds and differ', () => {
    const a = I.newRecordId(), b = I.newRecordId()
    assert.match(a, /^[0-9a-f]{24}$/); assert.notEqual(a, b)
})

/* ---------------- Phase 1b-ii record types ---------------- */
const pid = 'dddddddddddddddddddddddd', mid = 'eeeeeeeeeeeeeeeeeeeeeeee', xid = 'ffffffffffffffffffffffff', lid = '0123456789abcdef01234567'
const allTypes = ['users', 'salaries', 'history', 'companies', 'projects', 'milestones', 'expenses', 'certificates']

test('expense taxes in cents, like the website', () => {
    assert.deepEqual(I.computeTaxes(3900, [{ name: 'VAT', percentage: 5 }]), { taxes: [{ name: 'VAT', percentage: 5, amount: 195 }], totalTax: 195, totalAmount: 4095 })
    assert.deepEqual(I.computeTaxes(0.1, [{ name: 'A', percentage: 10 }, { name: 'B', percentage: 20 }]).totalAmount, 0.13)
    assert.deepEqual(I.computeTaxes(100), { taxes: [], totalTax: 0, totalAmount: 100 })
})

test('no money yet: a budget-0 project, an unpaid 0% milestone and a pending expense need no signed entry', async () => {
    seq = 0
    const adopt = await entry({ action: 'adopt', types: allTypes, changes: [] })
    const free = [
        { key: `projects/${pid}`, label: 'P', state: I.normalizeProject({ budget: 0 }) },
        { key: `milestones/${mid}`, label: 'M', state: I.normalizeMilestone({ projectId: pid }) },
        { key: `expenses/${xid}`, label: 'X', state: I.normalizeExpense({ amount: 10, totalAmount: 10, currency: 'AED', status: 'pending' }) },
    ]
    assert.equal((await I.checkIntegrity([adopt], free)).ok, true)
    const money = [
        { ...free[0], state: { budget: 5 } },
        { ...free[1], state: { ...free[1].state, paymentStatus: 'paid' } },
        { ...free[2], state: { ...free[2].state, status: 'approved' } },
    ]
    const r = await I.checkIntegrity([adopt], money)
    assert.equal(r.flags.length, 3); r.flags.forEach(f => assert.match(f.problem, /no signed entry/))
})

test('expenses: signed pending, edited by the employee while pending -> fine; approved outside -> flagged', async () => {
    seq = 0
    const pending = I.normalizeExpense({ amount: 10, totalAmount: 10, currency: 'AED', status: 'pending' })
    const signed = await entry({ action: 'adopt', types: allTypes, changes: [{ key: `expenses/${xid}`, state: pending }] })
    const edited = { key: `expenses/${xid}`, label: 'X', state: { ...pending, amount: 12, totalAmount: 12 } }
    assert.equal((await I.checkIntegrity([signed], [edited])).ok, true)
    const r = await I.checkIntegrity([signed], [{ ...edited, state: { ...pending, status: 'approved' } }])
    assert.deepEqual(r.flags[0].fields, [{ field: 'status', signed: 'pending', now: 'approved' }])
    // a signed pending expense that disappears is fine (the employee may delete it while pending)
    assert.equal((await I.checkIntegrity([signed], [])).ok, true)
})

test('letters: "signed" must come from a signed entry that carried a signature', async () => {
    seq = 0
    const letter = I.normalizeCertificate({ employeeId: uid, companyId: 'cccccccccccccccccccccccc', companyName: 'Co', kind: 'letter', typeKey: 'experience_letter', title: 'Experience Letter', body: 'Text', issueDate: '2026-11-27', recipient: { name: 'Ann' }, status: 'issued' })
    assert.equal(letter.subject, ''); assert.equal(letter.issueDate, '2026-11-27T00:00:00.000Z')
    const plain = await entry({ action: 'letter.issue', changes: [{ key: `certificates/${lid}`, state: letter }] })
    const adopt = await entry({ action: 'adopt', types: allTypes, changes: [] })
    const rec = { key: `certificates/${lid}`, label: 'L', state: letter }
    assert.equal((await I.checkIntegrity([adopt, plain], [rec])).ok, true)
    let r = await I.checkIntegrity([adopt, plain], [{ ...rec, signed: true }])
    assert.match(r.flags[0].problem, /marked as signed/)
    const withSig = await entry({ action: 'letter.resend', signatureSha256: 'ab'.repeat(32), changes: [{ key: `certificates/${lid}`, state: letter }] })
    assert.equal((await I.checkIntegrity([adopt, plain, withSig], [{ ...rec, signed: true }])).ok, true)
    r = await I.checkIntegrity([adopt, plain, withSig], [{ ...rec, signed: true, state: { ...letter, body: 'Other' } }])
    assert.deepEqual(r.flags[0].fields, [{ field: 'body', signed: 'Text', now: 'Other' }])
})

test('companies and milestone payments: field-level differences; a deleted project with a budget is "missing"', async () => {
    seq = 0
    const co = I.normalizeCompany({ name: 'Co', code: 'co', currency: 'AED', brandColor: '#000000', signatory: { name: 'S' } })
    const ms = I.normalizeMilestone({ projectId: pid, paymentPercentage: 30, paymentAmount: 300, paymentStatus: 'invoiced', invoicedAt: '2026-11-01' })
    const adopt = await entry({ action: 'adopt', types: allTypes, changes: [
        { key: `companies/${uid}`, state: co }, { key: `milestones/${mid}`, state: ms }, { key: `projects/${pid}`, state: { budget: 1000 } }] })
    const now = [{ key: `companies/${uid}`, label: 'C', state: { ...co, signatory: { ...co.signatory, name: 'Fake' } } }, { key: `milestones/${mid}`, label: 'M', state: { ...ms, paymentStatus: 'paid' } }]
    const r = await I.checkIntegrity([adopt], now)
    assert.deepEqual(r.flags.map(f => f.fields?.[0]?.field ?? f.problem), ['signatory.name', 'paymentStatus', `signed in entry #1 but missing from the database`])
})
