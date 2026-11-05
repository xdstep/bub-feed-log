# Setting up Bub Feed Log

About 45 minutes, once. You need a computer, your Google account and a free GitHub account. Steps 1 to 14 are all on free plans with no card needed. Notifications (step 15) need Firebase's pay-as-you-go plan and a card; at your size it costs nothing, and step 15 sets up the protections.

**What you're building:** the app's files live on GitHub Pages (a free web address). Each family's log lives in your own Firebase database, **encrypted on the family's phones before it's saved**. The database only ever holds scrambled text. Nobody without one of that family's phones or its recovery code can read it: not GitHub, not Google, and not you, even though you own the Firebase project.

Steps 8 to 10 add Firebase's extra protections on top. They're optional, but worth the 15 minutes.

Firebase moves its menus around now and then. If a name below doesn't match exactly, look for the closest one.

---

## 1. Create a Firebase project

1. Go to <https://console.firebase.google.com> and sign in with your Google account.
2. Click **Create a project** (or **Add project**). Call it something like `bub-feed-log`.
3. Google Analytics: turn it **off**. You don't need it.
4. Click **Create project** and wait for it to finish.

## 2. Register the app and copy its settings

1. On the project's home page, click the **web** icon (`</>`) to add an app. Give it the nickname `Bub Feed Log`. Leave **Firebase Hosting** unticked. Click **Register app**.
2. Firebase shows a block of code with `const firebaseConfig = { apiKey: "...", authDomain: "...", ... }`.
3. Open `config.js` from this folder in a text editor (Notepad or TextEdit is fine). Copy each value from Firebase into the matching line, replacing the `PASTE_...` text. Keep the quote marks.
4. Check `hostName` says your first name. Friends see it when they sign up ("Jas runs this copy of the app").
5. Save `config.js`.

You can find these values again any time under the gear icon › **Project settings** › **Your apps**. They aren't secret: they only say which project to talk to.

## 3. Turn on sign-in

1. In the left menu, open **Authentication** (it may be under **Build** or **Security**). Click **Get started** if asked.
2. On the **Sign-in method** tab:
   - Click **Google**, switch it on, pick your email as the support email, and **Save**.
   - Click **Anonymous**, switch it on, and **Save**. This is only for babysitter links. Without a current link it gets nobody anywhere: the database rules shut anonymous visitors out of everything else.
3. Leave every other sign-in method off.

## 4. Create the database

1. In the left menu, open **Firestore** (under **Databases & Storage**, or **Build** › **Firestore Database**).
2. Click **Create database**.
3. If it asks for an edition, choose **Standard**.
4. Location: choose **australia-southeast2 (Melbourne)**, or **australia-southeast1 (Sydney)**. You can't change this later.
5. When asked about security rules, choose **production mode** (locked). The next step sets the real rules.
6. Click **Create**.

## 5. Paste the security rules

1. Still in Firestore, open the **Rules** tab.
2. Delete everything in the editor. Open `firestore.rules` from this folder, copy all of it, and paste it in.
3. Find this line:
   ```
   return isGoogle() && request.auth.token.get('email', '').lower() in ['paste_host_google_email'];
   ```
   Replace `paste_host_google_email` with **your** Google sign-in email, **in lower case**, keeping the quote marks. For example: `['jas.example@gmail.com']`. This makes you the host: the only person who can let new people into the app (with one-time codes), turn anyone's access off, and read feedback.
4. Click **Publish**.

Make this edit in the Firebase editor, not in the file you upload to GitHub, so your email stays private. Your partner's email doesn't go anywhere: they join with an invite code.

## 6. Put the app on GitHub Pages

1. Sign in at <https://github.com> (create a free account if you need one).
2. Click **+** › **New repository**. Name it `bub-feed-log`. Choose **Public** (free Pages needs public; the code is public, your data isn't). Click **Create repository**.
3. On the new repository page, click **uploading an existing file**.
4. Drag in these items from this folder: `index.html`, `config.js` (with your Firebase values), `manifest.webmanifest`, `sw.js`, `version.json`, `firebase.json`, and the whole `icons` and `functions` folders. Click **Commit changes**. (`functions` and `firebase.json` are for notifications in step 15. They're code only, with nothing private in them.)
5. Go to the repository's **Settings** › **Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, branch **main**, folder **/ (root)**. Click **Save**.
6. After a minute or two the page shows your address, something like `https://YOURNAME.github.io/bub-feed-log/`. Open it to check it says **This is a private app**.

## 7. Allow only that address to sign in

1. Back in Firebase: **Authentication** › **Settings** › **Authorized domains**.
2. Click **Add domain** and enter `YOURNAME.github.io` (just the domain: no `https://`, no `/bub-feed-log`).
3. Delete `localhost` from the list. Keep the two your project came with that end in `firebaseapp.com` and `web.app`: Google sign-in uses them.

## 8. App Check (recommended)

App Check makes Firebase refuse requests that don't come from your app at your address, so nobody can point a script at your database with your public settings. It runs invisibly: nobody ever sees a "prove you're human" puzzle.

**Make a reCAPTCHA key**

1. Go to <https://console.cloud.google.com/security/recaptcha> and pick your Firebase project at the top. Enable the API if it asks.
2. Click **Create key**. Name it `Bub Feed Log`. Platform: **Website**.
3. Domains: add `YOURNAME.github.io`. Don't add `localhost`.
4. Leave **Use checkbox challenge** unticked. Click **Create key**.
5. Copy the key's ID (a long string starting with `6L`).

**Turn it on in Firebase**

1. Firebase console › **App Check** (under **Security** or **Build**) › **Apps** tab.
2. Click your web app › **reCAPTCHA Enterprise**, paste the key, and set **Token time to live** to **1 day**. Save.
3. In `config.js` on GitHub, paste the key into `appCheckKey: '...'` and commit.
4. Open the app on your phone so it picks up the change. Use it normally for a day.
5. Back in **App Check** › **APIs**, open **Cloud Firestore**. The chart should show almost all requests as **Verified**. Then click **Enforce**.

**Why 1 day:** reCAPTCHA gives 10,000 free checks a month for your whole account, and once they're used up, checks fail until the 1st of the next month ([Google's billing page](https://docs.cloud.google.com/recaptcha/docs/billing-information)). The default 1-hour token uses a check every half hour or so on every open phone. With 1 day, ten busy families use roughly 1,000 a month. If checks ever run out, the app keeps working offline, and turning **Enforce** back off in the console brings syncing straight back.

## 9. Lock the Firebase key to your address

The `apiKey` in `config.js` is public by design. This stops it working from anywhere else.

1. Go to <https://console.cloud.google.com/apis/credentials> with your project selected.
2. Open the key called **Browser key (auto created by Firebase)**.
3. **Application restrictions:** choose **Websites** and add `https://YOURNAME.github.io/*`. Also add `https://PROJECT_ID.firebaseapp.com/*` (Google sign-in opens a window there).
4. **API restrictions:** choose **Restrict key** and tick only these: **Identity Toolkit API**, **Token Service API**, **Cloud Firestore API**, **Firebase Installations API**, **Firebase App Check API** and **reCAPTCHA Enterprise API**. If you set up Google Drive backups (step 13), Drive uses its own sign-in, so nothing else is needed here.
5. **Save**. Changes take up to 5 minutes. Then open the app and check it still signs in and syncs.

## 10. Protect your own Google account

You're the host, so your Google account is the key to the Firebase console and the friends' code.

- Turn on **2-Step Verification**: <https://myaccount.google.com/signinoptions/twosv>. A passkey or the Google prompt on your phone is the easiest.
- In Firebase, **Project settings** › **Users and permissions** should list only you.
- Firebase's free Spark plan has no billing account, so the project can never run up a bill.

## 11. Start your log, save the recovery code, invite your partner

1. Open the app address on your phone in **Chrome**. It says **This is a private app**. As the host you don't need a code: tap **Already in a log? Sign in** and sign in with the Google account you put in the rules.
2. Tap **Start a new log** and answer the questions:
   - your name
   - baby's name
   - birth date
   - weight and length
   - breast, bottle or a mix
   - how often the baby usually feeds

   Anything you're unsure of can be skipped and changed later in **Settings** › **Baby**.
3. The app shows your family's **recovery code**: 24 letters and numbers. **Save it now**, in a password manager or as a screenshot you won't delete. It's the only way back into the log if every phone is lost. Tap **I've saved it**.
4. The last screen shows an **invite code**. Tap **Share** (or **Copy link**) and send it to your partner.
5. On their phone: open the link, sign in with their Google account, and type their name. They land in the same log, and their phone gets its own key automatically. (If they only have the code, they type it into the box on the front screen.)

An invite works **once, within 24 hours**. **Settings** › **People and sharing** shows it, or makes a new one. For a grandparent or babysitter, the babysitter link (below) needs no Google account and can have an end date.

## 12. Install it on both phones

On each Android phone:

1. Open the app address in **Chrome**.
2. Tap the **⋮** menu › **Add to home screen** › **Install**.

On an iPhone: open it in **Safari**, tap **Share** › **Add to Home Screen**.

It now opens like an app, without the browser bars, and doesn't run in the background or drain battery when it's closed. On Android, long-press the icon for shortcuts: Start left, Start right, Wet nappy, Bottle.

## 13. Optional: Google Drive backups

The app already backs up automatically (see "Backups" below). Adding Drive gives you an extra copy outside Firebase.

1. Go to <https://console.cloud.google.com> and pick your Firebase project from the project list at the top. (Firebase made it for you.)
2. **APIs & Services** › **Library** › search **Google Drive API** › **Enable**.
3. Open **Google Auth Platform** (or **APIs & Services** › **OAuth consent screen**):
   - Fill in an app name (`Bub Feed Log`) and your email.
   - Audience: **External**.
   - On the **Audience** page, click **Publish app** so it says **In production**. Then nobody has to be added by email. The app only asks for the files it makes itself (the `drive.file` permission), which Google doesn't require a review for.
4. **Clients** (or **Credentials** › **Create credentials** › **OAuth client ID**):
   - Application type: **Web application**.
   - **Authorised JavaScript origins**: add `https://YOURNAME.github.io`
   - Create it, then copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
5. On GitHub, edit `config.js` and paste it into `googleClientId: '...'`. Commit.
6. In the app: **Settings** › **Backups and export** › **Google Drive** › **Back up**. Approve the Google screen the first time. If Google warns the app isn't verified, that's expected for your own app: tap **Advanced** or **Continue**.

Drive copies are encrypted like everything else. Drive copies need a tap, because Google only gives access while you're using the app. The home screen reminds you if it's been more than a week.

## 14. First-run checklist

- [ ] On your phone: tap **Wet nappy**.
- [ ] On your partner's phone: the wet nappy appears within a few seconds, logged by you.
- [ ] On your partner's phone: delete it (History › tap it › Delete, tap twice). It disappears from your phone too.
- [ ] Start a breastfeed on one phone. The other shows "Feeding · started by …" at the top and can finish it.
- [ ] In the Firebase console › Firestore › Data, open `families` › your log › `entries`. Each entry shows only `d`, `k`, `iv` and scrambled `c`: no names, times or amounts.
- [ ] **Settings** › **Backups and export** shows "last" with today's date for the phone and the cloud (give it 10 seconds after opening).
- [ ] Turn on flight mode, log something, turn it off again. The pill at the top goes from "Offline" to "Synced" and the other phone gets it.
- [ ] On a computer in a private window, open the app address and tap **Already in a log? Sign in** with a Google account that isn't in your log. It stops at **This is a private app** and can't go further.

## 15. Optional: notifications

Feed due, a timer left running, medicine OK to give again, and alerts when someone else logs something. About 25 minutes, all in the browser. Notifications need Firebase's pay-as-you-go plan (Blaze) so a small sender can run in your project. At your size the bill is $0, and these steps put three protections in place before anything else.

**15a. Switch to Blaze, with budget alerts**

1. Firebase console › the **⚙** next to **Project overview** › **Usage and billing** › **Details & settings** › **Modify plan** › **Blaze**. Add your card.
2. When it offers a budget, set **5** (dollars). Google emails you at 50%, 90% and 100%. Budget alerts only warn; they don't stop anything. The next two steps do that.

**15b. A spend cap on the sender**

1. Still in **Usage and billing**, find **Spend caps** (it may say Preview).
2. Add one for **Cloud Functions** of **2** dollars a month. If the sender ever reached it, it would pause for the rest of the month. The rest of the app keeps working.

**15c. The Web Push key**

1. **Project settings** › **Cloud Messaging** › scroll to **Web configuration** › **Web Push certificates** › **Generate key pair**.
2. Copy the long key and paste it into `config.js` as `pushKey: '…'`. It's public, like the other values. Upload `config.js` to GitHub again.

**15d. Which region your database is in**

Firestore › **Settings** (or the database's details) shows its **Location**, such as `australia-southeast1` (Sydney) or `australia-southeast2` (Melbourne). The sender must run in the same region. If it says `nam5`, use `us-central1`; if `eur3`, use `europe-west1`.

**15e. Put the sender in your project (Google Cloud Shell)**

Cloud Shell is a command line in the browser, with nothing to install.

1. Open <https://console.cloud.google.com/?cloudshell=true>, pick your Firebase project at the top, and wait for the terminal at the bottom.
2. Paste these one at a time, changing `YOURNAME`, `YOUR_REGION` and `YOUR_PROJECT_ID` (the setup guide page fills them in for you):
   ```
   cd ~ && rm -rf bub-feed-log && git clone https://github.com/YOURNAME/bub-feed-log.git && cd bub-feed-log
   sed -i "s/^const REGION = .*/const REGION = 'YOUR_REGION';/" functions/index.js && grep "const REGION" functions/index.js
   npx -y firebase-tools@latest login --reauth --no-localhost
   cd ~/bub-feed-log/functions && npm install && cd ~/bub-feed-log && npx -y firebase-tools@latest deploy --only functions --project YOUR_PROJECT_ID
   ```
   The region is just the code, like `australia-southeast2`, not the city name. `npm install` fetches the two packages the sender needs; without it the deploy stops with "Couldn't find firebase-functions package".
3. `login` shows a short session ID and a link. Open the link and sign in. The page then shows a long code starting with `4/0A`: paste that (not the session ID) where Cloud Shell says **Enter authorization code**.
4. `deploy` takes a few minutes. Say **yes** if it asks to turn on Google services (Cloud Functions, Cloud Build, Artifact Registry, Eventarc, Pub/Sub, Cloud Scheduler). If it asks how many days to keep container images, type **1** (this keeps storage inside the free amount).
5. It finishes with four functions: `notifyOnLog`, `sendReminders`, `snooze` and `budgetBrake`.

Nothing here writes to your database rules. The `firebase.json` in the folder only covers the functions.

**15f. Optional: the emergency brake**

If a month's spending ever passes your budget, the brake locks the database so nothing more can be read or written. Nothing is deleted, but the app stops working until you unlock it. Google's billing figures can lag by up to a day, so it limits the damage rather than stopping it instantly.

1. <https://console.cloud.google.com/billing> › **Budgets & alerts** › your budget › **Edit**.
2. Under **Manage notifications**, tick **Connect a Pub/Sub topic to this budget**, choose your project and the topic **budget-alerts** (made by step 15e). **Save**.

To unlock after a brake: paste `firestore.rules` back into Firestore › **Rules** (with your email in it, as in step 5) and press **Publish**. If the brake ever fails with a permission error in the Functions logs, give the project's "Default compute service account" the **Firebase Rules Admin** role in **IAM**.

**15g. Turn them on, on each phone**

1. In the app: **Settings** › **Notifications** › switch on, and tap **Allow** when the phone asks.
2. Tap **Send a test notification**, then lock the phone. It should arrive within a few seconds.
3. Choose what this phone hears about, and set quiet hours. At night, tap **My turn tonight** on the phone that's on duty (it's also on the home screen in night mode), so the other phone stays quiet.

If they arrive late on a Samsung phone: **Settings** › **Battery** › **Background usage limits**, and make sure Chrome isn't under **Sleeping apps** or **Deep sleeping apps**.

**What the sender can see:** which family, which phones to tell, and when. The text of every notification is encrypted by the phone that sends it with your family's key, and only opened on the phone that receives it.

## 16. Optional: Firebase's own daily backup, and delete protection

Both need the Blaze plan from step 15, and cost fractions of a cent at your size.

1. **Daily backup:** <https://console.cloud.google.com/firestore/databases> › your database › **Disaster recovery** (or **Backups**) › **Create backup schedule** › **Daily**, keep for **14 days** (2 weeks). This is a copy of the whole database, still encrypted, that Google keeps for you in case something ever went badly wrong.
2. **Delete protection** stops the whole database being deleted by accident, or by someone who gets into your console. In Cloud Shell (step 15e), paste:
   ```
   gcloud firestore databases update --database='(default)' --delete-protection --project YOUR_PROJECT_ID
   ```

## 17. Optional: Google Calendar that updates by itself

Without this, every appointment in the app has an **Add to Google Calendar** button: one tap fills in a new event. With it, one of you connects once, and every appointment goes into its own calendar in your Google account, and moves or disappears when you change or cancel it in the app, from either phone. About 15 minutes. It needs the notification sender (step 15) running on Cloudflare.

**17a. Turn on the Google Calendar API**

1. Open <https://console.cloud.google.com/apis/library/calendar-json.googleapis.com> and pick your Firebase project at the top.
2. Tap **Enable**.

**17b. The sign-in screen Google shows (Google Auth Platform)**

1. Open <https://console.cloud.google.com/auth/overview>. If it says **Get started**, fill it in: app name **Bub Feed Log**, your Gmail as the support and contact email, audience **External**. If it already shows a name (Firebase sign-in may have set it up), keep it.
2. **Audience** › under Publishing status, tap **Publish app** so it says **In production**. In Testing, Google ends the connection every 7 days.
3. **Data access** › **Add or remove scopes** › in the filter, type `calendar.app.created` › tick **…/auth/calendar.app.created** › **Update** › **Save**. This lets the app make one calendar and change only that calendar. It can't see your other calendars.

You don't need Google to verify the app. Until it does, Google shows a warning when you connect, and up to 100 people can connect. That's plenty for family and friends.

**17c. A sign-in client for the sender**

1. **Clients** › **Create client** › Application type **Web application** › name it **Bub Feed Log calendar**.
2. Under **Authorised redirect URIs**, tap **Add URI** and enter your sender's address followed by `/cal/back`. It's the `pushSender` address in `config.js`, for example `https://bub-feed-log-sender.yourname.workers.dev/cal/back`.
3. **Create**. Copy the **Client ID** and the **Client secret** now. The secret is shown once.

The client secret is a password. Never put it in `config.js` or anything on GitHub. It only goes into Cloudflare, next.

**17d. Give them to the sender (Cloudflare)**

1. Cloudflare dashboard › **Workers & Pages** › **bub-feed-log-sender** › **Settings** › **Variables and Secrets**.
2. **Add** › type **Secret** › name `GOOGLE_OAUTH_ID` › paste the Client ID.
3. **Add** › type **Secret** › name `GOOGLE_OAUTH_SECRET` › paste the Client secret.
4. **Deploy**.
5. Open your sender's address with `/health` on the end. It should finish with **Google Calendar is set up.**

**17e. Connect, then share it**

1. In the app: **Settings** › **Appointments** › **Connect Google Calendar**.
2. Sign in with the Google account the calendar should live in. Google says it hasn't verified the app: tap **Advanced**, then **Go to Bub Feed Log**. Tick the calendar permission and tap **Continue**.
3. You're brought back to the app, and it says Google Calendar is connected. Everything already booked goes in within a few seconds.
4. To see it on your partner's phone too, share it. On a computer, open <https://calendar.google.com> › **Settings** (gear) › under **Settings for my calendars**, pick the calendar named after your baby › **Share with specific people or groups** › **Add people** › their email › **Make changes to events** › **Send**.

**What the sender can see:** an appointment's title, time, place and notes, on their way to Google Calendar, where they're readable anyway. The rest of your log stays encrypted. The sender keeps the calendar's sign-in sealed with a key made from its own secrets, and only acts for people who are in your log (it checks each person's Firebase sign-in). Changes go one way, from the app to the calendar. To stop it, use **Disconnect** in Settings › Appointments, or remove Bub Feed Log at <https://myaccount.google.com/connections>.

---

## How the encryption works

- Each family has its own key. It's made on the first phone, and never leaves the family's phones unscrambled.
- Every entry, the baby's details, each person's home screen, the timers and the weigh-ins are locked with that key before they're saved. The database sees only which family a document belongs to, roughly which day an entry is from (so phones can load the last 8 days), and how big it is.
- Each phone gets its own copy of the key, locked so only that phone can open it. The phone's own private key can't be copied out of the phone, even by the app.
- **Removing a person, removing a phone, or switching the babysitter link off** changes the family key straight away. The removed phone keeps what it already had, but can't read anything new.
- **Backup files** (saved, Drive, and the weekly cloud copies) are encrypted too. On a phone that's already in the log they restore straight away; anywhere else they need the recovery code.

## New phones, lost phones and the recovery code

- **A new phone** (or after signing out): sign in, then tap **Ask a phone that has the log**. The new phone shows a 12-digit code. Another phone in the log shows **Phone waiting** at the top of its home screen, with the same code. Check they match and tap **Allow**.
- **No other phone to hand:** tap **Use the recovery code** and type it in.
- **Lost a phone:** on another phone, **Settings** › **People and sharing** › **Phones that can open the log** › **Remove**. That phone can't read anything new.
- **Lost the recovery code:** **Settings** › **Account** › **Make a new recovery code**. The old one stops working.
- **Lost every phone and the code:** the log can't be opened by anyone, including you. That's the price of nobody else being able to read it. Keep the code somewhere safe.

## Sharing the app with friends

This copy of the app is private. Nobody can sign up without a one-time code from you, and each family's log is separate and encrypted.

**To let a friend start a log:**

1. In the app: **Settings** › **People and sharing** › **Let someone in** (only you see this).
2. Pick how long the code works: **1 hour**, **6 hours** or **24 hours**. The app makes a code like `koala-river-maple-58`.
3. Tap **Share** (or **Copy message**) and send it. The message has a link with the code in it.
4. They open the link and sign in with Google. The code is used up at that moment. They tap **Start a new log**, save their own recovery code, then invite their own partner (who joins with that invite, no code needed).

**Who can use this app** (same page) lists everyone who has got in, with their name, Google email and how they got in, plus any codes not used yet (with **Cancel**). **Remove** cuts someone off on their next tap, from every log they're in; **Let back in** undoes it. To take someone out of *your own* log, use **Your family** at the top of the page instead.

**Things to know before you share:**

- **Privacy:** their logs are encrypted with their own key. In the Firebase console you'd see that a family exists, its members' account IDs, and how many entries it has, but not names, times or anything they logged.
- **Feedback:** **Settings** › **Help and about** › **Send feedback** goes to your inbox at **Settings** › **Feedback from friends**. Only you can read it. Feedback isn't encrypted, so the form asks people not to include anything private.
- **Free-plan room:** a family uses roughly 1,000 to 3,000 reads a day (yours was about 1,200 in its first days). The free amount is 50,000 a day, shared by everyone. Firebase's **Usage** tab (in Firestore) shows how close you are. On the free plan, reaching the limit pauses syncing until the next day with no charge. Notifications add about 1,500 reads a day in total, not per family.
- **Removing a family:** they can delete their own log any time (**Settings** › **Account** › **Delete this log**). To stop a family using the app, **Remove** each of its members.
- **One account, one log:** a Google account belongs to one log at a time. To move to another, leave first (**Settings** › **Account** › **Leave this log**).

## Backups: what happens automatically

| Where | When | What |
|---|---|---|
| On each phone | Once a day, when the app is opened | Every entry. The last 14 days of copies are kept on the phone. |
| In your Firebase database | Once a week, per family | Every entry, encrypted. The newest 6 weekly copies are kept. |
| Google Drive (optional) | When you tap Back up | Every entry, as an encrypted file in a "Bub Feed Log backups" folder. |
| A file | When you tap Settings › Backups and export › Save a file | Every entry, encrypted, saved to your Downloads. |

**Restoring** (Settings › Backups and export) only adds back entries that are missing. It never deletes or changes anything. **Delete all entries** always makes a phone and Firebase backup first.

## Will the free plan be enough?

For your family, easily. Firebase's free plan allows 50,000 reads and 20,000 writes a day and 1 GiB of storage.

- Logging uses about one write per tap. A busy day is under 100.
- Each phone only keeps the last 8 days live, so opening the app costs about 150–200 reads at most. The first search of the day in History fetches the 60 days before that (about 1,000 reads for a busy baby); later searches that day read the phone's own copy. Even opened all day on two phones, that's well under 10,000 reads.
- On the Blaze plan (step 15) the same free amounts apply every day; you'd only pay for use above them.
- Full backups read the whole history once a week per phone, plus once for the Firebase copy. After a year of heavy logging, about 7,000 entries, that's still well under the daily limit.
- A year of entries is about 3 MB of storage (encryption adds a little).

With friends on it too, see "Free-plan room" above.

## Babysitter or grandparent access

**Settings** › **People and sharing** › switch on **Babysitter or helper**:

- **Their name** shows next to what they log (for example "Nana").
- **Can log** or **View only**.
- **Stops working:** tomorrow 6am, 1 week, 1 month, 2 months, a date you pick, or no end. The database stops the link at that time, and the first parent's phone to notice switches it off and changes the family key.
- **Reminders on their phone:** lets them turn on feed-due reminders (step 15) while they're helping.

Then **Send link**. It opens the app with no account. **The link works on the first phone that opens it**; a forwarded copy won't work anywhere else. Send it privately. Switching it off, **Make a new link**, or reaching the end date stops it straight away and clears the app's copy of your log from their phone.

## Updating the app

1. Upload the new `index.html`, `sw.js` and `version.json` to GitHub (keep your own `config.js`). If the update says the rules changed, also paste the new `firestore.rules` into Firestore › **Rules** (with your email, as in step 5) and **Publish**.
2. Within a few hours, each phone shows **A new version is ready** on the home screen. One tap updates it. **Settings** › **Help and about** › **Check for updates** does it straight away.
3. **What's new** in the same place lists the changes. Updates never move anyone's buttons or change their home screen; anything new starts switched off.

## Moving to Firebase Hosting later

Nothing is lost: the data lives in Firestore, not on GitHub. Deploy the same files with Firebase Hosting, add the new address to **Authorized domains** (step 7), the reCAPTCHA key's domains (step 8) and the key restrictions (step 9). Each phone opens the new address and signs in once; because phones keep their keys per address, each new phone is approved once with the 12-digit code or the recovery code.

## If something goes wrong

| What you see | What to do |
|---|---|
| **This is a private app** for you, the host | Tap **Already in a log? Sign in**. If it still asks for a code after signing in, step 5 isn't finished: your email isn't in the rules, or isn't in lower case, or the rules weren't published. |
| **That code didn't work** (a friend) | Codes work once and expire. Make a new one in Settings › People and sharing › Let someone in. |
| **Access turned off** | You (the host) removed that account under **Who can use this app**. Tap **Let back in** if it was a mistake. |
| **Link not working** (babysitter) | The link ended, was switched off or replaced, or was already opened on another phone. Send a new link. |
| Notifications never arrive | Check **Settings** › **Notifications** is on and the phone allowed them; tap **Send a test**. In Firebase › Functions, check the four functions are there and look at **Logs**. On Samsung, check Chrome isn't a sleeping app. |
| **Notifications aren't set up for this copy of the app yet** | `pushKey` in `config.js` is empty (step 15c). |
| **That code wasn't found / has expired** (joining) | Make a new invite in Settings › People and sharing and send it again. |
| **Unlock the log on this phone** | Normal on a new phone or after signing out. Ask another phone (it shows **Phone waiting**), or use the recovery code. |
| **That recovery code didn't work** | Check for typos (letters and numbers only; dashes and spaces don't matter). If someone made a new code, the old one stops working. |
| **You're no longer part of that log** | Someone removed this account or this phone, or the log was deleted. Ask to be invited again. |
| **Firebase isn't ready** | The database doesn't exist yet (step 4), or a value in `config.js` has a typo. |
| "This web address isn't allowed yet" | Do step 7. |
| Sign-in window flashes and closes | Allow pop-ups for the site in Chrome, then try again. If you did step 9, check the `firebaseapp.com` address is in the key's website list. |
| Pill at the top says **Sync problem** right after step 8 or 9 | App Check or the key restriction is blocking the app. Turn **Enforce** off in App Check, or recheck the domains, then reopen the app. |
| Pill at the top says **Sync problem** | Usually signed out or rules changed. Settings › Account › Sign out, then sign in again. |
| Changes on GitHub don't show | Wait a minute, then reopen the app. It checks for a new version when it opens, and **Settings** › **Help and about** › **Check for updates** checks straight away. |
| You still see "Saved on this phone" and no sign-in | `config.js` still has `PASTE_` values. The app is in demo mode. |

## What protects the data

| Layer | What it stops |
|---|---|
| Encryption on the phones | Anyone reading a family's log from the database: you, Google, or someone who breaks in. |
| Phone approval with a 12-digit code | A stolen Google sign-in opening the log on a new phone without someone in the family noticing. |
| Key changes on removal | A removed person or lost phone reading anything new. |
| Firestore rules (step 5) | Anyone outside a family reading or changing even its scrambled data, and malformed or oversized writes. |
| One-time codes and the approved list | Strangers who find the link getting past sign-in. The database refuses any account you haven't let in, and you can turn anyone off. |
| Invites that work once, within 24 hours | A forwarded or leaked invite being used to join your log later. |
| Babysitter link: one phone, end date | A forwarded link working on another phone, or a link working longer than you meant. |
| Notification text sealed by the phones | The notification sender (or Google) reading what a notification says. |
| Budget alerts, spend cap, emergency brake (step 15) | A surprise bill on the pay-as-you-go plan. |
| App Check (step 8) | Scripts and bots using your Firebase settings from anywhere but your app. |
| Key restrictions (step 9) | Your public `apiKey` being used from other websites or for other Google services. |
| Content Security Policy (built into `index.html`) | Injected code running in the app, or the app sending data anywhere but Firebase and Google sign-in. |
| 2-Step Verification (step 10) | Someone taking over the host account and the Firebase console. |
