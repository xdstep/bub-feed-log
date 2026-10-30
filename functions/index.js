// Bub Feed Log: the notification sender (Firebase Cloud Functions, Blaze plan).
//
// What it can see: which family, which phones to tell, when, and sealed text it can't read. The
// phones seal every notification with the family's own key; the phone that receives it opens it.
//
// It never writes anything that would set itself off again: the sender only deletes the request
// it was given, the reminder timer only moves a reminder's time, and nothing writes to notify/.
const { onDocumentCreated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');

// Must match your Firestore location (Firestore > Settings). The setup guide's command fills it in.
const REGION = 'australia-southeast1';

admin.initializeApp();
setGlobalOptions({ region: REGION, maxInstances: 3, memory: '256MiB', timeoutSeconds: 60 });
const db = admin.firestore();

const FAR = 9e15; // a reminder that has been sent waits here until a phone sets a new time
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const FID = /^[A-Za-z0-9_-]{20}$/;
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || '';
const FN_BASE = PROJECT ? `https://${REGION}-${PROJECT}.cloudfunctions.net` : '';

// Send one data message to each of the family's phones named in `to`; forget phones that are gone.
async function sendTo(fid, to, data, deps) {
  const d = deps || { db, messaging: admin.messaging() };
  if (!FID.test(String(fid || ''))) return 0;
  const ids = [...new Set((Array.isArray(to) ? to : []).filter(x => typeof x === 'string' && ID.test(x)))].slice(0, 12);
  if (!ids.length) return 0;
  const snaps = await d.db.getAll(...ids.map(id => d.db.doc(`families/${fid}/push/${id}`)));
  const targets = snaps.filter(s => s.exists && typeof s.get('token') === 'string' && s.get('token'));
  if (!targets.length) return 0;
  const strData = {};
  Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null) strData[k] = String(v); });
  const res = await d.messaging.sendEach(targets.map(s => ({ token: s.get('token'), data: strData, webpush: { headers: { Urgency: 'high', TTL: '1800' } } })));
  const now = Date.now();
  await Promise.all(res.responses.map((r, i) => {
    const ref = targets[i].ref;
    if (r.success) return ref.update({ last: now }).catch(() => {});
    const code = (r.error && r.error.code) || '';
    if (/registration-token-not-registered|invalid-registration-token|invalid-argument/.test(code)) return ref.delete().catch(() => {});
    console.warn('Not delivered', code);
    return null;
  }));
  return res.successCount;
}

// Someone logged something: tell the phones the logging phone named, then delete the request.
async function handleNotify(nid, d, deps) {
  if (!d || typeof d.fid !== 'string' || !Array.isArray(d.to) || !d.box) return 0;
  if (Date.now() - (+d.at || 0) > 15 * 60000) return 0; // logged offline a while ago: too late to be useful
  return sendTo(d.fid, d.to, { kind: 'log', fid: d.fid, nid, box: JSON.stringify(d.box), tag: String(d.tag || 'log').slice(0, 40) }, deps);
}
exports.notifyOnLog = onDocumentCreated('notify/{nid}', async event => {
  const snap = event.data;
  if (!snap) return;
  try { await handleNotify(event.params.nid, snap.data()); }
  catch (e) { console.error('Notify failed', e); }
  finally { await snap.ref.delete().catch(() => {}); }
});

// Every minute: send the reminders that are due. Each one is claimed first (its time moves far
// ahead), so two runs can never send it twice.
async function runReminders(now, deps) {
  const d = deps || { db, messaging: admin.messaging() };
  const due = await d.db.collection('remind').where('at', '<=', now).limit(50).get();
  let sent = 0;
  for (const doc of due.docs) {
    const claimed = await d.db.runTransaction(async tx => {
      const s = await tx.get(doc.ref);
      if (!s.exists || !(s.get('at') <= now)) return null;
      const data = s.data();
      tx.update(doc.ref, { at: FAR });
      return data;
    });
    if (!claimed) continue;
    if (now - claimed.at > 6 * 3600000) continue; // far too late (the sender was down): skip it
    const rid = doc.id;
    const fid = rid.slice(0, 20); // family ids are 20 characters (and may contain _ themselves)
    if (rid.charAt(20) !== '_' || fid !== claimed.fid) continue;
    sent += await sendTo(fid, claimed.to, { kind: 'remind', fid, rid, box: JSON.stringify(claimed.box), tag: String(claimed.tag || 'remind').slice(0, 40), snz: claimed.snz || '', fn: FN_BASE }, d).catch(e => { console.error('Reminder failed', rid, e); return 0; });
  }
  // twice an hour: tidy requests a failed send left behind
  if (new Date(now).getUTCMinutes() % 30 === 0) {
    const old = await d.db.collection('notify').where('at', '<', now - 3600000).limit(100).get();
    await Promise.all(old.docs.map(x => x.ref.delete().catch(() => {})));
  }
  return sent;
}
exports.sendReminders = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Etc/UTC', retryCount: 0 }, async () => {
  await runReminders(Date.now());
});

// Snooze, from the notification's button: needs the reminder's own secret, which only the
// family's phones have. Moves it 15 minutes (5 to 60) later.
async function handleSnooze(q, deps) {
  const d = deps || { db };
  const rid = String(q.r || ''), t = String(q.t || ''), mins = Math.min(60, Math.max(5, Math.round(+q.m || 15)));
  if (!/^[A-Za-z0-9_-]{20}_[a-z0-9-]{1,40}$/.test(rid) || t.length < 16 || t.length > 64) return 400;
  const ref = d.db.doc(`remind/${rid}`);
  const ok = await d.db.runTransaction(async tx => {
    const s = await tx.get(ref);
    if (!s.exists || s.get('snz') !== t) return false;
    tx.update(ref, { at: Date.now() + mins * 60000 });
    return true;
  });
  return ok ? 200 : 404;
}
exports.snooze = onRequest({ cors: true, invoker: 'public', maxInstances: 2 }, async (req, res) => {
  try { const code = await handleSnooze(req.query || {}); res.status(code).send(code === 200 ? 'ok' : 'no'); }
  catch (e) { console.error('Snooze failed', e); res.status(500).send('error'); }
});

// The emergency brake (optional): when your budget says spending has passed the amount you set,
// lock the database so nothing more can be read or written. Nothing is deleted. To unlock, paste
// firestore.rules back into Firebase > Firestore > Rules and press Publish.
const LOCKED_RULES = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Locked by the budget brake: spending passed your budget. Nothing was deleted.
    // To unlock, paste firestore.rules back in here and press Publish.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
`;
function overBudget(msg) {
  const cost = +(msg && msg.costAmount) || 0, budget = +(msg && msg.budgetAmount) || 0;
  return budget > 0 && cost >= budget;
}
exports.budgetBrake = onMessagePublished({ topic: 'budget-alerts' }, async event => {
  const m = (event.data && event.data.message && event.data.message.json) || {};
  if (!overBudget(m)) return;
  await admin.securityRules().releaseFirestoreRulesetFromSource(LOCKED_RULES);
  console.warn(`Budget brake: spending ${m.costAmount} passed the budget ${m.budgetAmount}. The database is locked.`);
});

// for the tests (never exported when deployed)
if (process.env.BUB_TEST) exports._test = { sendTo, handleNotify, runReminders, handleSnooze, overBudget, LOCKED_RULES, FAR };
