# Owner Console: a separate browser profile (one page)

The Owner Console is one file on your laptop. Open it **only** in a separate browser profile that is not signed in
to any Google or Microsoft account and has **no extensions**. Your normal profile syncs with an account other people
can reach, and a synced extension could watch what you type. A clean profile shuts that door.

## 1. Create the profile (once)

**Google Chrome**
1. Click your profile picture at the top right, then **Add** (or "+ Add Chrome profile").
2. Choose **Continue without an account**.
3. Name it **Owner Console**, pick a colour you will recognise (for example orange), and tick
   **Create desktop shortcut**. Click **Done**.

**Microsoft Edge**
1. Click your profile picture at the top left, then **Add profile**, then **Add**.
2. Choose **Start without your data** (or "Continue without signing in"). Do not sign in.
3. Open **Settings > Profiles > Profile preferences** and name it **Owner Console**.
   Right-click the profile picture and choose **Add profile to desktop** for a shortcut.

## 2. Keep it clean
- **Never sign in** to Google or Microsoft in this profile, and never turn on sync.
- **No extensions.** Check `chrome://extensions` (Chrome) or `edge://extensions` (Edge): the list must be empty.
- Use this profile for nothing else: no email, no browsing.

## 3. Open the console
1. Open the browser **with the Owner Console shortcut** (not by double-clicking the file: Windows might open it
   in your normal profile).
2. Press **Ctrl+O**, choose `SMB-Owner-Console-v1.0.0.html`, and press **Ctrl+D** to bookmark it in this profile.
   Next time, use the bookmark.
3. The page must show the **striped amber banner "OWNER CONSOLE · local file"**. If you ever see a passphrase
   box without that banner, or on a website address (https://...), do not type.

## 4. Check the file before first use
The person who gives you the file also gives you its SHA-256 (a long code). In Windows, open **Command Prompt**
in the folder with the file and run:

    certutil -hashfile SMB-Owner-Console-v1.0.0.html SHA256

The code shown must be exactly the one you were given. During setup you can also add the file's code to your
printed recovery sheet, so you can check the same file again later.

## 5. Every time you log in
- Compare the **key fingerprint** on screen with the one on your printed recovery sheet. If it differs, stop.
- The console locks itself after 15 minutes without activity and when you close the tab.
- Always use the same profile: the console remembers your key fingerprint and history there, and warns you if
  anything on the server changes.
