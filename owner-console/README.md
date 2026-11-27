# Owner Console

Sir Simo's owner console: **one self-contained HTML file** he opens from his laptop (`file://` in Chrome or Edge, in a
separate profile: see [CONSOLE-PROFILE-GUIDE.md](CONSOLE-PROFILE-GUIDE.md)). It never loads code from the server; it
talks only to `/api/owner/*` on the API host. Nothing on the server is trusted: the passphrase, the recovery key and the
unlocked keys exist only in his browser.

| File | What it is |
|---|---|
| `src/crypto.js` | All cryptography (browser WebCrypto only). Also imported by the Node tests. The backend's `src/owner/signing.ts` implements the same formats. |
| `src/app.js` | The frame and the first screens: setup, login, forgot passphrase, Payroll, People, Requests, Verify everything (history and records, Adopt), Settings. |
| `src/screens.js` | Companies, Projects (budgets and milestone payments), Finance, Lock existing data, Expenses and Letters. |
| `src/vault.js` | Locked values (Phase 2): lock and unlock with the vault key. The backend's `src/owner/vault.ts` recognises the same format (it cannot unlock). |
| `src/signature.js` | The signature picker's background removal (same as the website's `lib/signatureClean.ts`). The image is kept in memory only and dropped on lock. |
| `src/integrity.js` | Owner records: canonical form, state hash, salary totals, the history index and the records check (same rules as the backend's `src/owner/ownerState.ts`), the money rules for budgets and milestone payments, and the Finance totals. |
| `src/index.html`, `src/style.css` | Page template (strict Content-Security-Policy) and the look (deliberately unlike the website). |
| `src/data/eff_large_wordlist.txt` | EFF large word list (7,776 words, CC BY 3.0 US, Electronic Frontier Foundation) for "Suggest a passphrase". |
| `src/data/common-phrases.txt` | Phrases refused as a passphrase. |
| `build.mjs` | Builds `dist/SMB-Owner-Console-v<version>.html` and prints its SHA-256. |

## Build

```sh
node owner-console/build.mjs            # production: API https://api.smbdigitalx.com
```

It prints the version and the file's SHA-256 and writes `dist/…html.sha256.txt` and the profile guide next to it.
`dist/` is not committed. The version is in `package.json`; bump it for every release.

The file's Content-Security-Policy allows only its own inline script and style (by hash), and network requests only
to the API host: no remote scripts or fonts. Images and frames are allowed only from `data:`/`blob:` (memory): the
cleaned signature shown before issuing, and the PDF preview the console fetched itself.

## Tests

```sh
node --test owner-console/test/crypto.test.mjs owner-console/test/integrity.test.mjs owner-console/test/vault.test.mjs
```

## Handing over a new version
1. Build it, note the SHA-256.
2. Give him the file in person or on a USB stick (not by email or a shared drive), and the SHA-256 on paper or by phone.
3. He checks it with `certutil -hashfile <file> SHA256` before opening it.

## Updating the console (new version)
1. **Build** the new version (the version in `package.json` goes up, e.g. v1.1.0). The build prints the file's SHA-256.
2. **Hand it over on a USB stick**, never by email, chat or a shared drive. Write the SHA-256 on paper.
3. **Ali checks the hash** on Sir Simo's laptop before anything is opened:
   `certutil -hashfile SMB-Owner-Console-v1.1.0.html SHA256` must print exactly the code on the paper.
4. **Sir Simo replaces the old file** with the new one (same folder, the old one deleted), opens it from the
   Owner Console browser profile and logs in as usual. Everything the console remembers (key fingerprint, history
   position, last "Verify everything") stays, because it is kept by the browser profile, not in the file.
5. At login he **compares the key fingerprint** with his recovery sheet, as always, then runs **Verify everything**.

Version 1.1.0 (Phase 1b-i) adds Payroll, People, bank details Requests, the records check and "Adopt current records".
The 1.0.0 file can no longer pay salaries (that pilot endpoint was replaced), so replace it before the next payroll.

Version 1.2.0 (Phase 1b-ii) adds Companies, Projects (budgets and milestone payments), Expenses (approve, reject,
reimburse, edit, delete) and Letters (preview with the letterhead PDF, issue single and bulk, revoke, resend, with the
signature picker). After installing it, run **Verify everything** and **Adopt** once for the new record types
(companies, budgets, milestone payments, expenses, letters); check the counts and totals in the summary first.

Version 1.3.0 (Phase 2) adds **Finance** (the budget, milestone and expense totals the website dashboard used to show)
and **Lock existing data**. Install it before starting the lock: once locking has started, the 1.2.0 file can no longer
change anything (the server answers "Use Owner Console v1.3.0 or later"). Deploy Phase 2 only after setup is done and
the existing records are adopted; until Sir Simo presses "Start locking", nothing is locked.

### Locked values (Phase 2)
Project budgets, each milestone's payment percentage and amount, and the body of every owner history entry are stored
locked: only this console can read them, with the vault key (unlocked by the passphrase or the recovery key).
- **Format** (version 1): `SMBV1.<IV>.<CIPHERTEXT>`, AES-256-GCM with a fresh 12-byte IV per value, both base64url
  without padding. The plaintext is the value's canonical JSON. The associated data
  `SMB-VAULT-1\n<collection>\n<record id>\n<field>` ties each value to its place (`projects/<id>/budget`,
  `milestones/<id>/paymentPercentage`, `milestones/<id>/paymentAmount`, and `ownerlogs/<the entry's one-time request
  code>/body`), so a value moved to another record or field does not unlock, and an edited one fails its check.
- **New requests** (after "Start locking"): the console locks the amounts before signing, and sends every request body as
  `{ v: 2, action, index, inner: { sha256, locked } }`. The plain inner body travels next to it (header
  `X-Owner-Parts: 1`) for the server to act on, and is not stored. The `index` lists each changed record's key and the
  hash of its new state. The server checks it against the inner body and keeps only the signed outer body. Its own
  records check and the daily report work from these indexes, hashes and seals; **Verify everything** unlocks every
  body here and checks it against its hashes and its index.
- **Rules that moved into the console** (the server can no longer read the amounts): budget 0 or more, milestone
  payments at most 100% of the budget, percentage and amount matching the budget, "amount" needs a budget above 0. The
  server still checks the shape of each record, payment status against its dates, the currency code, that a milestone
  stays in its project, and that every amount is a locked value.
- **Lock existing data** (Lock data tab, once): first the recovery key from the printed sheet (locking does not start if
  it fails), then a summary with the totals before locking, then the records and the old history bodies in signed
  batches (each value replaced in one database update, only while it is still plain: safe to stop and continue), then
  the console unlocks everything again and compares the totals before **Finish**.

### After locking: checklist
The values are locked from now on, but copies made before locking still hold them in plain form.
1. Delete old database exports and dumps, including any made with MongoDB Compass (exported JSON or CSV files).
2. Rotate or delete hosting backups and MongoDB Atlas snapshots taken before locking.
3. Check that nobody keeps a developer copy made from the real database before locking (the developer copy script
   blanks locked values, but older copies were made before they existed).

### Attachments (signature image, logo)
A file is never part of what the server stores. The request body is `{ "signed": "<the signed JSON>", "attachment":
"<base64>" }` with the header `X-Owner-Parts: 1` (`X-Owner-Attachment: 1` from older versions is still accepted). Only the `signed` text is hashed and signed; it names the
file's SHA-256 (`signatureSha256` or `attachmentSha256`). The server checks the file against that hash, uses it once
and wipes it; the owner history keeps only the signed text (so only the hash).

## Keys and settings in brief
- Passphrase: PBKDF2-SHA256, 3,000,000 iterations, random salt → AES-256-GCM key that locks the vault key (AES-256-GCM)
  and the signing key (ECDSA P-256). The recovery key (160 bits, 8 groups of 4) separately locks the same keys via HKDF.
- Every owner request is signed (method, path, body SHA-256, time, nonce); the server checks it against the stored
  public key, allows ±2 minutes and each nonce once. No cookies or sessions.
- The console remembers (in this browser profile) the key fingerprint and the last verified history position, and
  warns if the server's key changes or its history gets shorter or rewritten.
