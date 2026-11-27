/*
 * Owner Console screens: Companies, Projects (budgets and milestone payments), Finance, Lock existing data (v1.3.0),
 * Expenses and Letters. Built into the same page as app.js (helpers such as h, api, act, field and alertBox come from
 * there; S is the console state).
 */
/* global S, h, api, act, field, alertBox, busy, money, numInput, parseAmount, fmtDate, flagsFor, staleVerifyNote, txt, writePin, dubaiMonth */

const LETTERHEADS = [['', 'Default (from the code)'], ['axis-aura', 'Axis Aura'], ['smb-proptech', 'SMB Axis Proptech'], ['smb-digitalzone', 'SMB DigitalZone'], ['plain', 'Plain']]
const isoDay = v => (v ? new Date(`${v}T00:00:00.000Z`).toISOString() : null)
const dayOf = iso => (iso ? String(iso).slice(0, 10) : '')
const say = (box, kind, text) => box.replaceChildren(alertBox(kind, null, h('p', { text })))
const twoStep = (button, confirmText, run) => {
    button.addEventListener('click', () => {
        if (button.dataset.confirm !== '1') { button.dataset.confirm = '1'; button.textContent = confirmText; return }
        busy(button, 'Working…', run)
    })
    return button
}
const inputT = (id, v, extra = {}) => h('input', { id, type: 'text', value: v ?? '', autocomplete: 'off', ...extra })
const select = (id, options, value, extra = {}) => h('select', { id, ...extra }, ...options.map(([v, l]) => h('option', { value: v, selected: String(value ?? '') === v }, l)))

/* ---------------- Companies ---------------- */

const companiesTab = async (body, message = null, openId = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading companies…' }))
    let rows
    try { rows = await api('GET', '/api/owner/companies', { sign: true }) } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'companies-result' }, message)
    const editor = h('div', { id: 'company-editor' })
    const open = c => {
        const isNew = !c
        const s = c?.state ?? normalizeCompany({ brandColor: '#0136B0', currency: 'AED', isActive: true, email: {}, signatory: {} })
        const f = {
            name: inputT('co-name', s.name), code: inputT('co-code', s.code, { disabled: !isNew }), legalName: inputT('co-legal', s.legalName),
            address: inputT('co-address', s.address), phone: inputT('co-phone', s.phone), website: inputT('co-website', s.website),
            currency: inputT('co-currency', s.currency, { maxlength: 3 }), brandColor: inputT('co-color', s.brandColor, { maxlength: 7 }),
            letterhead: select('co-letterhead', LETTERHEADS, s.letterhead ?? ''), logo: inputT('co-logo', s.logo),
            fromName: inputT('co-from-name', s.email.fromName), fromEmail: inputT('co-from-email', s.email.fromEmail), replyTo: inputT('co-reply-to', s.email.replyTo),
            footerNote: inputT('co-footer', s.email.footerNote), sigName: inputT('co-sig-name', s.signatory.name), sigTitle: inputT('co-sig-title', s.signatory.title),
            sigText: inputT('co-sig-text', s.signatory.signature), active: h('input', { id: 'co-active', type: 'checkbox', checked: s.isActive }),
        }
        const logoFile = h('input', { type: 'file', id: 'co-logo-file', accept: 'image/png,image/jpeg' })
        const upload = h('button', { class: 'secondary', type: 'button', id: 'co-logo-upload', on: { click: () => busy(upload, 'Uploading…', async () => {
            try {
                const file = logoFile.files?.[0]
                if (!file) throw new Error('Choose a PNG or JPEG file first')
                const bytes = new Uint8Array(await file.arrayBuffer())
                const r = await api('POST', '/api/owner/companies/logo', { body: { action: 'company.logo', attachmentSha256: await sha256Hex(bytes) }, sign: true, attachment: bytes })
                f.logo.value = r.url
                say(msg, 'good', 'Logo uploaded. Save the company to use it.')
            } catch (e) { say(msg, 'bad', e.message) }
        }) } }, 'Upload logo')
        const save = h('button', { id: 'co-save', on: { click: () => busy(save, 'Saving…', async () => {
            try {
                const v = k => f[k].value.trim()
                const state = normalizeCompany({
                    name: v('name'), code: v('code').toLowerCase(), legalName: v('legalName'), address: v('address'), phone: v('phone'), website: v('website'),
                    currency: v('currency').toUpperCase(), brandColor: v('brandColor'), letterhead: f.letterhead.value || null, logo: v('logo'),
                    email: { fromName: v('fromName'), fromEmail: v('fromEmail').toLowerCase(), replyTo: v('replyTo').toLowerCase(), footerNote: v('footerNote') },
                    signatory: { name: v('sigName'), title: v('sigTitle'), signature: v('sigText') }, isActive: f.active.checked,
                })
                const id = c?.id ?? newRecordId()
                await act('/api/owner/companies', { action: isNew ? 'company.create' : 'company.update', changes: [{ key: `companies/${id}`, state }] })
                companiesTab(body, alertBox('good', null, h('p', { text: `Saved: ${state.name}.` })), id)
            } catch (e) { say(msg, 'bad', e.message) }
        }) } }, isNew ? 'Add company (signed)' : 'Save (signed)')
        editor.replaceChildren(h('div', { class: 'panel' }, h('h3', { text: isNew ? 'Add a company' : s.name }),
            ...field('Name', f.name), ...field('Code (cannot change later)', f.code), ...field('Legal name', f.legalName), ...field('Address', f.address),
            ...field('Phone', f.phone), ...field('Website', f.website), ...field('Currency', f.currency), ...field('Brand colour (#RRGGBB)', f.brandColor),
            h('label', { text: 'Letterhead design' }), f.letterhead, ...field('Logo (URL or /images/... path)', f.logo), h('div', { class: 'row' }, logoFile, upload),
            h('h3', { text: 'Email sender' }), ...field('From name', f.fromName), ...field('From email', f.fromEmail), ...field('Reply-to', f.replyTo), ...field('Footer note', f.footerNote),
            h('h3', { text: 'Signatory' }), ...field('Name', f.sigName), ...field('Title', f.sigTitle), ...field('Typed signature (salary slips)', f.sigText),
            h('label', { class: 'row' }, f.active, ' Active'), h('p'), h('div', { class: 'row' }, save, h('button', { class: 'secondary', on: { click: () => editor.replaceChildren() } }, 'Close'))))
    }
    body.replaceChildren(msg, h('div', { class: 'panel' }, h('div', { class: 'row' }, h('h2', { text: 'Companies' }), h('span', { class: 'spacer' }),
        h('button', { id: 'add-company', on: { click: () => open(null) } }, 'Add company')),
        h('table', { id: 'companies-table' }, h('thead', {}, h('tr', {}, ...['Name', 'Code', 'Letterhead', 'Active'].map(t => h('th', { text: t })))),
            h('tbody', {}, ...rows.map(c => h('tr', { 'data-company': c.id }, h('td', {}, h('button', { class: 'link', on: { click: () => open(c) } }, c.state.name)),
                h('td', { class: 'mono', text: c.state.code }), h('td', { text: c.state.letterhead ?? 'default' }), h('td', { text: c.state.isActive ? 'yes' : 'no' })))))),
        editor)
    if (openId) { const c = rows.find(x => x.id === openId); if (c) open(c) }
}

/* ---------------- Projects: budgets and milestone payments ---------------- */

/*
 * Phase 2: once locking has started, the budget and each milestone's percentage and amount are stored locked. They are
 * unlocked here for showing and editing, checked here (the server cannot read them any more), and locked again before
 * signing. A value that does not unlock was changed or moved outside the console: it is shown as such, not edited.
 */
const openState = async (key, state) => { try { return { plain: await unlockState(S.vaultKey, key, state) } } catch { return { plain: null, broken: true } } }
/** Projects from GET /api/owner/projects with their amounts unlocked: { ...p, plain, broken, milestones: [{ ...m, plain, broken }] }. */
const openProjects = async rows => Promise.all(rows.map(async p => ({
    ...p, ...(await openState(p.key, p.state)),
    milestones: await Promise.all(p.milestones.map(async m => ({ ...m, ...(await openState(m.key, m.state)) }))),
})))
/** Locks the amounts of a state before signing, once locking has started (before that: plain, as before). */
const sealAmounts = (key, state) => (S.lockingStarted ? lockState(S.vaultKey, key, state) : state)
const BROKEN = 'Does not unlock: changed or moved outside the Owner Console. Run Verify everything.'

const projectsTab = async (body, message = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading projects…' }))
    let rows
    try { rows = await openProjects(await api('GET', '/api/owner/projects', { sign: true })) } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'projects-result' }, message)
    const reload = text => projectsTab(body, alertBox('good', null, h('p', { text })))
    const fail = e => say(msg, 'bad', e.message)
    const cards = rows.map(p => {
        const anyBroken = p.broken || p.milestones.some(m => m.broken)
        const budget = numInput(`budget-${p.id}`, p.plain?.budget, { disabled: anyBroken })
        const setBudget = h('button', { 'data-budget': p.id, disabled: anyBroken, on: { click: () => busy(setBudget, 'Saving…', async () => {
            try {
                const b = parseAmount(budget.value, 'Budget') ?? 0
                checkBudget(b, p.milestones.map(m => m.plain))
                const state = await sealAmounts(p.key, normalizeProject({ budget: b }))
                await act('/api/owner/projects/budget', { action: 'project.budget', changes: [{ key: p.key, state }] })
                reload(`Budget of ${p.name}: ${money(b, BUDGET_CURRENCY)}.`)
            } catch (e) { fail(e) }
        }) } }, 'Set budget (signed)')
        const del = twoStep(h('button', { class: 'danger', 'data-delete-project': p.id }, 'Delete project'), `Confirm: delete ${p.name} and its ${p.milestones.length} milestone(s)`, async () => {
            try { await act('/api/owner/projects/delete', { action: 'project.delete', changes: [{ key: p.key, state: null }, ...p.milestones.map(m => ({ key: m.key, state: null }))] }); reload(`Deleted ${p.name}.`) } catch (e) { fail(e) }
        })
        const msRows = p.milestones.map(m => {
            const s = m.plain ?? m.state
            const mode = select(`ms-mode-${m.id}`, [['percentage', '% of budget'], ['amount', 'Amount']], s.paymentMode, { disabled: anyBroken })
            const value = numInput(`ms-value-${m.id}`, m.broken ? '' : s.paymentMode === 'amount' ? s.paymentAmount : s.paymentPercentage, { disabled: anyBroken })
            const cur = inputT(`ms-cur-${m.id}`, s.currency, { maxlength: 3, size: 3, disabled: anyBroken })
            const status = select(`ms-status-${m.id}`, [['unpaid', 'unpaid'], ['invoiced', 'invoiced'], ['paid', 'paid']], s.paymentStatus, { disabled: anyBroken })
            const inv = h('input', { type: 'date', id: `ms-inv-${m.id}`, value: dayOf(s.invoicedAt), disabled: anyBroken }), paid = h('input', { type: 'date', id: `ms-paid-${m.id}`, value: dayOf(s.paidAt), disabled: anyBroken })
            const save = h('button', { 'data-ms-save': m.id, disabled: anyBroken, on: { click: () => busy(save, 'Saving…', async () => {
                try {
                    const v = parseAmount(value.value, 'Payment') ?? 0, b = p.plain.budget
                    const st = status.value
                    const plain = normalizeMilestone({
                        projectId: p.id, paymentMode: mode.value, currency: cur.value.trim().toUpperCase(), paymentStatus: st,
                        paymentPercentage: mode.value === 'percentage' ? v : (b > 0 ? round2(v / b * 100) : 0),
                        paymentAmount: mode.value === 'percentage' ? round2(b * v / 100) : v,
                        invoicedAt: st === 'unpaid' ? null : isoDay(inv.value || paid.value || new Date().toISOString().slice(0, 10)),
                        paidAt: st === 'paid' ? isoDay(paid.value || new Date().toISOString().slice(0, 10)) : null,
                    })
                    checkMilestonePayment(plain, b, p.milestones.filter(o => o.id !== m.id).map(o => o.plain))
                    await act('/api/owner/milestones/payment', { action: 'milestone.payment', changes: [{ key: m.key, state: await sealAmounts(m.key, plain) }] })
                    reload(`Milestone "${m.title}": ${money(plain.paymentAmount, plain.currency)}, ${st}.`)
                } catch (e) { fail(e) }
            }) } }, 'Save (signed)')
            const mdel = twoStep(h('button', { class: 'secondary', 'data-ms-delete': m.id }, 'Delete'), 'Confirm: delete', async () => {
                try { await act('/api/owner/milestones/delete', { action: 'milestone.delete', changes: [{ key: m.key, state: null }] }); reload(`Deleted milestone "${m.title}".`) } catch (e) { fail(e) }
            })
            return h('tr', { 'data-milestone': m.id }, h('td', { text: m.title }), h('td', {}, mode), h('td', {}, value), h('td', {}, cur), h('td', {}, status),
                h('td', {}, inv), h('td', {}, paid), h('td', { class: m.broken ? 'bad small' : 'mono small', text: m.broken ? BROKEN : money(s.paymentAmount, s.currency) }), h('td', {}, h('div', { class: 'row' }, save, mdel)))
        })
        return h('div', { class: 'panel', 'data-project': p.id }, h('div', { class: 'row' }, h('h3', { text: `${p.name}` }), h('span', { class: 'small muted', text: `${p.clientName} · ${p.status}` }), h('span', { class: 'spacer' }), del),
            p.broken ? alertBox('bad', null, h('p', { class: 'project-broken', text: `Budget: ${BROKEN}` })) : null,
            h('div', { class: 'row' }, h('label', { text: 'Budget' }), budget, setBudget),
            p.milestones.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['Milestone', 'Enter as', 'Value', 'Cur.', 'Payment', 'Invoiced', 'Paid', 'Amount', ''].map(t => h('th', { text: t })))), h('tbody', {}, ...msRows))
                : h('p', { class: 'small muted', text: 'No milestones (they are added on the website).' }))
    })
    body.replaceChildren(msg, h('div', { class: 'panel' }, h('h2', { text: 'Projects: budgets and milestone payments' }),
        h('p', { class: 'small muted', text: S.lockingStarted
            ? 'Amounts are stored locked: only this console can read them. Everything without money (names, dates, team, work status) is managed on the website.'
            : 'Everything without money (names, dates, team, work status) is managed on the website.' })), ...cards)
}

/* ---------------- Finance (Phase 2): the figures the website dashboard used to show ---------------- */

const totalsText = t => Object.entries(t).map(([c, v]) => money(v, c)).join(' + ') || money(0, BUDGET_CURRENCY)

const financeTab = async body => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading and unlocking…' }))
    let rows, integ
    try {
        ;[rows, integ] = await Promise.all([api('GET', '/api/owner/projects', { sign: true }), api('GET', '/api/owner/integrity', { sign: true })])
        rows = await openProjects(rows)
    } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const broken = rows.flatMap(p => [...(p.broken ? [`${p.name}: budget`] : []), ...p.milestones.filter(m => m.broken).map(m => `${p.name} / ${m.title}`)])
    const usable = rows.filter(p => !p.broken).map(p => ({ id: p.id, name: p.name, budget: p.plain.budget, milestones: p.milestones.filter(m => !m.broken).map(m => m.plain) }))
    const expenses = integ.records.filter(r => r.key.startsWith('expenses/')).map(r => r.state)
    const t = financeTotals(usable, expenses, dubaiMonth())
    const card = (id, title, value, note) => h('div', { class: 'panel', id }, h('p', { class: 'small muted', text: title }), h('h2', { text: value }), note ? h('p', { class: 'small muted', text: note }) : null)
    body.replaceChildren(
        broken.length ? alertBox('bad', 'Some amounts do not unlock', h('p', { text: `${broken.join(', ')}. They were changed or moved outside the Owner Console and are left out of the totals. Run Verify everything.` })) : null,
        h('div', { class: 'cards' },
            card('fin-total-expenses', 'Total expenses (approved and reimbursed)', totalsText(t.spent), `This month: ${totalsText(t.thisMonth)}`),
            card('fin-remaining', 'Remaining budget', money(t.remainingBudget, BUDGET_CURRENCY), `of ${money(t.totalBudget, BUDGET_CURRENCY)} total budget, less ${BUDGET_CURRENCY} expenses`),
            card('fin-milestones', 'Milestone payments', `${money(t.milestones.paid, null)} paid`, `Invoiced ${money(t.milestones.invoiced, null)} · planned ${money(t.milestones.allocated, null)}`),
            card('fin-pending', 'Expenses waiting for approval', totalsText(t.pending))),
        h('p', { class: 'small muted', text: `Projects have no currency of their own: budgets count as ${BUDGET_CURRENCY}, and only ${BUDGET_CURRENCY} expenses are subtracted from them. Other currencies are shown separately, never mixed. Milestone amounts are in each milestone's currency.` }),
        h('div', { class: 'panel' }, h('h2', { text: 'Projects: spend against budget' }),
            h('table', { id: 'finance-table' }, h('thead', {}, h('tr', {}, ...['Project', 'Budget', 'Allocated', 'Paid', 'Invoiced', 'Not invoiced', 'Unallocated', 'Spent', 'Remaining'].map(x => h('th', { text: x })))),
                h('tbody', {}, ...t.perProject.map(p => h('tr', { 'data-finance-project': p.id },
                    h('td', { text: p.name }), h('td', { class: 'mono', text: money(p.budget, BUDGET_CURRENCY) }), h('td', { class: 'mono', text: `${money(p.allocated, null)} (${p.allocatedPercent}%)` }),
                    h('td', { class: 'mono', text: money(p.paid, null) }), h('td', { class: 'mono', text: money(p.invoiced, null) }), h('td', { class: 'mono', text: money(p.notInvoiced, null) }),
                    h('td', { class: 'mono', text: money(p.unallocated, null) }), h('td', { class: 'mono', text: totalsText(p.spent) }),
                    h('td', { class: p.remaining < 0 ? 'mono bad' : 'mono', text: money(p.remaining, BUDGET_CURRENCY) })))))))
}

/* ---------------- Lock existing data (Phase 2, one time) ---------------- */

/** The totals compared before and after locking: { projects, milestones, totalBudget, allocated, paid, invoiced }. */
const lockTotals = async () => {
    const rows = await openProjects(await api('GET', '/api/owner/projects', { sign: true }))
    const broken = rows.some(p => p.broken || p.milestones.some(m => m.broken))
    const t = financeTotals(rows.filter(p => !p.broken).map(p => ({ id: p.id, name: p.name, budget: p.plain.budget, milestones: p.milestones.filter(m => !m.broken).map(m => m.plain) })), [], '')
    return { rows, broken, totals: { projects: rows.length, milestones: rows.reduce((n, p) => n + p.milestones.length, 0), totalBudget: t.totalBudget, allocated: t.milestones.allocated, paid: t.milestones.paid, invoiced: t.milestones.invoiced } }
}
const totalsList = t => h('ul', { class: 'totals' },
    h('li', { text: `Projects: ${t.projects}, total budget ${money(t.totalBudget, BUDGET_CURRENCY)}` }),
    h('li', { text: `Milestones: ${t.milestones}, planned payments ${money(t.allocated, null)}, paid ${money(t.paid, null)}, invoiced ${money(t.invoiced, null)}` }))
const sameTotals = (a, b) => canonicalJson(a) === canonicalJson(b)

/** Plain history bodies still to move: entries whose stored body is plain, matches its signed hash, and is not a move batch. */
const plainHistory = async entries => {
    const out = []
    for (const e of entries) {
        if (!e.body || e.action === 'vault.history' || isLocked(e.body) || outerBodyOf(e.body)) continue
        if ((await sha256Hex(e.body)) !== e.request.bodyHash) throw new Error(`History entry #${e.seq}: its stored body does not match its signature. Run Verify everything.`)
        out.push(e)
    }
    return out
}

const lockTab = async (body, message = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }))
    let st
    try { st = await api('GET', '/api/owner/vault/status', { sign: true }) } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    if (st.started && !S.lockingStarted) { S.lockingStarted = true; writePin({ lockingStarted: true }) }
    S.lockingFinished = st.finished
    const msg = h('div', { id: 'lock-result' }, message)
    if (st.finished) return lockDone(body, msg, st)
    if (st.started) return lockRun(body, msg, st)
    return lockRecoveryCheck(body, msg)
}

// Screen 1: the recovery key. After locking, losing both the passphrase and the recovery key loses the figures for good.
const lockRecoveryCheck = (body, msg) => {
    const rec = txt('lock-recovery', { autofocus: true, placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX' })
    const go = h('button', { id: 'lock-recovery-go', on: { click: () => busy(go, 'Checking…', async () => {
        try {
            const d = await api('GET', '/api/owner/keys')
            let bytes
            try { bytes = parseRecoveryKey(rec.value) } catch (e) { throw new Error(e.message) }
            const ex = await unlockKeys(await kekFromRecovery(bytes, fromB64(d.recoverySalt)), d.byRecovery).catch(() => { throw new Error('That recovery key does not unlock your keys. Locking cannot start: find the right recovery sheet first.') })
            wipe(bytes)
            // It must open the SAME vault key this console uses: lock a test value with one, unlock it with the other.
            const place = { collection: 'test', id: 'recovery-check', field: 'value' }
            const probe = toHex(randomBytes(8))
            const same = await unlockValue(S.vaultKey, place, await lockValue(ex.vaultKey, place, probe)).then(v => v === probe).catch(() => false)
            if (!same) throw new Error('This recovery key opens a different vault key. Locking cannot start. Stop and check your keys.')
            rec.value = ''
            lockSummary(body, msg)
        } catch (e) { say(msg, 'bad', e.message) }
    }) } }, 'Check the recovery key')
    body.replaceChildren(h('h2', { text: 'Lock existing data' }),
        h('div', { class: 'panel', id: 'lock-step-recovery' },
            h('h3', { text: 'Have your printed recovery sheet ready' }),
            h('p', { text: 'Locking stores project budgets, milestone payments and every owner history body so that only this console can read them. They can be unlocked only with your passphrase or your recovery key. If both are ever lost, the locked figures are lost for good: nobody can recover them, not even the developers.' }),
            h('p', { text: 'Type the recovery key from your printed sheet to prove it still works. Locking does not start unless it does.' }),
            ...field('Recovery key', rec), h('p'), msg, go))
}

// Screen 2: the summary and the start.
const lockSummary = async (body, msg) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Checking the history and the records…' }))
    try {
        const [log, integ] = await Promise.all([api('GET', '/api/owner/log', { sign: true }), api('GET', '/api/owner/integrity', { sign: true })])
        const chain = await verifyChain(log.entries, S.publicKey)
        const check = await checkIntegrity(log.entries, integ.records, undefined, S.vaultKey)
        // Every type that has records must be adopted (a type with no records yet has nothing to adopt).
        const missing = Object.keys(check.notAdopted)
        if (!chain.ok || !check.ok || missing.length) {
            return body.replaceChildren(h('h2', { text: 'Lock existing data' }), alertBox('bad', 'Not ready to lock', h('p', { text: !chain.ok
                ? 'The owner history does not verify. Run Verify everything.'
                : missing.length ? `Adopt the existing records first, in Verify everything (not adopted yet: ${missing.join(', ')}).`
                    : `The records check found ${check.flags.length + (check.bodyProblems?.length ?? 0)} problem(s). Run Verify everything and resolve them first: locking re-signs every amount as it is now.` })))
        }
        const { totals, rows } = await lockTotals()
        const plainRecords = rows.filter(p => stateHasPlainMoney('projects', p.state)).length + rows.reduce((n, p) => n + p.milestones.filter(m => stateHasPlainMoney('milestones', m.state)).length, 0)
        const hist = await plainHistory(log.entries)
        const bytes = hist.reduce((n, e) => n + e.body.length, 0)
        const start = h('button', { id: 'lock-start', on: { click: () => busy(start, 'Starting…', async () => {
            try {
                await act('/api/owner/vault/start', { action: 'vault.start', totals }, undefined, { lockBody: true })
                S.lockingStarted = true
                writePin({ lockingStarted: true })
                lockTab(body)
            } catch (e) { say(msg, 'bad', e.message) }
        }) } }, 'Start locking (signed)')
        body.replaceChildren(h('h2', { text: 'Lock existing data' }),
            h('div', { class: 'panel', id: 'lock-step-summary' },
                h('h3', { text: 'What will be locked' }),
                h('ul', { id: 'lock-counts' },
                    h('li', { text: `${plainRecords} record(s) with amounts: project budgets and milestone payments (percentage and amount)` }),
                    h('li', { text: `${hist.length} owner history bodies (${Math.round(bytes / 1024)} KB): salaries, bank details, expenses and letter texts inside them` })),
                h('h3', { text: 'Totals before locking' }), totalsList(totals),
                h('p', { class: 'small', text: 'After locking, the console unlocks everything again and checks these totals. From the start, every change sent from this console is locked, and the server refuses plain amounts. You can stop at any time and continue later.' }),
                msg, start))
    } catch (e) { body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
}

// Screen 3: locking (records first, then history), safe to stop and continue.
const lockRun = (body, msg, st) => {
    let stop = false
    const progress = h('ul', { id: 'lock-progress' })
    const note = text => progress.append(h('li', { text }))
    const stopBtn = h('button', { class: 'secondary', id: 'lock-stop', on: { click: () => { stop = true; stopBtn.disabled = true; stopBtn.textContent = 'Stopping after this batch…' } } }, 'Stop')
    const go = h('button', { id: 'lock-continue', on: { click: () => busy(go, 'Locking…', async () => {
        stop = false; stopBtn.disabled = false; stopBtn.textContent = 'Stop'
        try {
            // 1. Records: each one replaced in one update, only while it is still exactly the plain state read here.
            for (;;) {
                const rows = await api('GET', '/api/owner/projects', { sign: true })
                const todo = [...rows.filter(p => stateHasPlainMoney('projects', p.state)), ...rows.flatMap(p => p.milestones).filter(m => stateHasPlainMoney('milestones', m.state))]
                if (!todo.length) break
                if (stop) return note('Stopped. Nothing is half-locked; continue any time.')
                const batch = todo.slice(0, 50)
                const changes = []
                for (const r of batch) changes.push({ key: r.key, state: await lockState(S.vaultKey, r.key, r.state), from: await stateHash(r.key, r.state) })
                const res = await act('/api/owner/vault/lock-records', { action: 'vault.lock', changes })
                note(`Locked ${res.locked} record(s); ${todo.length - batch.length} to go.`)
            }
            note('Project budgets and milestone payments: all locked.')
            // 2. History bodies: each replaced by its locked form (its signed hash stays), in batches of up to ~4 MB.
            for (;;) {
                const log = await api('GET', '/api/owner/log', { sign: true })
                const todo = await plainHistory(log.entries)
                if (!todo.length) break
                if (stop) return note('Stopped. Nothing is half-locked; continue any time.')
                const entries = [], locked = []
                let size = 0
                for (const e of todo) {
                    const l = await lockValue(S.vaultKey, bodyPlace(e.request.nonce), e.body)
                    if (entries.length && (size + l.length > 4_000_000 || entries.length >= 200)) break
                    entries.push({ seq: e.seq, bodyHash: e.request.bodyHash, lockedSha256: await sha256Hex(l), index: await historyIndex(JSON.parse(e.body)) })
                    locked.push(l); size += l.length
                }
                const res = await act('/api/owner/vault/lock-history', { action: 'vault.history', entries }, undefined, { locked })
                note(`Locked ${res.moved} history bodies; ${todo.length - entries.length} to go.`)
            }
            note('Owner history bodies: all locked.')
            lockCheck(body, msg)
        } catch (e) { say(msg, 'bad', `${e.message} Nothing is half-locked: press Continue to carry on.`) }
    }) } }, 'Continue locking')
    body.replaceChildren(h('h2', { text: 'Lock existing data' }),
        h('div', { class: 'panel', id: 'lock-step-run' },
            h('p', { text: `Still plain: ${st.plain.projects} project budget(s), ${st.plain.milestones} milestone payment(s), ${st.plain.historyBodies} history bodies.` }),
            h('p', { class: 'small muted', text: 'Records first, then the history. Safe to stop at any point: each value is either plain or locked, never both.' }),
            msg, h('div', { class: 'row' }, go, stopBtn), progress))
}

/** The totals signed at the start (inside the locked body of the "vault.start" entry). */
const startTotals = async () => {
    const log = await api('GET', '/api/owner/log', { sign: true })
    const { bodies } = await readBodies(log.entries, S.vaultKey)
    const e = [...log.entries].reverse().find(x => x.action === 'vault.start' && bodies.has(x.seq))
    return e ? JSON.parse(bodies.get(e.seq)).totals : null
}

// Screen 4: re-read everything, unlock it, compare the totals, then finish.
const lockCheck = async (body, msg) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Re-reading and unlocking everything…' }))
    try {
        const before = await startTotals()
        const { totals: after, broken } = await lockTotals()
        const same = !broken && before && sameTotals(before, after)
        const finish = h('button', { id: 'lock-finish', disabled: !same, on: { click: () => busy(finish, 'Finishing…', async () => {
            try { await act('/api/owner/vault/finish', { action: 'vault.finish' }); S.lockingFinished = true; lockTab(body, alertBox('good', null, h('p', { text: 'Locking finished.' }))) } catch (e) { say(msg, 'bad', e.message) }
        }) } }, 'Finish (signed)')
        body.replaceChildren(h('h2', { text: 'Lock existing data' }),
            h('div', { class: 'panel', id: 'lock-step-check' },
                h('h3', { text: 'Totals before locking (signed at the start)' }), before ? totalsList(before) : h('p', { text: 'Not found.' }),
                h('h3', { text: 'Totals now, unlocked by this console' }), totalsList(after),
                same ? alertBox('good', null, h('p', { id: 'lock-totals-match', text: '✔ The totals match. Every amount unlocks with your key.' }))
                    : alertBox('bad', null, h('p', { id: 'lock-totals-differ', text: broken ? 'Some amounts do not unlock. Run Verify everything.' : 'The totals differ. If you changed budgets or payments since starting, that explains it; otherwise run Verify everything.' })),
                msg, finish))
    } catch (e) { body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
}

const lockDone = async (body, msg, st) => {
    const check = h('button', { class: 'secondary', id: 'lock-recheck', on: { click: () => lockCheck(body, msg) } }, 'Check the totals again')
    body.replaceChildren(h('h2', { text: 'Locked data' }), msg,
        h('div', { class: 'panel', id: 'lock-step-done' },
            h('p', { text: 'Locking is finished. Project budgets, milestone payments and every owner history body are stored locked; the server refuses plain amounts.' }),
            h('p', { class: 'small', text: `Still plain: ${st.plain.projects} project budget(s), ${st.plain.milestones} milestone payment(s), ${st.plain.historyBodies} history bodies (0 expected).` }),
            h('p', { class: 'small', text: 'After locking: delete old database exports and dumps (including any made with Compass), and rotate or delete hosting backups and Atlas snapshots taken before locking. They still hold the plain values.' }),
            check))
}

/* ---------------- Expenses ---------------- */

const expensesTab = async (body, status = 'pending', message = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading expenses…' }))
    let d
    try { d = await api('GET', `/api/owner/expenses?status=${status}`, { sign: true }) } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'expenses-result' }, message)
    const reload = (text, st = status) => expensesTab(body, st, alertBox('good', null, h('p', { text })))
    const fail = e => say(msg, 'bad', e.message)
    const filter = select('exp-status', ['pending', 'approved', 'rejected', 'reimbursed'].map(x => [x, x]), status, { on: { change: e => expensesTab(body, e.target.value) } })
    const send = async (changes, text) => { await act('/api/owner/expenses', { action: 'expense.update', changes }); reload(text) }
    const withStatus = (x, st, reason = null) => ({ key: x.key, state: normalizeExpense({ ...x.state, status: st, rejectionReason: reason }) })
    const editor = h('div', { id: 'expense-editor' })
    const edit = x => {
        const s = x.state
        const desc = inputT('ex-desc', s.description), vendor = inputT('ex-vendor', s.vendor), amount = numInput('ex-amount', s.amount)
        const cur = inputT('ex-currency', s.currency, { maxlength: 3 }), date = h('input', { type: 'date', id: 'ex-date', value: dayOf(s.date) }), notes = inputT('ex-notes', s.notes)
        const cat = select('ex-category', d.categories.map(c => [c, c]), s.category)
        const method = select('ex-method', [['', '(none)'], ...d.paymentMethods.map(c => [c, c])], s.paymentMethod ?? '')
        const company = select('ex-company', d.companies.map(c => [c.id, c.name]), s.companyId)
        const taxes = h('div', { id: 'ex-taxes' })
        const addTax = (t = { name: '', percentage: '' }) => taxes.append(h('div', { class: 'row', 'data-tax': '1' }, inputT(undefined, t.name, { class: 'tax-name', placeholder: 'VAT' }), numInput(undefined, t.percentage, { class: 'tax-pct', placeholder: '%' })))
        s.taxes.forEach(addTax)
        const save = h('button', { id: 'ex-save', on: { click: () => busy(save, 'Saving…', async () => {
            try {
                const amt = parseAmount(amount.value, 'Amount')
                if (amt === null) throw new Error('Enter the amount')
                const taxList = [...taxes.querySelectorAll('[data-tax]')].map(r => ({ name: r.querySelector('.tax-name').value.trim(), percentage: Number(r.querySelector('.tax-pct').value) || 0 })).filter(t => t.name)
                const t = computeTaxes(amt, taxList)
                const state = normalizeExpense({ ...s, description: desc.value, vendor: vendor.value, amount: amt, ...t, currency: cur.value.trim().toUpperCase(), date: isoDay(date.value),
                    notes: notes.value, category: cat.value, paymentMethod: method.value || null, companyId: company.value })
                await send([{ key: x.key, state }], `Saved: ${state.description}.`)
            } catch (e) { fail(e) }
        }) } }, 'Save (signed)')
        editor.replaceChildren(h('div', { class: 'panel' }, h('h3', { text: `Edit expense (${x.addedByName})` }), ...field('Description', desc), h('label', { text: 'Category' }), cat,
            ...field('Vendor', vendor), h('label', { text: 'Payment method' }), method, ...field('Amount (before tax)', amount), h('label', { text: 'Taxes' }), taxes,
            h('button', { class: 'link', type: 'button', on: { click: () => addTax() } }, '+ Add tax'), ...field('Currency', cur), ...field('Date', date),
            h('label', { text: 'Company' }), company, ...field('Notes', notes), h('p'), h('div', { class: 'row' }, save, h('button', { class: 'secondary', on: { click: () => editor.replaceChildren() } }, 'Close'))))
    }
    const rows = d.expenses.map(x => {
        const s = x.state
        const actions = []
        if (s.status === 'pending') {
            actions.push(twoStep(h('button', { 'data-approve': x.id }, 'Approve'), `Confirm: approve ${money(s.totalAmount, s.currency)}`, () => send([withStatus(x, 'approved')], `Approved: ${s.description}.`).catch(fail)))
            const reason = inputT(`reason-${x.id}`, '', { placeholder: 'Reason to reject', size: 18 })
            const rej = h('button', { class: 'secondary', 'data-reject': x.id, on: { click: () => busy(rej, 'Rejecting…', async () => {
                if (!reason.value.trim()) return say(msg, 'bad', 'Write the reason before rejecting')
                await send([withStatus(x, 'rejected', reason.value.trim())], `Rejected: ${s.description}.`).catch(fail)
            }) } }, 'Reject')
            actions.push(reason, rej)
        }
        if (s.status === 'approved') actions.push(twoStep(h('button', { class: 'secondary', 'data-reimburse': x.id }, 'Reimbursed'), 'Confirm: reimbursed', () => send([withStatus(x, 'reimbursed')], `Reimbursed: ${s.description}.`).catch(fail)))
        if (s.status !== 'pending') actions.push(twoStep(h('button', { class: 'secondary', 'data-reopen': x.id }, 'Back to pending'), 'Confirm: back to pending', () => send([withStatus(x, 'pending')], `Back to pending: ${s.description}.`).catch(fail)))
        actions.push(h('button', { class: 'link', 'data-edit-expense': x.id, on: { click: () => edit(x) } }, 'Edit'))
        actions.push(twoStep(h('button', { class: 'danger', 'data-delete-expense': x.id }, 'Delete'), 'Confirm: delete', () => send([{ key: x.key, state: normalizeExpense({ ...s, isDeleted: true }) }], `Deleted: ${s.description}.`).catch(fail)))
        return h('tr', { 'data-expense': x.id }, h('td', { text: dayOf(s.date) }), h('td', { text: x.addedByName }), h('td', { text: s.description }), h('td', { class: 'small', text: x.projectName || x.companyName }),
            h('td', { class: 'mono', text: money(s.totalAmount, s.currency) }), h('td', { text: `${s.status}${x.receipts ? ` · ${x.receipts} receipt(s)` : ''}` }), h('td', {}, h('div', { class: 'row' }, ...actions)))
    })
    const pending = d.expenses.filter(x => x.state.status === 'pending')
    const all = twoStep(h('button', { id: 'approve-all', disabled: !pending.length }, `Approve all ${pending.length} shown`), `Confirm: approve ${pending.length}`, () => send(pending.map(x => withStatus(x, 'approved')), `Approved ${pending.length} expense(s).`).catch(fail))
    body.replaceChildren(msg, h('div', { class: 'panel' }, h('div', { class: 'row' }, h('h2', { text: 'Expenses' }), h('span', { class: 'spacer' }), filter, status === 'pending' ? all : ''),
        d.expenses.length ? h('table', { id: 'expenses-table' }, h('thead', {}, h('tr', {}, ...['Date', 'By', 'Description', 'Project', 'Total', 'Status', ''].map(t => h('th', { text: t })))), h('tbody', {}, ...rows))
            : h('p', { class: 'muted', text: `No ${status} expenses.` })), editor)
}

/* ---------------- Letters ---------------- */

const AUTO_VARIABLES = ['employeeName', 'employeeEmail', 'position', 'companyName', 'companyLegalName', 'issueDate', 'joiningDate', 'salary', 'currency', 'signatoryName', 'signatoryTitle']
const customPlaceholders = (...texts) => [...new Set(texts.join('\n').match(/\{\{\s*[a-zA-Z][a-zA-Z0-9_]{1,39}\s*\}\}/g) ?? [])]
    .map(t => t.replace(/[{}\s]/g, '')).filter(n => !AUTO_VARIABLES.includes(n))

/** The one-time signature: cleaned in the browser, kept in memory only, dropped after issuing or on Remove. */
const LETTER = { signature: null, preview: null, previewKey: '' }
const dropSignature = () => { if (LETTER.signature) { LETTER.signature.bytes.fill(0); URL.revokeObjectURL(LETTER.signature.url) } LETTER.signature = null }

const lettersTab = async (body, message = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading…' }))
    let people, companies, letters
    try {
        [people, companies, letters] = await Promise.all([api('GET', '/api/owner/people', { sign: true }), api('GET', '/api/owner/companies', { sign: true }), api('GET', '/api/owner/letters', { sign: true })])
    } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'letters-result' }, message)
    const fail = e => say(msg, 'bad', e.message)
    const company = select('lt-company', [['', "Employee's own company"], ...companies.filter(c => c.state.isActive).map(c => [c.id, c.state.name])], '')
    const type = h('select', { id: 'lt-type' })
    const kind = select('lt-kind', [['letter', 'Letter (portrait)'], ['certificate', 'Certificate (landscape)']], 'letter')
    const title = inputT('lt-title', ''), subject = inputT('lt-subject', '')
    const text = h('textarea', { id: 'lt-body', rows: 10, class: 'mono' })
    const vars = h('div', { id: 'lt-vars' })
    const today = new Date().toISOString().slice(0, 10)
    const date = h('input', { type: 'date', id: 'lt-date', value: today })
    const sigName = inputT('lt-sig-name', ''), sigTitle = inputT('lt-sig-title', '')
    const sendEmail = h('input', { type: 'checkbox', id: 'lt-email', checked: true }), saveTemplate = h('input', { type: 'checkbox', id: 'lt-save', checked: true })
    const employees = people.people.filter(p => p.state.role === 'employee' && p.state.status === 'active')
    const pick = h('div', { id: 'lt-employees' }, ...employees.map(p => h('label', { class: 'row' }, h('input', { type: 'checkbox', value: p.id, 'data-emp': p.id }), ` ${p.state.name}`)))
    let types = []
    const loadTypes = async () => {
        types = await api('GET', `/api/owner/letters/types${company.value ? `?companyId=${company.value}` : ''}`, { sign: true })
        type.replaceChildren(h('option', { value: '' }, 'Choose a text'), ...types.map((t, i) => h('option', { value: String(i) }, `${t.typeLabel}${t.source === 'default' ? ' (built-in)' : ''}`)))
    }
    const refreshVars = () => {
        const names = customPlaceholders(title.value, subject.value, text.value)
        const old = Object.fromEntries([...vars.querySelectorAll('input')].map(i => [i.dataset.var, i.value]))
        vars.replaceChildren(...names.flatMap(n => field(n, inputT(`lt-var-${n}`, old[n] ?? '', { 'data-var': n }))))
    }
    type.addEventListener('change', () => {
        const t = types[Number(type.value)]
        if (!t) return
        title.value = t.title; subject.value = t.subject ?? ''; text.value = t.body; kind.value = t.kind
        LETTER.typeLabel = t.typeLabel
        refreshVars()
    })
    company.addEventListener('change', () => loadTypes().catch(fail))
    for (const el of [title, subject, text]) el.addEventListener('blur', refreshVars)

    // signature picker (background removed in the browser)
    const sigFile = h('input', { type: 'file', id: 'lt-sig-file', accept: 'image/png,image/jpeg' })
    const sigBox = h('div', { id: 'lt-sig-preview' })
    const showSig = () => sigBox.replaceChildren(...(LETTER.signature ? [h('img', { src: LETTER.signature.url, alt: 'signature', class: 'sig' }),
        h('button', { class: 'link', id: 'lt-sig-remove', on: { click: () => { dropSignature(); sigFile.value = ''; showSig() } } }, 'Remove signature')] : [h('p', { class: 'small muted', text: 'No signature: the letter says "Digitally signed" only if you add one.' })]))
    sigFile.addEventListener('change', async () => {
        try {
            const file = sigFile.files?.[0]; if (!file) return
            dropSignature()
            const out = await processSignatureFile(file)
            const bytes = new Uint8Array(await out.blob.arrayBuffer())
            LETTER.signature = { bytes, sha: await sha256Hex(bytes), url: URL.createObjectURL(out.blob) }
            sigFile.value = ''
            showSig()
        } catch (e) { fail(e) }
    })
    showSig()

    const inputNow = () => {
        if (!LETTER.typeLabel && !type.value) throw new Error('Choose a text first')
        const variables = Object.fromEntries([...vars.querySelectorAll('input')].map(i => [i.dataset.var, i.value.trim()]))
        const missing = Object.entries(variables).filter(([, v]) => !v).map(([k]) => k)
        if (missing.length) throw new Error(`Fill in: ${missing.join(', ')}`)
        return {
            type: LETTER.typeLabel, kind: kind.value, title: title.value.trim(), subject: kind.value === 'letter' ? subject.value.trim() : '', body: text.value.trim(),
            companyId: company.value || undefined, issueDate: date.value, variables, sendEmail: sendEmail.checked, saveTemplate: saveTemplate.checked,
            signatory: { ...(sigName.value.trim() ? { name: sigName.value.trim() } : {}), ...(sigTitle.value.trim() ? { title: sigTitle.value.trim() } : {}) },
        }
    }
    const chosen = () => [...pick.querySelectorAll('input:checked')].map(i => i.value)
    const out = h('div', { id: 'lt-preview' })
    const frame = h('div', { id: 'lt-pdf' })
    const previewBtn = h('button', { id: 'lt-preview-go', on: { click: () => busy(previewBtn, 'Preparing…', async () => {
        try {
            const input = inputNow(), ids = chosen()
            if (!ids.length) throw new Error('Choose at least one employee')
            const rows = await api('POST', '/api/owner/letters/preview', { body: { action: 'letter.preview', input, employeeIds: ids }, sign: true })
            LETTER.preview = { input, rows }
            LETTER.previewKey = canonicalJson({ input, ids, sig: LETTER.signature?.sha ?? null })
            out.replaceChildren(...rows.map(r => h('div', { class: 'panel', 'data-letter-preview': r.employeeId },
                h('h3', { text: `${r.preview.recipient.name}: ${r.preview.title}` }), r.preview.subject ? h('p', { text: `Subject: ${r.preview.subject}` }) : null,
                h('pre', { class: 'letter-text', text: r.preview.body }),
                h('button', { class: 'secondary', 'data-pdf': r.employeeId, on: { click: e => busy(e.currentTarget, 'Rendering…', async () => {
                    try {
                        const sig = LETTER.signature
                        const blob = await api('POST', '/api/owner/letters/preview/pdf', { body: { action: 'letter.preview-pdf', input, employeeId: r.employeeId, ...(sig ? { signatureSha256: sig.sha } : {}) },
                            sign: true, attachment: sig?.bytes, raw: true })
                        const url = URL.createObjectURL(blob)
                        frame.replaceChildren(h('iframe', { src: url, id: 'lt-pdf-frame', title: 'PDF preview', class: 'pdf' }))
                    } catch (err) { fail(err) }
                }) } }, 'Show the PDF'))))
            say(msg, 'good', `Preview ready for ${rows.length} employee(s). Check it, then Issue.`)
        } catch (e) { fail(e) }
    }) } }, 'Preview')
    const issueBtn = twoStep(h('button', { id: 'lt-issue' }, 'Issue (signed)'), 'Confirm: issue now', async () => {
        try {
            const input = inputNow(), ids = chosen(), sig = LETTER.signature
            if (!LETTER.preview || LETTER.previewKey !== canonicalJson({ input, ids, sig: sig?.sha ?? null })) throw new Error('Something changed since the preview. Preview again first.')
            if (sig && !input.sendEmail) throw new Error('A signed letter has to be emailed: turn on "Email the PDF" or remove the signature.')
            const changes = LETTER.preview.rows.map(r => ({ key: `certificates/${newRecordId()}`, state: r.state }))
            const r = await act('/api/owner/letters/issue', { action: 'letter.issue', input, changes, ...(sig ? { signatureSha256: sig.sha } : {}) }, sig?.bytes)
            dropSignature(); LETTER.preview = null
            lettersTab(body, alertBox('good', 'Issued', h('ul', {}, ...r.letters.map(l => h('li', { text: `${l.referenceNo} (email: ${l.email})` })))))
        } catch (e) { fail(e) }
    })
    const list = h('table', { id: 'letters-table' }, h('thead', {}, h('tr', {}, ...['Ref', 'To', 'Title', 'Status', ''].map(t => h('th', { text: t })))),
        h('tbody', {}, ...letters.slice(0, 100).map(l => {
            const acts = []
            if (l.state.status === 'issued') {
                const reason = inputT(`rv-${l.id}`, '', { placeholder: 'Reason', size: 14 })
                acts.push(reason, twoStep(h('button', { class: 'danger', 'data-revoke': l.id }, 'Revoke'), 'Confirm: revoke', async () => {
                    try { await act(`/api/owner/letters/${l.id}/revoke`, { action: 'letter.revoke', changes: [{ key: l.key, state: normalizeCertificate({ ...l.state, status: 'revoked', revokeReason: reason.value.trim() || null }) }] }); lettersTab(body, alertBox('good', null, h('p', { text: `Revoked ${l.referenceNo}.` }))) } catch (e) { fail(e) }
                }))
                acts.push(h('button', { class: 'secondary', 'data-resend': l.id, on: { click: e => busy(e.currentTarget, 'Sending…', async () => {
                    try {
                        const sig = LETTER.signature
                        const r = await act(`/api/owner/letters/${l.id}/resend`, { action: 'letter.resend', changes: [{ key: l.key, state: l.state }], ...(sig ? { signatureSha256: sig.sha } : {}) }, sig?.bytes)
                        dropSignature(); lettersTab(body, alertBox('good', null, h('p', { text: `${l.referenceNo}: email ${r.email}${sig ? ' (signed)' : ''}.` })))
                    } catch (err) { fail(err) }
                }) } }, LETTER.signature ? 'Resend signed' : 'Resend'))
            }
            return h('tr', { 'data-letter': l.id }, h('td', { class: 'mono small', text: l.referenceNo }), h('td', { text: l.state.recipient.name }), h('td', { text: l.state.title }),
                h('td', { text: `${l.state.status}${l.signed ? ' · signed' : ''}` }), h('td', {}, h('div', { class: 'row' }, ...acts)))
        })))
    body.replaceChildren(msg,
        h('div', { class: 'panel' }, h('h2', { text: 'Issue a letter or certificate' }),
            h('label', { text: 'Company' }), company, h('label', { text: 'Text' }), type, h('label', { text: 'Layout' }), kind,
            ...field('Title', title), ...field('Subject (letters)', subject), h('label', { for: 'lt-body', text: 'Text (placeholders like {{employeeName}} are filled in)' }), text,
            h('h3', { text: 'Values' }), vars, ...field('Issue date', date), ...field('Signatory name (empty = the company\'s)', sigName), ...field('Signatory title', sigTitle),
            h('label', { class: 'row' }, sendEmail, ' Email the PDF'), h('label', { class: 'row' }, saveTemplate, ' Remember this wording'),
            h('h3', { text: 'Employees' }), pick,
            h('h3', { text: 'Signature (optional, this issue only)' }), sigFile, sigBox,
            h('p', { class: 'small muted', text: 'The background is removed on this computer. The image is sent only with this request, covered by your signature, and never stored.' }),
            h('div', { class: 'row' }, previewBtn, issueBtn)),
        out, frame,
        h('div', { class: 'panel' }, h('h2', { text: 'Issued' }), letters.length ? list : h('p', { class: 'muted', text: 'Nothing issued yet.' })))
    await loadTypes()
}
