# Bub Feed Log: setup guide

Already done, so not covered here: the Firebase project, sign-in, the database and its rules, GitHub Pages, installing on your phones, and notifications through the Cloudflare sender.

What's left, in order:

1. Upload version 1.4
2. Google Calendar (optional)
3. Tidy up the old notification sender
4. Protections to check (skip any you've done)

Do these on a computer. The Google and Cloudflare dashboards are hard to use on a phone.

---

## 1. Upload version 1.4

1. On GitHub, open your `bub-feed-log` repository › **Add file** › **Upload files**.
2. Drag in `index.html`, `sw.js`, `version.json`, `sender.js` and `SETUP.md` from the zip. Keep your own `config.js` as it is.
3. **Commit changes**.

Cloudflare redeploys the sender by itself because `sender.js` changed. Your phones show **A new version is ready** within a few hours, or straight away from **Settings** › **Help and about** › **Check for updates**. The database rules haven't changed.

## 2. Google Calendar (optional)

Without this, each appointment has an **Add to Google Calendar** button: one tap fills in a new event. With it, one of you connects once, and appointments go into their own calendar in your Google account, then move or disappear there when you change or cancel them in the app, from either phone. About 15 minutes.

**2a. Turn on the Google Calendar API**

1. Open <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> and pick your Firebase project at the top.
2. Click **Enable**.

**2b. The sign-in screen Google shows (Google Auth Platform)**

1. Open <https://console.cloud.google.com/auth/overview>. If it says **Get started**, fill it in: app name **Bub Feed Log**, your Gmail as the support and contact email, audience **External**. If it already shows a name, keep it.
2. **Audience** › under Publishing status, click **Publish app** so it says **In production**. In Testing, Google ends the connection every 7 days.
3. **Data access** › **Add or remove scopes** › in the filter, type `calendar.app.created` › tick **…/auth/calendar.app.created** › **Update** › **Save**. This lets the app make one calendar and change only that calendar. It can't see your other calendars.

You don't need Google to verify the app. Until it does, Google shows a warning when you connect, and up to 100 people can connect.

**2c. A sign-in client for the sender**

1. **Clients** › **Create client** › Application type **Web application** › name it **Bub Feed Log calendar**.
2. Under **Authorised redirect URIs**, click **Add URI** and enter your sender's address followed by `/cal/back`. It's the `pushSender` address in `config.js`, for example `https://bub-feed-log-sender.yourname.workers.dev/cal/back`.
3. **Create**. Copy the **Client ID** and the **Client secret** now. The secret is shown once.

The client secret is a password. Never put it in `config.js` or anything on GitHub. It only goes into Cloudflare, next.

**2d. Give them to the sender (Cloudflare)**

1. Cloudflare dashboard › **Workers & Pages** › **bub-feed-log-sender** › **Settings** › **Variables and Secrets**.
2. **Add** › type **Secret** › name `GOOGLE_OAUTH_ID` › paste the Client ID.
3. **Add** › type **Secret** › name `GOOGLE_OAUTH_SECRET` › paste the Client secret.
4. **Deploy**.
5. Open your sender's address with `/health` on the end. It should finish with **Google Calendar is set up.**

**2e. Connect, then share it**

1. In the app: **Settings** › **Appointments** › **Connect Google Calendar**.
2. Sign in with the Google account the calendar should live in. Google says it hasn't verified the app: tap **Advanced**, then **Go to Bub Feed Log**. Tick the calendar permission and tap **Continue**.
3. You're brought back to the app, and it says Google Calendar is connected. Everything already booked goes in within a few seconds.
4. To see it on Genie's phone too, share it. On a computer, open <https://calendar.google.com> › **Settings** (gear) › under **Settings for my calendars**, pick the calendar named after the baby › **Share with specific people or groups** › **Add people** › her email › **Make changes to events** › **Send**.

To stop it: **Disconnect** in Settings › Appointments, or remove Bub Feed Log at <https://myaccount.google.com/connections>.

## 3. Tidy up the old notification sender

The sender moved from Google to Cloudflare. Two leftovers:

1. **Cloudflare:** **bub-feed-log-sender** › **Settings** › **Build** › **Variables and secrets**: delete `GOOGLE_KEY` there. Keep the `GOOGLE_KEY` under the main **Settings** › **Variables and Secrets**: the sender needs that one.
2. **Google:** <https://console.cloud.google.com/functions> with your project selected: tick **snooze** › **Delete**.

## 4. Protections to check

Skip any you've already done. Each is optional, but they add up.

<details><summary><b>Two-step sign-in on your Google account</b> (2 minutes)</summary>

You're the host, so your Google account is the key to the Firebase console.

- Turn on **2-Step Verification**: <https://myaccount.google.com/signinoptions/twosv>.
- In Firebase, **Project settings** › **Users and permissions** should list only you.
</details>

<details><summary><b>A budget alert on the paid plan</b> (2 minutes)</summary>

<https://console.cloud.google.com/billing> › **Budgets & alerts** › **Create budget**: **5** dollars, for your Firebase project. Google emails you at 50%, 90% and 100%. At your size the bill is $0.
</details>

<details><summary><b>Lock the Firebase key to your address</b> (5 minutes)</summary>

1. <https://console.cloud.google.com/apis/credentials> › **Browser key (auto created by Firebase)**.
2. **Application restrictions:** **Websites**, add `https://YOURNAME.github.io/*` and `https://PROJECT_ID.firebaseapp.com/*`.
3. **API restrictions:** leave Firebase's own list as it is. It includes **FCM Registration API**, which notifications need.
4. **Save** (Google may warn about usage from other APIs: that's bots trying the key, so type **UPDATE**), wait 5 minutes, then check the app still signs in and syncs.
</details>

<details><summary><b>App Check</b> (10 minutes, then a day of normal use)</summary>

Makes Firebase refuse requests that don't come from your app at your address.

1. <https://console.cloud.google.com/security/recaptcha> with your **Firebase project** selected at the top (a key in any other project won't work) › **Create key** › name `Bub Feed Log`, type **Web**, domain `YOURNAME.github.io`, everything under Additional settings off › copy the key: 40 characters starting with `6L`, not the web address on the page after.
2. Firebase console › **App Check** › **Apps** › your web app › **Fraud Defense** (formerly reCAPTCHA Enterprise): paste the key, **Token time to live** **1 day**, save.
3. In `config.js` on GitHub, paste the key into `appCheckKey: '...'` and commit.
4. After a day of normal use, **App Check** › **APIs** › **Cloud Firestore**: if almost all requests show **Verified**, click **Enforce**. Leave **Authentication** on monitoring: it's still a preview.

If the pill ever says **Sync problem** after this, turn **Enforce** off again.
</details>

<details><summary><b>Firebase's own daily backup, and delete protection</b> (5 minutes)</summary>

1. <https://console.cloud.google.com/firestore/databases> › your database › **Disaster recovery** › **Create backup schedule** › **Daily**, keep **14 days**.
2. Delete protection, in Cloud Shell (<https://console.cloud.google.com/?cloudshell=true>):
   ```
   gcloud firestore databases update --database='(default)' --delete-protection --project YOUR_PROJECT_ID
   ```
</details>

<details><summary><b>Google Drive backups</b> (10 minutes)</summary>

You've done this if **Settings** › **Backups and export** shows a **Back up** button next to Google Drive. It gives you an extra encrypted copy outside Firebase.

1. <https://console.cloud.google.com/apis/library/drive.googleapis.com> with your project selected › **Enable**.
2. Google Auth Platform: the same app as step 2b (do 2b's first two points if you haven't). The Drive permission needs no extra scope here.
3. **Clients** › **Create client** › **Web application** › name it **Bub Feed Log Drive** › under **Authorised JavaScript origins**, add `https://YOURNAME.github.io` › **Create** › copy the **Client ID** (ends in `.apps.googleusercontent.com`).
4. In `config.js` on GitHub, paste it into `googleClientId: '...'` and commit.
5. In the app: **Settings** › **Backups and export** › **Google Drive** › **Back up**. If Google warns the app isn't verified, tap **Advanced** or **Continue**.

Drive copies need a tap each time. The home screen reminds you after a week.
</details>

---

## Reference

### Updating the app later

Upload the new files to GitHub (keep your own `config.js`). If an update says the rules changed, paste the new `firestore.rules` into Firestore › **Rules**, put your email back in place of `paste_host_google_email` (lower case), and **Publish**. Phones show **A new version is ready**, or use **Settings** › **Help and about** › **Check for updates**.

### New phones, lost phones and the recovery code

- **A new phone:** sign in, tap **Ask a phone that has the log**, and check the 12-digit code matches the one on another phone before tapping **Allow** there.
- **No other phone to hand:** **Use the recovery code**.
- **Lost a phone:** on another phone, **Settings** › **People and sharing** › **Phones that can open the log** › **Remove**.
- **Lost the recovery code:** **Settings** › **Account** › **Make a new recovery code**. The old one stops working.
- **Lost every phone and the code:** nobody can open the log, including you. Keep the code safe.

### Letting a friend in

1. **Settings** › **People and sharing** › **Let someone in** (only you see this). Pick how long the code works.
2. **Share** the message. They open the link, sign in with Google, start their own log and save their own recovery code.

The same page lists everyone who's got in. **Remove** cuts someone off; **Let back in** undoes it. Their logs are encrypted with their own key: you can see a family exists, not what's in it.

### Babysitter or helper link

**Settings** › **People and sharing** › **Babysitter or helper**: their name, **Can log** or **View only**, and when it stops working. The link works on the first phone that opens it. They see Home, History, and in the baby's tab only Coming up and Milk. Switching it off, a new link or the end date stops it straight away and clears the log from their phone.

### Backups

| Where | When | What |
|---|---|---|
| Each phone | Once a day, when the app opens | Every entry; 14 days of copies kept |
| Your Firebase database | Once a week, per family | Every entry, encrypted; 6 copies kept |
| Google Drive (if set up) | When you tap Back up | An encrypted file |
| A file | Settings › Backups and export › Save a file | An encrypted file |

Restoring only adds back missing entries. It never deletes or changes anything.

### If something goes wrong

| What you see | What to do |
|---|---|
| Notifications never arrive | **Settings** › **Notifications**: check it's on, then **Send a test**. Open the sender's address with `/health` on the end. On Samsung, check Chrome isn't a sleeping app (**Settings** › **Battery** › **Background usage limits**). |
| Google Calendar: **isn't set up on the notification sender yet** | Do step 2d, then check `/health`. |
| Google Calendar: **isn't connected any more** | Access was removed in the Google account, or the calendar was deleted. Connect again in **Settings** › **Appointments**. |
| Google: **redirect_uri_mismatch** when connecting | The address in step 2c must be the sender's address plus `/cal/back`, exactly. |
| An old app icon on the home screen | Open `chrome://webapks` in Chrome, tap **Update** next to Bub Log, then reopen the app. |
| **Sync problem** pill | Usually signed out. **Settings** › **Account** › **Sign out**, then sign in again. |
| **That code didn't work** (a friend) | Codes work once and expire. Make a new one. |
| **Link not working** (babysitter) | It ended, was replaced, or was opened on another phone. Send a new link. |
| **Unlock the log on this phone** | Normal on a new phone. Ask another phone, or use the recovery code. |
| Changes on GitHub don't show | Wait a minute, then **Settings** › **Help and about** › **Check for updates**. |

### What protects the data

| Layer | What it stops |
|---|---|
| Encryption on the phones | Anyone reading a family's log from the database: you, Google, or someone who breaks in. |
| Phone approval with a 12-digit code | A stolen Google sign-in opening the log on a new phone unnoticed. |
| Key changes on removal | A removed person, lost phone or ended babysitter link reading anything new. |
| Firestore rules | Anyone outside a family reading or changing its data. |
| One-time codes and the approved list | Strangers who find the link getting past sign-in. |
| Notification text sealed by the phones | The sender (or Google) reading what a notification says. |
| Calendar checks on the sender | Anyone but a member of your log adding to or changing your calendar. Only appointment details leave the encryption, on their way to Google Calendar. |

### Moving to Firebase Hosting later

Nothing is lost: the data lives in Firestore, not on GitHub. Deploy the same files with Firebase Hosting, then add the new address in three places: Firebase › **Authentication** › **Settings** › **Authorized domains**, the reCAPTCHA key's domains (if you use App Check), and the Firebase key's website list (if you locked it). Each phone opens the new address, signs in once, and is approved with the 12-digit code or the recovery code.
