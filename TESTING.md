# How Bub Feed Log was tested

Tested on 27 October 2026, in Chromium at phone sizes (360, 390 and 412 px wide), Melbourne time zone, against the built `index.html` with its Content Security Policy switched on. Firebase couldn't be reached from the test machine, so the sync tests used a stand-in that behaves like Firebase: real-time updates between phones, offline queueing, a local copy, and a line-by-line model of `firestore.rules`. Every test runs with families locked away from each other and every document encrypted. The real Firebase, including the rules and App Check, gets its first run in the setup checklist (SETUP.md step 14).

## Results

| Suite | Checks | Result |
|---|---|---|
| Every option ×10 through the screen, plus a random walk over several simulated days | 3,050 | all passed |
| Encryption and security: what the database can see, tampering, new phones, recovery code, removals, babysitter, backup files, feedback | 82 | all passed |
| Two phones and a babysitter syncing | 268 | all passed |
| Setup questions and screens, shortcuts, offline start, Google Drive, night mode, feed-due, every screen at 3 widths × 3 text sizes × day/dark/night | 513 | all passed |
| Many families: invites, the host code, keeping families apart, removing, leaving, deleting | 118 | all passed |
| A real day on two phones, checked by reading the screens (below) | 59 | all passed |
| Colours: every palette, light and dark, by day and at night, switched 10 times, measured on screen | 217 | all passed |
| Week card and keepsake: Share, or Copy where Share isn't available | 102 | all passed |
| Tap on the save banner reaches the button underneath | 10 | all passed |
| Speed with long histories | 3 sizes | see below |

**Entries created by tapping:** 1,150, every one checked for type, amount, time and who logged it.

## Encryption and security

- **What the database holds:** after a family logs feeds, nappies, medicines, temperatures, weigh-ins and notes, every document in the stand-in database was searched for the baby's name, parents' names, medicine names, amounts and note text. None appear anywhere: only scrambled text, key numbers and day numbers.
- **Tampering, straight at the database:** a stranger can't read a family, list its entries, read its recovery key, add themselves without an invite, or list invites. A member can't write an unencrypted entry, add readable fields to the family, turn the key version back, write someone else's layout, read another phone's key, register a phone for someone else, or swap a phone's key. Strangers can't send feedback; only the host can read it.
- **A new phone:** it asks for the key and shows a 12-digit code; the other phone shows the same code; once allowed, the new phone opens the log.
- **Recovery code:** a wrong code is refused; the right one opens the log on a phone with nothing else.
- **Removing a phone:** the key changes, the phone's key and record are deleted, the phone is told and locked out, and the others carry on with the new key.
- **Babysitter link:** opens without an account; replacing it or switching it off stops the old link and changes the key.
- **Removing a person:** the key changes, their phone is told and can't read the family any more.
- **Backup files:** encrypted; a wrong code doesn't open one; the right code restores it into a new log; on a phone that's already in the log it restores straight away.
- **Feedback:** someone in a log sends feedback from Help and about; it arrives in the host's inbox, and nobody else sees one.

## What "every option ×10" covered

- Every home button, including timers started and stopped after simulated time.
- The + menu: one-tap Wet, Dirty and Both, every other type, and the Running low row.
- Bottle, nappy (every size, texture and colour), vomit, pump, medicine, bath, note, sleep and unsettled, with every "When" choice and refusing silly amounts.
- Breastfeeding: sides, pauses, "started earlier", discard, "Still feeding?", and typing in a past feed.
- Type or say: 20 phrases ×10, including multi-entry sentences, names, nappy details and the sleep timer.
- Edit every type of entry, Undo, refuse a future time, delete with two taps, Undo the delete.
- History: the fold-away filter with random mixes of types, people, date ranges and search, counts checked against an independent count; keeping, applying and removing filters; picked dates; copying filtered entries; tapping a bar in Insights to open that day.
- Edit home screen: switching sections on and off, moving sections and buttons by tap-to-move and by dragging, adding from the picker, swapping when all 6 are used, the 4 layouts, reset with Undo.
- Insights: every card on and off, the MCH summary and copying it, the week card and keepsake.
- Settings: every page; 5 palettes × light/dark/match phone, 3 text sizes, night mode, calm, feed-due limits (1–6 h), milk, pumping, baby name and birthday, switching person, medicines with their gaps, the To buy list, babysitter link.
- Export, backup file save → delete everything → restore, restore again (adds nothing), phone backup restore, refusing broken files, reload keeps everything.

## A real day on two phones

Two parents' phones (plus a grandparent's babysitter link and a replacement phone), a week of earlier logs, and the clock moving through a day. Every check reads what's on the screen, and the screenshots were looked at by eye.

- **2:55am:** one parent feeds in night colours; the other glances at their phone and sees "Feeding · Left side · started by …", then the switch. Both phones say which side next and when the next feed is due. A nappy on one phone shows on the other.
- **5:40am:** a feed typed half asleep: "fed left 10 right 6 at 5.40".
- **7:30am:** "Since you last looked" says who logged what overnight; day colours are back.
- **During the day:** feed due, a formula bottle (Insights counts it), pumping, "Same as last", seven sentences typed the way people write them, an accidental tap undone, and a bottle moved 25 minutes earlier.
- **Afternoon:** medicine checked before giving it; nappies marked running low show on the other phone.
- **Date night:** the babysitter link opens straight onto Home and logs show as Babysitter.
- **No signal:** logging in a car park, then catching up.
- **A replacement phone:** it asks to be unlocked, the other parent's phone shows the same 12-digit code, and once allowed it opens with the same colours, layout and entries.
- **11pm to midnight:** a parent falls asleep with the timer running; the other sees "Still feeding?" and saves it as stopped 20 minutes ago, under the right name.
- **Next morning:** Insights shows the longest gap between feeds last night, and the spreadsheet has every entry.

## Speed

Measured on a desktop computer while another test suite was running; a mid-range phone is roughly 3–5 times slower. All times in milliseconds. Filter taps redraw the list straight away now the filters sit on the History screen.

| History | Days | Open app | Home | History | Insights | Tap a button | Filter tap | Export |
|---|---|---|---|---|---|---|---|---|
| 3,000 entries | 127 | 140 | 4 | 17 | 2 | 5 | 17 | 12 |
| 7,000 entries | 296 | 125 | 7 | 17 | 4 | 17 | 23 | 32 |
| 15,000 entries | 641 | 198 | 11 | 16 | 7 | 35 | 26 | 74 |

## Bugs found and fixed in this round

1. Deleting a log made the deleting phone, and the other phones, say "This phone was taken off the log" instead of "That log was deleted", and an error was logged half way through. Keys are now removed last, and a phone that loses its key checks whether the whole log has gone before choosing what to say.
2. The join screen said "joining Ari's log with" whoever made the invite most recently. It now lists everyone in the log.
3. In the Edit home screen picker, the "On home" label squeezed long names into one letter per line.
4. At extra-large text, "Breastfeed" in the + menu broke mid-word. Labels now keep whole words, with fewer columns at that size.
5. History's title row and the Help page's version row ran off 360 px screens at extra-large text.
6. A button near the bottom of a long home screen could sit under the tab bar after scrolling to it. The page now keeps scrolled-to items clear of the bar.
7. Two minus buttons sat side by side on each medicine (shorter gap, and remove). Remove is now a bin.
8. A leftover name from an early version was hard-coded in the app. It's gone.

## Not tested here

- The real Firebase service and its rules engine running `firestore.rules`. The stand-in follows the same rules line by line, but it's a model.
- App Check and reCAPTCHA, the API key restrictions, and loading Firebase from Google under the Content Security Policy. SETUP.md steps 8 and 9 tell you what to check and how to switch them back off.
- Google sign-in itself and the Google Drive screens (stand-ins used).
- Real phones, including iPhones installed to the home screen. Layout was checked at phone widths, and the app uses only features current Chrome and Safari support.
