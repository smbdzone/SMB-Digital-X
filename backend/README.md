# SMB Digital X backend

Deployment, environment variables and scheduled jobs: see [DEPLOY.md](DEPLOY.md).

## Developer copy of the database (scrambled)

Developers never connect to the production database. They work on a scrambled copy, made with
`scripts/make-dev-copy.ts`. The copy keeps every ID and relation, so the app runs on it normally, but:

- every person has a fake name and email (`Person 0007`, `person0007@dev.example`), the same person
  everywhere (certificates, salary slips, history, chats);
- salaries, allowances, deductions, expenses, taxes, budgets and milestone payments are random amounts;
- bank details, IBANs, account numbers and phone numbers are fake;
- letter and certificate texts, filled-in values, expense descriptions and notes, salary notes, history
  entries, client names and vendors are replaced with sample text;
- work content (EOD reports, deliverables, tasks, project text) is kept, with email addresses, phone
  numbers and employee names in it replaced;
- chat messages and attachment links are blanked; receipts lose their links; push subscriptions and
  password reset codes are not copied;
- every account's password is the same dev password (`DevCopy#2026`, or `DEV_PASSWORD`).

### Making the copy (Ali only)

Ali runs it with the production connection string as SOURCE. Run it from `backend/`:

```sh
# Before the FIRST run: put the real production database name here, so the script can never write to it.
export DEV_COPY_PROD_PATTERN='^<production database name>$'

SOURCE_URI='mongodb+srv://<user>:<password>@<cluster>/<production database name>' \
TARGET_URI='mongodb+srv://<dev user>:<password>@<dev cluster>/smbx_devcopy' \
npm run dev-copy
```

- `TARGET_URI` must name a database whose name looks like a dev copy (contains `dev`, `test`, `copy`,
  `local` or `scramble`; change with `DEV_COPY_TARGET_PATTERN`) and must not match `DEV_COPY_PROD_PATTERN`.
- It refuses when TARGET is the same database as SOURCE, and when the target is not empty.
  Add `--overwrite` to replace an older copy: `npm run dev-copy -- --overwrite`.
- Use a separate database user for the copy that has no access to production.

### Developers

Point your local `backend/.env` at the TARGET copy only:

```sh
MONGO_DB=mongodb+srv://<dev user>:<password>@<dev cluster>/smbx_devcopy
```

Log in with any copied account (`person0001@dev.example` ...) and the dev password. Never put the
production connection string in a local `.env`.
