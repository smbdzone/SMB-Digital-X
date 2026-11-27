// Unit tests for owner-console/src/crypto.js (the same file the console uses). Run: node --test owner-console/test/
import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/crypto.js'

// Fewer iterations keep the tests fast; one test runs the real 3,000,000 and reports the time.
const IT = 10_000
const PASS = 'velvet orbit candle tundra mosaic'
const subtle = globalThis.crypto.subtle

const setup = async () => {
    const keys = await c.createKeys()
    const salt = c.randomBytes(16), recSalt = c.randomBytes(16)
    const recovery = c.makeRecoveryKey()
    const byPassphrase = await c.lockKeys(await c.kekFromPassphrase(PASS, salt, IT), keys)
    const byRecovery = await c.lockKeys(await c.kekFromRecovery(recovery.bytes, recSalt), keys)
    const vaultRaw = new Uint8Array(await subtle.exportKey('raw', keys.vaultKey))
    return { keys, salt, recSalt, recovery, byPassphrase, byRecovery, publicKey: c.toB64(keys.publicKey), vaultRaw }
}

// Same vault key? Encrypt with one, decrypt with the other.
const sameVault = async (a, b) => {
    const iv = c.randomBytes(12)
    const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, a, new TextEncoder().encode('vault test'))
    return new TextDecoder().decode(await subtle.decrypt({ name: 'AES-GCM', iv }, b, ct)) === 'vault test'
}

test('passphrase: lock and unlock gives back working keys; unlocked keys are not extractable', async () => {
    const s = await setup()
    const k = await c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT), s.byPassphrase)
    assert.equal(await c.keyMatchesPublic(k.signingKey, s.publicKey), true)
    assert.equal(await sameVault(s.keys.vaultKey, k.vaultKey), true)
    assert.equal(k.signingKey.extractable, false)
    assert.equal(k.vaultKey.extractable, false)
    await assert.rejects(subtle.exportKey('pkcs8', k.signingKey))
})

test('wrong passphrase, wrong salt, wrong iteration count, or a changed blob all fail', async () => {
    const s = await setup()
    await assert.rejects(c.unlockKeys(await c.kekFromPassphrase(PASS + 'x', s.salt, IT), s.byPassphrase), /UNLOCK_FAILED/)
    await assert.rejects(c.unlockKeys(await c.kekFromPassphrase(PASS, c.randomBytes(16), IT), s.byPassphrase), /UNLOCK_FAILED/)
    await assert.rejects(c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT + 1), s.byPassphrase), /UNLOCK_FAILED/)
    const bad = structuredClone(s.byPassphrase)
    const d = c.fromB64(bad.signing.data); d[5] ^= 1; bad.signing.data = c.toB64(d)
    await assert.rejects(c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT), bad), /UNLOCK_FAILED/)
    const swapped = { vault: s.byPassphrase.signing, signing: s.byPassphrase.vault }   // labels are bound (AAD)
    await assert.rejects(c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT), swapped), /UNLOCK_FAILED/)
})

test('recovery key unlocks the same keys; typed with spaces, lowercase, O for 0 still works; a wrong one fails', async () => {
    const s = await setup()
    assert.match(s.recovery.text, /^([0-9A-HJKMNP-TV-Z]{4}-){7}[0-9A-HJKMNP-TV-Z]{4}$/)
    const typed = s.recovery.text.toLowerCase().replace(/-/g, ' ').replace(/0/g, 'o')
    const k = await c.unlockKeys(await c.kekFromRecovery(c.parseRecoveryKey(typed), s.recSalt), s.byRecovery)
    assert.equal(await c.keyMatchesPublic(k.signingKey, s.publicKey), true)
    assert.equal(await sameVault(s.keys.vaultKey, k.vaultKey), true)
    const other = c.makeRecoveryKey()
    await assert.rejects(c.unlockKeys(await c.kekFromRecovery(other.bytes, s.recSalt), s.byRecovery), /UNLOCK_FAILED/)
    assert.throws(() => c.parseRecoveryKey('ABCD-EFGH'), /32 letters/)
})

test('change passphrase: rewrap; the new passphrase works, the old one no longer does, keys unchanged', async () => {
    const s = await setup()
    const ex = await c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT), s.byPassphrase, true)
    const salt2 = c.randomBytes(16)
    const NEW = 'granite lantern hollow saffron meadow'
    const locked2 = await c.lockKeys(await c.kekFromPassphrase(NEW, salt2, IT), { vaultKey: ex.vaultKey, signingKey: ex.signingKey })
    const k = await c.unlockKeys(await c.kekFromPassphrase(NEW, salt2, IT), locked2)
    assert.equal(await c.keyMatchesPublic(k.signingKey, s.publicKey), true)
    assert.equal(await sameVault(s.keys.vaultKey, k.vaultKey), true)
    await assert.rejects(c.unlockKeys(await c.kekFromPassphrase(PASS, salt2, IT), locked2), /UNLOCK_FAILED/)
})

test('forgot passphrase: recovery key -> new passphrase', async () => {
    const s = await setup()
    const ex = await c.unlockKeys(await c.kekFromRecovery(s.recovery.bytes, s.recSalt), s.byRecovery, true)
    const salt2 = c.randomBytes(16)
    const NEW = 'copper willow tangent ember quiver'
    const locked2 = await c.lockKeys(await c.kekFromPassphrase(NEW, salt2, IT), ex)
    const k = await c.unlockKeys(await c.kekFromPassphrase(NEW, salt2, IT), locked2)
    assert.equal(await c.keyMatchesPublic(k.signingKey, s.publicKey), true)
})

test('signed request: verifies; any change to method, path, body, time or nonce, or another key, fails', async () => {
    const s = await setup()
    const k = await c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT), s.byPassphrase)
    const pub = await c.importPublicKey(s.publicKey)
    const body = JSON.stringify({ a: 1 })
    const h = await c.signRequest(k.signingKey, { method: 'POST', path: '/api/owner/x?y=1', body })
    const req = { method: 'POST', path: '/api/owner/x?y=1', bodyHash: h.bodyHash, ts: Number(h['X-Owner-Ts']), nonce: h['X-Owner-Nonce'], sig: h['X-Owner-Sig'] }
    assert.equal(await c.verifyRequestSignature(pub, req), true)
    assert.equal(await c.verifyRequestSignature(pub, { ...req, method: 'PUT' }), false)
    assert.equal(await c.verifyRequestSignature(pub, { ...req, path: '/api/owner/x?y=2' }), false)
    assert.equal(await c.verifyRequestSignature(pub, { ...req, bodyHash: await c.sha256Hex(JSON.stringify({ a: 2 })) }), false)
    assert.equal(await c.verifyRequestSignature(pub, { ...req, ts: req.ts + 1 }), false)
    assert.equal(await c.verifyRequestSignature(pub, { ...req, nonce: 'other' }), false)
    const other = await c.createKeys()
    assert.equal(await c.verifyRequestSignature(await c.importPublicKey(c.toB64(other.publicKey)), req), false)
})

test('history chain: valid chain passes; editing, deleting, reordering or a forged signature is reported', async () => {
    const s = await setup()
    const k = await c.unlockKeys(await c.kekFromPassphrase(PASS, s.salt, IT), s.byPassphrase)
    const entries = []
    let prev = c.GENESIS
    for (let i = 1; i <= 4; i++) {
        const h = await c.signRequest(k.signingKey, { method: 'POST', path: `/api/owner/act/${i}`, body: '' })
        const e = { seq: i, at: new Date(2026, 10, i).toISOString(), action: 'test', recordId: String(i),
            request: { method: 'POST', path: `/api/owner/act/${i}`, bodyHash: h.bodyHash, ts: Number(h['X-Owner-Ts']), nonce: h['X-Owner-Nonce'], sig: h['X-Owner-Sig'] },
            result: JSON.stringify({ ok: true }), prevHash: prev }
        e.hash = await c.entryHash(e)
        prev = e.hash
        entries.push(e)
    }
    const good = await c.verifyChain(entries, s.publicKey)
    assert.equal(good.ok, true); assert.equal(good.count, 4); assert.equal(good.head, prev)

    const edited = structuredClone(entries); edited[1].result = JSON.stringify({ ok: false })
    assert.deepEqual((await c.verifyChain(edited, s.publicKey)).problems.map(p => p.seq), [2])

    const rehashed = structuredClone(entries); rehashed[1].recordId = '99'; rehashed[1].hash = await c.entryHash(rehashed[1])
    const r = await c.verifyChain(rehashed, s.publicKey)
    assert.equal(r.ok, false); assert.ok(r.problems.some(p => p.seq === 3 && /link/.test(p.problem)))

    const deleted = entries.filter(e => e.seq !== 3)
    assert.equal((await c.verifyChain(deleted, s.publicKey)).ok, false)

    const forged = structuredClone(entries)
    forged[3].request.path = '/api/owner/act/forged'
    forged[3].hash = await c.entryHash(forged[3])
    assert.ok((await c.verifyChain(forged, s.publicKey)).problems.some(p => p.seq === 4 && /signature/.test(p.problem)))

    const truncated = entries.slice(0, 3)
    const t = await c.verifyChain(truncated, s.publicKey)
    assert.equal(t.ok, true)     // a shorter chain is valid by itself: the console's remembered count catches this
    assert.notEqual(t.head, good.head)
})

test('fingerprint is stable and readable', async () => {
    const s = await setup()
    const f = await c.fingerprint(s.publicKey)
    assert.match(f, /^([0-9A-F]{4} ){7}[0-9A-F]{4}$/)
    assert.equal(f, await c.fingerprint(c.fromB64(s.publicKey)))
})

test('passphrase rules: 20 characters or 5 words; common and repetitive phrases refused', () => {
    const common = ['correct horse battery staple', 'the quick brown fox jumps over the lazy dog']
    assert.equal(c.checkPassphrase('short one').ok, false)
    assert.equal(c.checkPassphrase('four short words ok').ok, false)
    assert.equal(c.checkPassphrase('velvet orbit candle tundra mosaic').ok, true)
    assert.equal(c.checkPassphrase('Gx7#mQ2!vR9$kL4@pZ8&').ok, true)
    assert.equal(c.checkPassphrase('Correct Horse Battery Staple now', common).ok, false)
    assert.equal(c.checkPassphrase('the quick brown fox jumps over the lazy dog', common).ok, false)
    assert.equal(c.checkPassphrase('aaaaaaaaaaaaaaaaaaaaaaaaa').ok, false)
})

test('suggested passphrase: 5 words from the list, different each time', () => {
    const words = Array.from({ length: 7776 }, (_, i) => `w${i}`)
    const a = c.suggestPassphrase(words), b = c.suggestPassphrase(words)
    assert.equal(a.split(' ').length, 5)
    assert.ok(a.split(' ').every(w => words.includes(w)))
    assert.notEqual(a, b)
})

test('real cost: 3,000,000 PBKDF2 iterations (time printed)', async () => {
    const t = performance.now()
    await c.kekFromPassphrase(PASS, c.randomBytes(16), c.PBKDF2_ITERATIONS)
    const ms = Math.round(performance.now() - t)
    console.log(`    PBKDF2-SHA256 x ${c.PBKDF2_ITERATIONS.toLocaleString('en-US')}: ${ms} ms in Node on this machine`)
    assert.ok(ms > 0)
})
