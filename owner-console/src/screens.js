/*
 * Owner Console v1.2.0 screens: Companies, Projects (budgets and milestone payments), Expenses and Letters.
 * Built into the same page as app.js (helpers such as h, api, act, field and alertBox come from there).
 */
/* global h, api, act, field, alertBox, busy, money, numInput, parseAmount, fmtDate, flagsFor, staleVerifyNote */

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

const projectsTab = async (body, message = null) => {
    body.replaceChildren(h('p', { class: 'muted', text: 'Loading projects…' }))
    let rows
    try { rows = await api('GET', '/api/owner/projects', { sign: true }) } catch (e) { return body.replaceChildren(alertBox('bad', null, h('p', { text: e.message }))) }
    const msg = h('div', { id: 'projects-result' }, message)
    const reload = text => projectsTab(body, alertBox('good', null, h('p', { text })))
    const fail = e => say(msg, 'bad', e.message)
    const cards = rows.map(p => {
        const budget = numInput(`budget-${p.id}`, p.state.budget)
        const setBudget = h('button', { 'data-budget': p.id, on: { click: () => busy(setBudget, 'Saving…', async () => {
            try { const b = parseAmount(budget.value, 'Budget') ?? 0; await act('/api/owner/projects/budget', { action: 'project.budget', changes: [{ key: p.key, state: normalizeProject({ budget: b }) }] }); reload(`Budget of ${p.name}: ${money(b, 'AED')}.`) } catch (e) { fail(e) }
        }) } }, 'Set budget (signed)')
        const del = twoStep(h('button', { class: 'danger', 'data-delete-project': p.id }, 'Delete project'), `Confirm: delete ${p.name} and its ${p.milestones.length} milestone(s)`, async () => {
            try { await act('/api/owner/projects/delete', { action: 'project.delete', changes: [{ key: p.key, state: null }, ...p.milestones.map(m => ({ key: m.key, state: null }))] }); reload(`Deleted ${p.name}.`) } catch (e) { fail(e) }
        })
        const msRows = p.milestones.map(m => {
            const s = m.state
            const mode = select(`ms-mode-${m.id}`, [['percentage', '% of budget'], ['amount', 'Amount']], s.paymentMode)
            const value = numInput(`ms-value-${m.id}`, s.paymentMode === 'amount' ? s.paymentAmount : s.paymentPercentage)
            const cur = inputT(`ms-cur-${m.id}`, s.currency, { maxlength: 3, size: 3 })
            const status = select(`ms-status-${m.id}`, [['unpaid', 'unpaid'], ['invoiced', 'invoiced'], ['paid', 'paid']], s.paymentStatus)
            const inv = h('input', { type: 'date', id: `ms-inv-${m.id}`, value: dayOf(s.invoicedAt) }), paid = h('input', { type: 'date', id: `ms-paid-${m.id}`, value: dayOf(s.paidAt) })
            const save = h('button', { 'data-ms-save': m.id, on: { click: () => busy(save, 'Saving…', async () => {
                try {
                    const v = parseAmount(value.value, 'Payment') ?? 0, b = p.state.budget
                    const st = status.value
                    const state = normalizeMilestone({
                        projectId: p.id, paymentMode: mode.value, currency: cur.value.trim().toUpperCase(), paymentStatus: st,
                        paymentPercentage: mode.value === 'percentage' ? v : (b > 0 ? round2(v / b * 100) : 0),
                        paymentAmount: mode.value === 'percentage' ? round2(b * v / 100) : v,
                        invoicedAt: st === 'unpaid' ? null : isoDay(inv.value || paid.value || new Date().toISOString().slice(0, 10)),
                        paidAt: st === 'paid' ? isoDay(paid.value || new Date().toISOString().slice(0, 10)) : null,
                    })
                    await act('/api/owner/milestones/payment', { action: 'milestone.payment', changes: [{ key: m.key, state }] })
                    reload(`Milestone "${m.title}": ${money(state.paymentAmount, state.currency)}, ${st}.`)
                } catch (e) { fail(e) }
            }) } }, 'Save (signed)')
            const mdel = twoStep(h('button', { class: 'secondary', 'data-ms-delete': m.id }, 'Delete'), 'Confirm: delete', async () => {
                try { await act('/api/owner/milestones/delete', { action: 'milestone.delete', changes: [{ key: m.key, state: null }] }); reload(`Deleted milestone "${m.title}".`) } catch (e) { fail(e) }
            })
            return h('tr', { 'data-milestone': m.id }, h('td', { text: m.title }), h('td', {}, mode), h('td', {}, value), h('td', {}, cur), h('td', {}, status),
                h('td', {}, inv), h('td', {}, paid), h('td', { class: 'mono small', text: money(s.paymentAmount, s.currency) }), h('td', {}, h('div', { class: 'row' }, save, mdel)))
        })
        return h('div', { class: 'panel', 'data-project': p.id }, h('div', { class: 'row' }, h('h3', { text: `${p.name}` }), h('span', { class: 'small muted', text: `${p.clientName} · ${p.status}` }), h('span', { class: 'spacer' }), del),
            h('div', { class: 'row' }, h('label', { text: 'Budget' }), budget, setBudget),
            p.milestones.length ? h('table', {}, h('thead', {}, h('tr', {}, ...['Milestone', 'Enter as', 'Value', 'Cur.', 'Payment', 'Invoiced', 'Paid', 'Amount', ''].map(t => h('th', { text: t })))), h('tbody', {}, ...msRows))
                : h('p', { class: 'small muted', text: 'No milestones (they are added on the website).' }))
    })
    body.replaceChildren(msg, h('div', { class: 'panel' }, h('h2', { text: 'Projects: budgets and milestone payments' }),
        h('p', { class: 'small muted', text: 'Everything without money (names, dates, team, work status) is managed on the website.' })), ...cards)
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
