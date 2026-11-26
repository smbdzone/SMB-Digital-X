/**
 * Makes a SCRAMBLED copy of the database for developers.
 *
 *   SOURCE_URI="mongodb+srv://.../<production db>" \
 *   TARGET_URI="mongodb://127.0.0.1:27017/smbx_devcopy" \
 *   npx tsx scripts/make-dev-copy.ts [--overwrite]
 *
 * Every collection is copied with the same _id values, so every relation between collections
 * (employeeId, companyId, projectId, ...) still works and the app runs on the copy. On the way:
 *
 * - People: one fake identity per user ("Person 0007", person0007@dev.example), used everywhere a copy
 *   of the name or email is stored (certificates, salary slips, history, chats, free text).
 * - Money: salaries, allowances, deductions, expenses, taxes, budgets and milestone payments get random
 *   amounts; totals are recomputed so slips and expenses still add up.
 * - Bank details, IBANs, account numbers and phone numbers are replaced; every password becomes DEV_PASSWORD.
 * - Free text that can hold anything (letters: title, subject, body, filled-in values; expense descriptions
 *   and notes; salary notes; history entries; client names; vendors) is replaced with sample text.
 *   Work content (EOD reports, deliverables, tasks, project and milestone text) is kept, with every
 *   email address, phone number and employee name in it replaced.
 * - Chat message text and attachment links are blanked; receipts lose their links; push subscriptions
 *   and password reset codes are not copied.
 * - Any other field anywhere whose name looks like an email, phone, IBAN or account number, and any email
 *   address or phone number inside any text, is replaced too (so a new field cannot leak by default).
 *
 * Safety: it refuses when TARGET is the same database as SOURCE, when the target database name does not
 * look like a dev copy (DEV_COPY_TARGET_PATTERN), when it matches DEV_COPY_PROD_PATTERN (set this to the
 * real production database name), or when the target is not empty (unless --overwrite).
 */
import crypto from 'node:crypto'
import bcrypt from 'bcrypt'
import mongoose from 'mongoose'

type Doc = Record<string, any>
const { MongoClient, ObjectId } = mongoose.mongo

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const SOURCE_URI = process.env.SOURCE_URI ?? ''
const TARGET_URI = process.env.TARGET_URI ?? ''
const OVERWRITE = process.argv.includes('--overwrite')
const DEV_PASSWORD = process.env.DEV_PASSWORD || 'DevCopy#2026'
// The target database name must match this ...
const TARGET_PATTERN = new RegExp(process.env.DEV_COPY_TARGET_PATTERN || 'dev|test|copy|local|scramble', 'i')
// ... and must not match this. Set it to the real production database name before the first run.
const PROD_PATTERN = new RegExp(process.env.DEV_COPY_PROD_PATTERN || 'prod|live|production', 'i')
const BATCH = 500

const fail = (message: string): never => {
    console.error(`\nREFUSED: ${message}\n`)
    process.exit(1)
}

/* ------------------------------------------------------------------ */
/* Safety checks                                                       */
/* ------------------------------------------------------------------ */

/** Host list and database name of a connection string, without the credentials. */
const describe = (uri: string) => {
    const match = uri.match(/^mongodb(?:\+srv)?:\/\/(?:[^@/]*@)?([^/?]+)(?:\/([^?]*))?/)
    if (!match) fail('SOURCE_URI and TARGET_URI must be mongodb:// or mongodb+srv:// connection strings')
    const hosts = match![1].toLowerCase().split(',').map(h => (h.includes(':') ? h : `${h}:27017`)).sort()
    const db = decodeURIComponent(match![2] ?? '')
    return { hosts, db, shown: `${hosts.join(',')}/${db}` }
}

const checkTargets = () => {
    if (!SOURCE_URI || !TARGET_URI) fail('set SOURCE_URI and TARGET_URI')
    const source = describe(SOURCE_URI)
    const target = describe(TARGET_URI)
    if (!source.db || !target.db) fail('both connection strings must name the database, e.g. mongodb://host/mydb')
    if (SOURCE_URI.trim() === TARGET_URI.trim()) fail('TARGET_URI is the same as SOURCE_URI')
    const sameHost = source.hosts.some(h => target.hosts.includes(h))
    if (sameHost && source.db.toLowerCase() === target.db.toLowerCase()) fail(`TARGET is the same database as SOURCE (${target.shown})`)
    if (PROD_PATTERN.test(target.db)) fail(`the target database "${target.db}" matches DEV_COPY_PROD_PATTERN (${PROD_PATTERN.source}): it looks like production`)
    if (!TARGET_PATTERN.test(target.db)) fail(`the target database "${target.db}" does not look like a dev copy (DEV_COPY_TARGET_PATTERN ${TARGET_PATTERN.source})`)
    return { source, target }
}

/* ------------------------------------------------------------------ */
/* Fake values                                                         */
/* ------------------------------------------------------------------ */

const randInt = (min: number, max: number) => crypto.randomInt(min, max + 1)
/** A random amount between min and max, rounded to `step` (so it never equals an odd real amount). */
const amount = (min: number, max: number, step = 50) => Math.round(randInt(min, max) / step) * step
const pad = (n: number, size = 4) => String(n).padStart(size, '0')
const digits = (n: number) => Array.from({ length: n }, () => randInt(0, 9)).join('')

const fakePhone = () => `+000 50 ${digits(3)} ${digits(4)}`
const fakeIban = () => `XX00DEV${digits(16)}`
const fakeAccount = () => `DEV${digits(10)}`

interface Identity { name: string; email: string }
const people = new Map<string, Identity>()            // user id -> fake identity
const emailMap = new Map<string, string>()            // real email (lowercase) -> fake email
const nameMap = new Map<string, string>()             // real name -> fake name (for names inside kept text)
let nameRules: { re: RegExp; fake: string }[] = []     // built from nameMap once users and clients are read
const clientMap = new Map<string, string>()            // real client name -> "Client 001"
let otherEmails = 0

const fakeEmailFor = (real: string): string => {
    const key = real.trim().toLowerCase()
    if (key.endsWith('@dev.example')) return real   // already fake
    let fake = emailMap.get(key)
    if (!fake) {
        fake = `someone${pad(++otherEmails)}@dev.example`
        emailMap.set(key, fake)
    }
    return fake
}
const personOf = (id: unknown): Identity | undefined => (id ? people.get(String(id)) : undefined)
const nameOf = (id: unknown, fallback = 'Sample Person') => personOf(id)?.name ?? fallback

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const IBAN_RE = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g
const PHONE_RE = /\+?\d[\d ().-]{7,}\d/g
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}/

/** Replaces email addresses, phone numbers and known employee names inside a text. */
const scrubText = (text: string): string => {
    let out = text.replace(EMAIL_RE, m => fakeEmailFor(m))
    out = out.replace(IBAN_RE, m => (m.startsWith('XX00DEV') ? m : fakeIban()))
    out = out.replace(PHONE_RE, m => {
        const count = m.replace(/\D/g, '').length
        return count >= 9 && !DATE_LIKE.test(m) ? fakePhone() : m
    })
    for (const { re, fake } of nameRules) out = out.replace(re, fake)
    return out
}

const SAMPLE = 'Sample text generated for the developer copy.'
const sample = (value: unknown, text = SAMPLE) => (typeof value === 'string' && value.trim() ? text : value)

/** Sample text that keeps the {{placeholders}} of the original, so letters still render in the app. */
const sampleWithPlaceholders = (value: unknown, lead: string): unknown => {
    if (typeof value !== 'string' || !value.trim()) return value
    const tokens = [...new Set(value.match(/\{\{\s*[A-Za-z][A-Za-z0-9_]*\s*\}\}/g) ?? [])]
    return tokens.length ? `${lead} ${tokens.join(' ')}` : lead
}

/* ------------------------------------------------------------------ */
/* Generic pass: any field, any collection                             */
/* ------------------------------------------------------------------ */

const isPlainObject = (v: unknown): v is Doc =>
    !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof ObjectId)
    && !(v as any)._bsontype && !Buffer.isBuffer(v)

const scrubDeep = (value: unknown, key = ''): unknown => {
    if (typeof value === 'string') {
        if (/phone|mobile|whatsapp|tel$/i.test(key) && value.trim()) return fakePhone()
        if (/iban/i.test(key) && value.trim()) return fakeIban()
        if (/account_?number|accountNo/i.test(key) && value.trim()) return fakeAccount()
        return scrubText(value)
    }
    if (Array.isArray(value)) return value.map(v => scrubDeep(v, key))
    if (isPlainObject(value)) {
        for (const k of Object.keys(value)) value[k] = scrubDeep(value[k], k)
        return value
    }
    return value
}

/* ------------------------------------------------------------------ */
/* Per collection                                                      */
/* ------------------------------------------------------------------ */

let devHash = ''
const fakeBank = (holder: string) => ({ method: 'bank', bankName: 'Dev Bank', holderName: holder, accountNumber: fakeAccount(), iban: fakeIban() })
const lineItems = (items: unknown, min: number, max: number, step = 10) =>
    Array.isArray(items) ? items.map(i => ({ ...i, amount: amount(min, max, step) })) : items
const sum = (items: unknown) => (Array.isArray(items) ? items.reduce((s, i) => s + (Number(i?.amount) || 0), 0) : 0)

const projectBudgets = new Map<string, number>()
let signatories = 0, clients = 0, groups = 0

const transforms: Record<string, (d: Doc) => Doc | null> = {
    users: d => {
        const me = personOf(d._id)!
        d.name = me.name
        d.email = me.email
        d.password = devHash
        if (d.salary) {
            d.salary.amount = amount(3000, 30000)
            d.salary.allowances = lineItems(d.salary.allowances, 100, 3000)
        }
        if (Array.isArray(d.salaryHistory)) {
            d.salaryHistory = d.salaryHistory.map((h: Doc) => ({ ...h, amount: amount(3000, 30000), allowances: lineItems(h.allowances, 100, 3000) }))
        }
        if (d.bankDetails) d.bankDetails = fakeBank(me.name)
        for (const k of ['passwordResetCodeHash', 'passwordResetExpires', 'passwordResetAttempts', 'passwordResetSentAt', 'passwordChangedAt']) delete d[k]
        return d
    },
    companies: d => {
        if (d.phone) d.phone = fakePhone()
        if (d.address) d.address = 'Sample address, Dubai'
        if (d.email) {
            const slug = String(d.code ?? d._id).replace(/[^a-z0-9-]/gi, '')
            if (d.email.fromEmail) d.email.fromEmail = `${slug}@dev.example`
            if (d.email.replyTo) d.email.replyTo = `${slug}.reply@dev.example`
        }
        if (d.signatory?.name || d.signatory?.signature) {
            const name = `Signatory ${pad(++signatories, 2)}`
            if (d.signatory.name) d.signatory.name = name
            if (d.signatory.signature) d.signatory.signature = name
        }
        return d
    },
    certificates: d => {
        const who = personOf(d.employeeId)
        d.recipient = { ...d.recipient, name: who?.name ?? 'Sample Person', email: who?.email ?? 'someone@dev.example' }
        if (d.issuedByName) d.issuedByName = nameOf(d.issuedBy, 'Sample Admin')
        d.title = sample(d.title, 'Sample Letter')
        d.subject = sample(d.subject, 'Sample subject')
        d.body = sample(d.body, `Dear ${d.recipient.name},\n\n${SAMPLE}\n\n- Sample point one\n- Sample point two`)
        if (d.variables && typeof d.variables === 'object') {
            for (const k of Object.keys(d.variables)) d.variables[k] = `sample ${k}`
        }
        if (d.signatory?.name) d.signatory.name = 'Sample Signatory'
        d.revokeReason = sample(d.revokeReason, 'Sample reason')
        if (d.email?.error) d.email.error = 'Sample error'
        return d
    },
    certificatetemplates: d => {
        d.title = sampleWithPlaceholders(d.title, 'Sample Letter')
        d.subject = sampleWithPlaceholders(d.subject, 'Sample subject')
        d.body = sampleWithPlaceholders(d.body, `Dear {{employeeName}},\n\n${SAMPLE}`)
        return d
    },
    salaries: d => {
        d.salary = amount(3000, 30000)
        d.allowances = lineItems(d.allowances, 100, 3000)
        d.deductions = lineItems(d.deductions, 10, 1000)
        d.totalAllowances = sum(d.allowances)
        d.totalDeductions = sum(d.deductions)
        d.grossAmount = d.salary + d.totalAllowances
        d.netPay = d.grossAmount - d.totalDeductions
        if (d.paymentDetails) d.paymentDetails = { ...fakeBank(nameOf(d.employeeId)), reference: d.paymentDetails.reference ? `DEV-${digits(6)}` : undefined }
        if (d.paidByName) d.paidByName = nameOf(d.paidBy, 'Sample Admin')
        d.notes = sample(d.notes, 'Sample note')
        if (d.email?.lastError) d.email.lastError = 'Sample error'
        return d
    },
    expenses: d => {
        d.amount = amount(10, 5000, 5)
        if (Array.isArray(d.taxes)) d.taxes = d.taxes.map((t: Doc) => ({ ...t, amount: Math.round(d.amount * (Number(t.percentage) || 0)) / 100 }))
        d.totalTax = sum(d.taxes)
        d.totalAmount = d.amount + d.totalTax
        d.description = sample(d.description, 'Sample expense')
        d.notes = sample(d.notes, 'Sample note')
        d.vendor = sample(d.vendor, 'Sample vendor')
        d.rejectionReason = sample(d.rejectionReason, 'Sample reason')
        if (Array.isArray(d.receipts)) d.receipts = d.receipts.map((r: Doc) => ({ ...r, url: '', public_id: '', originalName: 'receipt' }))
        return d
    },
    projects: d => {
        d.budget = amount(5000, 200000, 500)
        projectBudgets.set(String(d._id), d.budget)
        if (d.clientName) d.clientName = clientMap.get(String(d.clientName).trim()) ?? `Client ${pad(++clients + clientMap.size, 3)}`
        return d
    },
    milestones: d => {
        const budget = projectBudgets.get(String(d.projectId))
        const pct = Number(d.paymentPercentage) || 0
        d.paymentAmount = budget !== undefined && pct > 0 ? Math.round(budget * pct) / 100 : amount(500, 20000)
        if (budget && d.paymentMode === 'amount') d.paymentPercentage = Math.min(100, Math.round((d.paymentAmount / budget) * 10000) / 100)
        d.notes = sample(d.notes, 'Sample note')
        return d
    },
    employeehistories: d => {
        if (d.fromSalary !== undefined) d.fromSalary = amount(3000, 30000)
        if (d.toSalary !== undefined) d.toSalary = amount(3000, 30000)
        d.title = sample(d.title, `Sample ${d.type ?? 'history'} entry`)
        d.description = sample(d.description, 'Sample note')
        return d
    },
    conversations: d => {
        // Group names are typed by people and often hold names.
        if (d.name) d.name = `Group ${pad(++groups, 3)}`
        return d
    },
    messages: d => {
        if (typeof d.text === 'string') d.text = ''
        if (Array.isArray(d.attachments)) d.attachments = d.attachments.map((a: Doc) => ({ ...a, url: '', public_id: '', filename: 'file' }))
        return d
    },
    // Not copied: device push endpoints are personal and useless on a dev copy.
    pushsubscriptions: () => null,
    // Not copied: the Owner Console's own data. The history keeps the exact signed bodies (real amounts and IBANs
    // inside JSON text, which the scrubbing below cannot rewrite); the keys, nonces and reports belong to the owner.
    // On the copy, owner records simply show as "not adopted / not signed": that is expected.
    ownerlogs: () => null,
    ownerkeys: () => null,
    ownernonces: () => null,
    ownerreports: () => null,
    bankchangerequests: d => {
        const who = personOf(d.employeeId)
        if (d.requested) d.requested = { method: 'bank', bankName: 'Dev Bank', holderName: who?.name ?? 'Sample Person', accountNumber: fakeAccount(), iban: fakeIban() }
        return d
    },
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

// Order matters: users first (identities), projects before milestones (budgets).
const ORDER = ['users', 'companies', 'projects', 'milestones']

const main = async () => {
    const { source, target } = checkTargets()
    console.log(`Source: ${source.shown}`)
    console.log(`Target: ${target.shown}`)

    const src = await MongoClient.connect(SOURCE_URI)
    const dst = await MongoClient.connect(TARGET_URI)
    try {
        const sdb = src.db(source.db)
        const tdb = dst.db(target.db)

        const existing = (await tdb.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name)
        if (existing.length && !OVERWRITE) {
            fail(`the target database "${target.db}" is not empty (${existing.length} collections). Run with --overwrite to replace it.`)
        }

        // The same database can hide behind two different connection strings (another host name, an IP, a
        // replica set member). Before anything is dropped: write a random marker into TARGET and refuse if
        // SOURCE can see it.
        const PROBE = '__devcopy_probe'
        const marker = crypto.randomUUID()
        await tdb.collection(PROBE).insertOne({ _id: marker as any, at: new Date() })
        const seenFromSource = await sdb.collection(PROBE).findOne({ _id: marker as any })
        await tdb.collection(PROBE).drop().catch(() => undefined)
        if (seenFromSource) fail('TARGET and SOURCE are the same database (a marker written to TARGET is visible from SOURCE)')

        if (existing.length) await tdb.dropDatabase()

        devHash = await bcrypt.hash(DEV_PASSWORD, 10)

        // Fake identities, numbered in a stable order.
        let n = 0
        for await (const u of sdb.collection('users').find({}, { projection: { name: 1, email: 1 } }).sort({ createdAt: 1, _id: 1 })) {
            const id = { name: `Person ${pad(++n)}`, email: `person${pad(n)}@dev.example` }
            people.set(String(u._id), id)
            if (typeof u.email === 'string' && u.email) emailMap.set(u.email.trim().toLowerCase(), id.email)
            if (typeof u.name === 'string' && u.name.trim().length >= 3) {
                nameMap.set(u.name.trim(), id.name)
                // First and last names on their own ("Fatima"), too; the full name wins where both match.
                for (const part of u.name.trim().split(/\s+/)) if (part.length >= 3 && !nameMap.has(part)) nameMap.set(part, id.name)
            }
        }
        // Client names (often people) get the same treatment: "Client 001" in the project and in any text.
        const clientNames = new Map<string, string>()
        for await (const p of sdb.collection('projects').find({ clientName: { $type: 'string', $ne: '' } }, { projection: { clientName: 1 } }).sort({ _id: 1 })) {
            const real = String(p.clientName).trim()
            if (!clientNames.has(real)) clientNames.set(real, `Client ${pad(clientNames.size + 1, 3)}`)
        }
        for (const [real, fake] of clientNames) {
            clientMap.set(real, fake)
            if (real.length >= 3 && !nameMap.has(real)) nameMap.set(real, fake)
            for (const part of real.split(/\s+/)) if (part.length >= 3 && !nameMap.has(part)) nameMap.set(part, fake)
        }

        // Whole words only, longest names first ("Ali Khan" before "Ali").
        const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        nameRules = [...nameMap].sort((a, b) => b[0].length - a[0].length)
            .map(([real, fake]) => ({ re: new RegExp(`(?<![\\p{L}\\p{N}])${escape(real)}(?![\\p{L}\\p{N}])`, 'gu'), fake }))

        const names = (await sdb.listCollections({}, { nameOnly: true }).toArray())
            .map(c => c.name).filter(c => !c.startsWith('system.'))
            .sort((a, b) => {
                const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b)
                return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
            })

        for (const name of names) {
            const transform = transforms[name]
            const from = sdb.collection(name)
            const to = tdb.collection(name)
            let copied = 0, skipped = 0
            let batch: Doc[] = []
            const flush = async () => {
                if (batch.length) await to.insertMany(batch, { ordered: false })
                copied += batch.length
                batch = []
            }
            for await (const raw of from.find({})) {
                const doc = transform ? transform(raw) : raw
                if (!doc) { skipped++; continue }
                delete doc.ownerSeal   // Owner Console seals are hashes of the REAL protected values: not copied
                batch.push(scrubDeep(doc) as Doc)
                if (batch.length >= BATCH) await flush()
            }
            await flush()

            // Same indexes (unique ones matter: the app relies on them).
            for (const ix of await from.indexes()) {
                if (ix.name === '_id_') continue
                const { key, v: _v, ns: _ns, ...options } = ix as Doc
                try { await to.createIndex(key, options) } catch (e) { console.warn(`  index ${name}.${ix.name} not created: ${(e as Error).message}`) }
            }
            if (!copied && !skipped) await tdb.createCollection(name).catch(() => undefined)
            console.log(`  ${name.padEnd(24)} ${String(copied).padStart(7)} copied${skipped ? `, ${skipped} left out` : ''}`)
        }

        console.log(`\nDone. Every account's password on the copy is: ${DEV_PASSWORD}`)
        console.log('Point your local .env MONGO_DB at the TARGET only. Never at production.')
    } finally {
        await src.close()
        await dst.close()
    }
}

main().catch(error => {
    console.error(error)
    process.exit(1)
})
