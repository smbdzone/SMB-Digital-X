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
