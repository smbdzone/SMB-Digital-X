# Owner Console

Sir Simo's owner console: **one self-contained HTML file** he opens from his laptop (`file://` in Chrome or Edge, in a
separate profile: see [CONSOLE-PROFILE-GUIDE.md](CONSOLE-PROFILE-GUIDE.md)). It never loads code from the server; it
talks only to `/api/owner/*` on the API host. Nothing on the server is trusted: the passphrase, the recovery key and the
unlocked keys exist only in his browser.

| File | What it is |
|---|---|
| `src/crypto.js` | All cryptography (browser WebCrypto only). Also imported by the Node tests. The backend's `src/owner/signing.ts` implements the same formats. |
| `src/app.js` | The screens: setup, login, forgot passphrase, salaries (pilot action), history ("Verify everything"), settings. |
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
to the API host: no remote scripts, fonts, images or frames.

## Tests

```sh
node --test owner-console/test/crypto.test.mjs
```

## Handing over a new version
1. Build it, note the SHA-256.
2. Give him the file in person or on a USB stick (not by email or a shared drive), and the SHA-256 on paper or by phone.
3. He checks it with `certutil -hashfile <file> SHA256` before opening it.

## Keys and settings in brief
- Passphrase: PBKDF2-SHA256, 3,000,000 iterations, random salt → AES-256-GCM key that locks the vault key (AES-256-GCM)
  and the signing key (ECDSA P-256). The recovery key (160 bits, 8 groups of 4) separately locks the same keys via HKDF.
- Every owner request is signed (method, path, body SHA-256, time, nonce); the server checks it against the stored
  public key, allows ±2 minutes and each nonce once. No cookies or sessions.
- The console remembers (in this browser profile) the key fingerprint and the last verified history position, and
  warns if the server's key changes or its history gets shorter or rewritten.
