// Unit tests for owner-console/src/vault.js (locked values) and the Phase 2 parts of integrity.js.
// Run: node --test owner-console/test/vault.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/crypto.js'
import * as V from '../src/vault.js'
import * as I from '../src/integrity.js'

const key = () => globalThis.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
const pid = 'aaaaaaaaaaaaaaaaaaaaaaaa', pid2 = 'bbbbbbbbbbbbbbbbbbbbbbbb', mid = 'cccccccccccccccccccccccc'
const at = (collection, id, field) => ({ collection, id, field })
const fails = (p, code = 'VAULT_UNLOCK_FAILED') => assert.rejects(p, e => e.message === code)

test('format: SMBV1.<16-char IV>.<ciphertext>, fresh IV every time, exact numbers back', async () => {
    const k = await key()
    const a = await V.lockValue(k, at('projects', pid, 'budget'), 987654.32), b = await V.lockValue(k, at('projects', pid, 'budget'), 987654.32)
    assert.match(a, /^SMBV1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/)
    assert.ok(V.isLocked(a)); assert.notEqual(a, b)
    assert.equal(await V.unlockValue(k, at('projects', pid, 'budget'), a), 987654.32)
    assert.equal(await V.unlockValue(k, at('ownerlogs', 'n1', 'body'), await V.lockValue(k, at('ownerlogs', 'n1', 'body'), '{"a":"ü"}')), '{"a":"ü"}')
    assert.equal(V.isLocked(12), false); assert.equal(V.isLocked('SMBV1.short.x'), false)
})

test('a locked value moved to another record, field or collection, edited, or under another key does not unlock', async () => {
    const k = await key(), v = await V.lockValue(k, at('projects', pid, 'budget'), 5000)
    await fails(V.unlockValue(k, at('projects', pid2, 'budget'), v))
    await fails(V.unlockValue(k, at('milestones', pid, 'budget'), v))
    await fails(V.unlockValue(k, at('projects', pid, 'paymentAmount'), v))
    const i = v.length - 4
    await fails(V.unlockValue(k, at('projects', pid, 'budget'), v.slice(0, i) + (v[i] === 'A' ? 'B' : 'A') + v.slice(i + 1)))
    await fails(V.unlockValue(await key(), at('projects', pid, 'budget'), v))
    await fails(V.unlockValue(k, at('projects', pid, 'budget'), 'SMBV2.xxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyy'), 'VAULT_UNKNOWN_VERSION')
    await fails(V.unlockValue(k, at('projects', pid, 'budget'), 5000), 'VAULT_NOT_LOCKED')
})

test('lockState / unlockState lock only the money fields; normalisers keep locked values', async () => {
    const k = await key()
    const s = I.normalizeMilestone({ projectId: pid, paymentMode: 'percentage', paymentPercentage: 30, paymentAmount: 300, currency: 'AED', paymentStatus: 'paid', invoicedAt: '2026-01-01', paidAt: '2026-01-02' })
    const locked = await V.lockState(k, `milestones/${mid}`, s)
    assert.ok(V.isLocked(locked.paymentPercentage) && V.isLocked(locked.paymentAmount))
    assert.equal(locked.paymentStatus, 'paid'); assert.equal(locked.currency, 'AED')
    assert.equal(I.canonicalJson(I.normalizeMilestone(locked)), I.canonicalJson(locked))
    assert.deepEqual(await V.unlockState(k, `milestones/${mid}`, locked), s)
    assert.equal(I.freeOfMoney('projects', I.normalizeProject({ budget: await V.lockValue(k, at('projects', pid, 'budget'), 0) })), false)
})

test('history index: no hash for a plain amount of a locked type, a hash for a locked one; flags as the server sets them', async () => {
    const k = await key()
    const plain = { action: 'project.budget', changes: [{ key: `projects/${pid}`, state: { budget: 5000 } }] }
    assert.deepEqual(await I.historyIndex(plain), { action: 'project.budget', changes: [{ key: `projects/${pid}` }] })
    const zero = await I.historyIndex({ action: 'project.budget', changes: [{ key: `projects/${pid}`, state: { budget: 0 } }] })
    assert.equal(zero.changes[0].free, true); assert.match(zero.changes[0].hash, /^[0-9a-f]{64}$/)
    const ls = { budget: await V.lockValue(k, at('projects', pid, 'budget'), 5000) }
    const idx = await I.historyIndex({ action: 'project.budget', changes: [{ key: `projects/${pid}`, state: ls }] })
    assert.equal(idx.changes[0].hash, await I.stateHash(`projects/${pid}`, ls))
    const del = await I.historyIndex({ action: 'adopt', types: ['users', 'nope'], signatureSha256: 'x', changes: [{ key: `projects/${pid}`, state: null }, { key: 'bad', state: {} }] })
    assert.deepEqual(del, { action: 'adopt', types: ['users'], signature: true, changes: [{ key: `projects/${pid}`, deleted: true }] })
})

// A history entry with a locked body, as the console sends it after locking started.
const outerEntry = async (k, seq, body, tamper = x => x) => {
    const nonce = `nonce-${seq}-abcdefghijklmnop`, inner = JSON.stringify(body)
    const outer = tamper({ v: 2, action: body.action, index: await I.historyIndex(body), inner: { sha256: await c.sha256Hex(inner), locked: await V.lockValue(k, V.bodyPlace(nonce), inner) } })
    const text = JSON.stringify(outer)
    return { seq, action: body.action, body: text, request: { nonce, bodyHash: await c.sha256Hex(text) } }
}

test('Verify everything reads locked bodies: unlocks, checks the inner hash and the signed index; catches swaps and edits', async () => {
    const k = await key()
    const body = { action: 'project.budget', changes: [{ key: `projects/${pid}`, state: { budget: await V.lockValue(k, at('projects', pid, 'budget'), 5000) } }] }
    const good = await outerEntry(k, 1, body)
    let r = await I.readBodies([good], k)
    assert.deepEqual(r.problems, []); assert.equal(r.bodies.get(1), JSON.stringify(body))
    r = await I.readBodies([good], null)
    assert.match(r.problems[0].problem, /vault key/)
    // the same locked inner body under another entry (another one-time code) does not unlock
    const moved = { ...good, seq: 2, request: { ...good.request, nonce: 'other-nonce-abcdefgh' } }
    r = await I.readBodies([moved], k)
    assert.match(r.problems[0].problem, /does not unlock/)
    // an index that does not match the inner body (signed as such, so its hash matches)
    const lying = await outerEntry(k, 3, body, o => ({ ...o, index: { ...o.index, changes: [] } }))
    r = await I.readBodies([lying], k)
    assert.match(r.problems[0].problem, /index does not match/)
})

test('moved old bodies: unlock, match the signed body hash, and need a signed move batch with the right index', async () => {
    const k = await key()
    const body = JSON.stringify({ action: 'project.budget', changes: [{ key: `projects/${pid}`, state: { budget: 5000 } }] })
    const nonce = 'old-nonce-abcdefghijk'
    const locked = await V.lockValue(k, V.bodyPlace(nonce), body)
    const old = { seq: 1, action: 'project.budget', body: locked, request: { nonce, bodyHash: await c.sha256Hex(body) } }
    const batchBody = JSON.stringify({ action: 'vault.history', entries: [{ seq: 1, bodyHash: old.request.bodyHash, lockedSha256: await c.sha256Hex(locked), index: await I.historyIndex(JSON.parse(body)) }] })
    const batch = { seq: 2, action: 'vault.history', body: batchBody, request: { nonce: 'b', bodyHash: await c.sha256Hex(batchBody) } }
    let r = await I.readBodies([old, batch], k)
    assert.deepEqual(r.problems, []); assert.equal(r.bodies.get(1), body)
    r = await I.readBodies([old], k)
    assert.match(r.problems[0].problem, /no signed move batch/)
    const forged = await V.lockValue(k, V.bodyPlace(nonce), body.replace('5000', '6000'))
    r = await I.readBodies([{ ...old, body: forged }, batch], k)
    assert.match(r.problems[0].problem, /does not match the signed body hash/)
})

test('money rules (moved from the server): budget, over 100%, percentage and amount must match the budget', () => {
    const ms = [{ paymentMode: 'percentage', paymentPercentage: 60 }, { paymentMode: 'amount', paymentAmount: 300 }]
    assert.doesNotThrow(() => I.checkBudget(1000, ms))
    assert.throws(() => I.checkBudget(500, ms), /would be 120%/)
    assert.throws(() => I.checkBudget(-1, []), /0 or more/)
    assert.throws(() => I.checkBudget(10.001, []), /0 or more/)
    const s = { paymentMode: 'percentage', paymentPercentage: 30, paymentAmount: 300, currency: 'AED' }
    assert.doesNotThrow(() => I.checkMilestonePayment(s, 1000, [{ paymentMode: 'percentage', paymentPercentage: 70 }]))
    assert.throws(() => I.checkMilestonePayment(s, 1000, [{ paymentMode: 'percentage', paymentPercentage: 71 }]), /cannot exceed 100%/)
    assert.throws(() => I.checkMilestonePayment({ ...s, paymentAmount: 301 }, 1000, []), /do not match/)
    assert.throws(() => I.checkMilestonePayment({ ...s, paymentMode: 'amount', paymentPercentage: 0, paymentAmount: 5 }, 0, []), /budget is 0/)
    assert.throws(() => I.checkMilestonePayment({ ...s, paymentPercentage: 101, paymentAmount: 1010 }, 1000, []), /0-100%/)
})

test('finance totals: per currency, never mixed; remaining budget subtracts only budget-currency expenses', () => {
    const t = I.financeTotals(
        [{ id: 'p1', name: 'P1', budget: 1000, milestones: [{ paymentMode: 'percentage', paymentPercentage: 30, paymentStatus: 'paid' }, { paymentMode: 'amount', paymentAmount: 100, paymentStatus: 'invoiced' }] }],
        [{ projectId: 'p1', status: 'approved', totalAmount: 50.5, currency: 'AED', date: '2026-11-03T00:00:00.000Z' },
            { projectId: 'p1', status: 'reimbursed', totalAmount: 20, currency: 'USD', date: '2026-10-03T00:00:00.000Z' },
            { projectId: 'p1', status: 'pending', totalAmount: 7, currency: 'AED', date: '2026-11-03T00:00:00.000Z' },
            { projectId: 'p1', status: 'approved', totalAmount: 999, currency: 'AED', isDeleted: true }], '2026-11')
    assert.deepEqual(t.spent, { AED: 50.5, USD: 20 }); assert.deepEqual(t.thisMonth, { AED: 50.5 }); assert.deepEqual(t.pending, { AED: 7 })
    assert.equal(t.remainingBudget, 949.5)
    assert.deepEqual(t.milestones, { allocated: 400, paid: 300, invoiced: 100 })
    assert.equal(t.perProject[0].allocatedPercent, 40); assert.equal(t.perProject[0].remaining, 949.5)
})
