# Backend deploy notes

- `npm run build` only compiles `src/` to `dist/`. The **`assets/` folder (fonts and letterhead artwork) must be
  included in the deploy bundle**, next to `dist/` (the server reads `backend/assets/...` at runtime).
  Without it, letters for companies with a letterhead fail with "Letterhead files are missing on the server",
  and the server logs a warning at startup.
- Letterhead artwork is built from the approved design PDFs with `scripts/letterheads/build_assets.py`
  (see the comment at the top of that file). Fonts are the official Google Fonts files; their licences are in `assets/fonts/`.

## Scheduled jobs (cPanel cron)

The host can pause the Node app when it is idle, and node-cron inside a paused app does not run. So every
scheduled job can also be started over HTTP, by cPanel **Cron Jobs**. node-cron stays on as a backup: each
job takes a lock (collection `jobruns`) and its writes are idempotent, so running it twice, or from both
places at the same moment, never doubles anything.

| Job | Endpoint | What it does |
|---|---|---|
| Monthly payroll | `POST /api/cron/payroll` | Creates the salary records of the current month **in `PAYROLL_TIMEZONE` (Asia/Dubai)**, whatever the server's own timezone. Existing records are never touched, so it can run as often as you like. |
| Media cleanup | `POST /api/cron/media-cleanup` | Deletes chat attachments older than 48 hours from Cloudinary. |
| Owner daily report | `POST /api/cron/owner-report` | Emails `OWNER_REPORT_EMAIL` the Owner Console report for yesterday (Asia/Dubai): owner actions, history check, chain and key fingerprints. Sent once per day, by whichever run comes first. |
| Chat reminders | `POST /api/cron/chat-reminders` | Emails people about unread chat messages. Catches up on everything that became due since its previous run (at most `CHAT_REMINDER_CATCHUP_MAX_DAYS`, default 7), so any interval works. |

Every call needs the header `X-Cron-Secret` with the value of `CRON_SECRET` (compared in constant time).
Without it, or with a wrong one, the answer is 401. While `CRON_SECRET` is unset or shorter than 24
characters, the endpoints refuse everything.

### Setup

1. Make a secret and put it in the backend environment (cPanel > Setup Node.js App > Environment variables),
   then restart the app:

   ```sh
   openssl rand -hex 32          # -> CRON_SECRET=<that value>
   ```

2. Store the header in a file only your cPanel account can read, so the secret is not shown in the cron
   list or in the process list (cPanel > Terminal, or File Manager + permissions 600):

   ```sh
   printf 'X-Cron-Secret: %s\n' '<the same value>' > ~/.cron-secret && chmod 600 ~/.cron-secret
   ```

3. cPanel > **Cron Jobs** > Add New Cron Job, one per line below (Common Settings: "Once Per Five Minutes",
   "Once Per Hour", or type the fields). cPanel runs them in the server's timezone; that is fine, because
   payroll works out the month in Asia/Dubai itself. Replace `CPANELUSER` with the account name.

   ```
   */5 * * * *   curl -fsS -m 120 -X POST -H @/home/CPANELUSER/.cron-secret https://api.smbdigitalx.com/api/cron/chat-reminders >/dev/null
   7 * * * *     curl -fsS -m 300 -X POST -H @/home/CPANELUSER/.cron-secret https://api.smbdigitalx.com/api/cron/media-cleanup >/dev/null
   15 * * * *    curl -fsS -m 300 -X POST -H @/home/CPANELUSER/.cron-secret https://api.smbdigitalx.com/api/cron/payroll >/dev/null
   25 * * * *    curl -fsS -m 120 -X POST -H @/home/CPANELUSER/.cron-secret https://api.smbdigitalx.com/api/cron/owner-report >/dev/null
   ```

   - The request itself wakes a paused app, so the job runs even after the app was asleep.
   - `-f` makes curl fail on a 401 or 500, and `>/dev/null` keeps only errors: cPanel emails the cron
     output to the address under "Cron Email", so you hear about failures and nothing else.
   - If cPanel does not allow every five minutes, use any longer interval (every 15 minutes, every hour):
     chat reminders catch up on everything since the previous run. Reminder emails then arrive up to
     that interval later than `CHAT_REMINDER_DELAY_MINUTES`.
   - The owner report runs every hour but sends only once per day: the first run after midnight in Dubai.
   - Payroll runs every hour, but only creates anything once per month (on the 1st, Asia/Dubai time, or
     on the first run after that if the app was paused).

4. Check it once by hand from the cPanel terminal: the answer should be `"ran":true` (or `"ran":false,
   "reason":"already running"` if node-cron happened to be running the same job at that moment).

   ```sh
   curl -sS -X POST -H @$HOME/.cron-secret https://api.smbdigitalx.com/api/cron/payroll
   ```

`GET` and any other job name are not accepted. The last run of each job (time, source, result or error) is
in the `jobruns` collection.

## Owner Console

The Owner Console is a single HTML file on Sir Simo's laptop (`owner-console/`, see its README). It talks only to
`/api/owner/*`. Two settings in the backend environment:

| Variable | What it is |
|---|---|
| `OWNER_REPORT_EMAIL` | Sir Simo's private email. Receives the setup confirmation, passphrase-change notices and the daily report. |
| `OWNER_SETUP_WINDOW_UNTIL` | An ISO time, e.g. `2026-12-01T10:30:00Z`. The one-time setup is possible only before it. Leave it unset at all other times. |

**One-time setup, only with Sir Simo present:**

1. With Sir Simo at his laptop, set `OWNER_SETUP_WINDOW_UNTIL` to about 30 minutes from now (UTC) and restart the app.
2. He opens the console file and follows the setup. Its first step sends a test email to `OWNER_REPORT_EMAIL`:
   check it arrived (and not in spam) before going on.
3. When setup is done, he compares the key fingerprint in the console, on the printed recovery sheet and in the
   "Owner Console setup completed" email. They must all be the same.
4. Remove `OWNER_SETUP_WINDOW_UNTIL` and restart the app. (Setup is refused for ever after one success anyway.)

If the console says it is **already set up** on his first visit, nobody may continue: someone else completed
the setup. Treat it as an incident.
