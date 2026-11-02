// Bub Feed Log: the notification sender, running on Cloudflare Workers (free plan).
//
// It does the job the Google Cloud functions did: sends the notifications the phones ask for, sends
// reminders when they're due (it checks every minute), and handles the Snooze button. What a
// notification says is sealed on the phones with the family's own key, so the sender can't read it.
//
// It needs one secret, GOOGLE_KEY: a Google service account key that may only use the database and
// send notifications (the setup guide makes it). Your logs stay encrypted, so the key can't read them.
//
// It never writes anything that would make it send again: it deletes each notification request as it
// takes it, moves a reminder's time far ahead as it takes it, and only ever writes `last` on a phone.

const FAR = 9e15;               // a sent reminder waits here until a phone sets a new time
const ID = /^[A-Za-z0-9_-]{8,40}$/;
const FID = /^[A-Za-z0-9_-]{20}$/;
const RID = /^[A-Za-z0-9_-]{20}_[a-z0-9-]{1,40}$/;
const LOG_WINDOW = 15 * 60000;  // a log notification more than 15 minutes old is too late to be useful
const REMIND_LATE = 60 * 60000; // a reminder more than an hour late is skipped
const BUDGET = 45;              // Cloudflare's free plan allows 50 outside calls per run; keep a margin

// ---------- each run counts its outside calls ----------
function run() {
  const c = { left: BUDGET };
  c.fetch = (url, opts) => { c.left--; return fetch(url, opts); };
  return c;
}

// ---------- the Google key and sign-in ----------
function readKey(env) {
  const raw = env ? env.GOOGLE_KEY : undefined;
  if (raw === undefined || raw === null || raw === '') throw new Error('the GOOGLE_KEY secret is missing');
  let k = null;
  if (typeof raw === 'object') k = raw; // added as Cloudflare's "JSON" type
  else {
    // pasted as text: allow stray spaces or quotes around it
    const t = String(raw).trim();
    const tryParse = x => { try { return JSON.parse(x); } catch (e) { return null; } };
    k = tryParse(t);
    if (typeof k === 'string') k = tryParse(k); // the key written out as one quoted string
    if (!k && /^(['"`]).*\1$/s.test(t)) k = tryParse(t.slice(1, -1).trim()); // quotes pasted around it
  }
  if (!k || typeof k !== 'object') throw new Error('GOOGLE_KEY is there but isn’t the key text (it should start with {"type":"service_account")');
  if (!k.client_email || !k.private_key || !k.project_id) throw new Error('GOOGLE_KEY is missing part of the key');
  return k;
}
const b64url = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const b64urlText = t => b64url(new TextEncoder().encode(t));
function pemToDer(pem) {
  const bin = atob(String(pem).replace(/-----[^-]+-----/g, '').replace(/\\n/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
let saved = null; // { token, exp, email } kept between runs while Cloudflare keeps this copy warm
async function googleToken(env, c) {
  const k = readKey(env);
  const now = Math.floor(Date.now() / 1000);
  if (saved && saved.email === k.client_email && saved.exp - 120 > now) return saved.token;
  const head = b64urlText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64urlText(JSON.stringify({
    iss: k.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  let key;
  try { key = await crypto.subtle.importKey('pkcs8', pemToDer(k.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']); }
  catch (e) { throw new Error('the private key in GOOGLE_KEY couldn’t be read'); }
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head + '.' + claims));
  const res = await c.fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claims + '.' + b64url(sig)
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error('Google sign-in failed (' + (j.error_description || j.error || res.status) + ')');
  saved = { token: j.access_token, exp: now + (+j.expires_in || 3600), email: k.client_email };
  return saved.token;
}

// ---------- the database (Firestore, through its web address) ----------
function val(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(val);
  if ('mapValue' in v) return fieldsOf((v.mapValue && v.mapValue.fields) || {});
  return null;
}
function fieldsOf(f) { const o = {}; for (const [k, v] of Object.entries(f || {})) o[k] = val(v); return o; }
const num = n => ({ integerValue: String(Math.floor(n)) });
const lastPart = name => String(name).split('/').pop();

function db(env, c) {
  const k = readKey(env);
  const root = `projects/${k.project_id}/databases/(default)/documents`;
  const base = 'https://firestore.googleapis.com/v1/' + root;
  const call = async (method, url, body) => {
    const t = await googleToken(env, c);
    const res = await c.fetch(url, { method, headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, j };
  };
  const fail = (what, r) => new Error(`database ${what} refused (${r.status}${r.j && r.j.error && r.j.error.status ? ' ' + r.j.error.status : ''})`);
  return {
    project: k.project_id,
    name: path => root + '/' + path,
    async get(path) {
      const r = await call('GET', base + '/' + path);
      if (r.status === 404) return null;
      if (!r.ok) throw fail('read', r);
      return r.j;
    },
    async query(collection, where, limit) {
      const q = { from: [{ collectionId: collection }], limit };
      if (where) q.where = where;
      const r = await call('POST', base + ':runQuery', { structuredQuery: q });
      if (!r.ok) throw fail('search', r);
      return (Array.isArray(r.j) ? r.j : []).filter(x => x && x.document).map(x => x.document);
    },
    async getMany(names) {
      const r = await call('POST', base + ':batchGet', { documents: names });
      if (!r.ok) throw fail('read', r);
      const found = {};
      (Array.isArray(r.j) ? r.j : []).forEach(x => { if (x && x.found) found[x.found.name] = x.found; });
      return names.map(n => found[n] || null);
    },
    // all or nothing: used to take a request or reminder, so two runs can never both send it
    commit: writes => call('POST', base + ':commit', { writes }),
    // each write on its own: used for tidying, where one failing shouldn't stop the rest
    writeEach: writes => call('POST', base + ':batchWrite', { writes })
  };
}
const field = (path, op, value) => ({ fieldFilter: { field: { fieldPath: path }, op, value } });

// ---------- sending ----------
// Remove a phone only when Google says its notification address is gone, never for other errors
// (a bad message or a setup problem mustn't silently stop notifications to a phone).
function phoneGone(status, j) {
  const e = (j && j.error) || {};
  const codes = (Array.isArray(e.details) ? e.details : []).map(d => d && d.errorCode).filter(Boolean);
  if (codes.includes('UNREGISTERED')) return true;
  return status === 400 && (codes.includes('INVALID_ARGUMENT') || e.status === 'INVALID_ARGUMENT') && /registration token/i.test(e.message || '');
}

async function sendTo(env, c, d, fid, to, data) {
  if (!FID.test(String(fid || ''))) return 0;
  const ids = [...new Set((Array.isArray(to) ? to : []).filter(x => typeof x === 'string' && ID.test(x)))].slice(0, 12);
  if (!ids.length) return 0;
  const docs = await d.getMany(ids.map(id => d.name(`families/${fid}/push/${id}`)));
  const targets = docs.filter(x => x && x.fields && x.fields.token && x.fields.token.stringValue).map(x => ({ name: x.name, token: x.fields.token.stringValue }));
  if (!targets.length) return 0;
  const strData = {};
  Object.entries(data).forEach(([k, v]) => { if (v !== undefined && v !== null) strData[k] = String(v); });
  const t = await googleToken(env, c);
  const now = Date.now(), writes = [];
  let sent = 0;
  for (const tg of targets) {
    const res = await c.fetch(`https://fcm.googleapis.com/v1/projects/${d.project}/messages:send`, {
      method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { token: tg.token, data: strData, webpush: { headers: { Urgency: 'high', TTL: '1800' } } } })
    });
    if (res.ok) { sent++; writes.push({ update: { name: tg.name, fields: { last: num(now) } }, updateMask: { fieldPaths: ['last'] }, currentDocument: { exists: true } }); continue; }
    const j = await res.json().catch(() => ({}));
    if (phoneGone(res.status, j)) writes.push({ delete: tg.name, currentDocument: { exists: true } });
    else console.warn('Not delivered', res.status, (j.error && j.error.status) || '');
  }
  if (writes.length) await d.writeEach(writes);
  return sent;
}

// A request someone's phone left in notify/: take it (by deleting it), then send it.
async function sendRequest(env, c, d, doc) {
  const took = await d.commit([{ delete: doc.name, currentDocument: { exists: true } }]);
  if (!took.ok) return 0; // another run already took it
  const n = fieldsOf(doc.fields);
  if (typeof n.fid !== 'string' || !Array.isArray(n.to) || !n.box) return 0;
  if (Date.now() - (+n.at || 0) > LOG_WINDOW) return 0;
  return sendTo(env, c, d, n.fid, n.to, { kind: 'log', fid: n.fid, nid: lastPart(doc.name), box: JSON.stringify(n.box), tag: String(n.tag || 'log').slice(0, 40) });
}

// The app pokes this right after it saves a request, so it goes out straight away.
async function poke(env, nid) {
  const c = run(), d = db(env, c);
  const doc = await d.get('notify/' + nid);
  return doc ? sendRequest(env, c, d, doc) : 0;
}

// Every minute: reminders that are due, then any request a poke missed (a phone that was offline).
async function remindersDue(env, c, d, now) {
  const due = await d.query('remind', field('at', 'LESS_THAN_OR_EQUAL', num(now)), 10);
  let sent = 0;
  for (const doc of due) {
    if (c.left < 15) break; // the rest wait for next minute
    const r = fieldsOf(doc.fields);
    if (!(r.at <= now)) continue;
    const took = await d.commit([{ update: { name: doc.name, fields: { at: num(FAR) } }, updateMask: { fieldPaths: ['at'] }, currentDocument: { updateTime: doc.updateTime } }]);
    if (!took.ok) continue; // a phone changed it, or another run took it
    if (now - r.at > REMIND_LATE) continue;
    const rid = lastPart(doc.name), fid = rid.slice(0, 20); // family ids are 20 characters
    if (!RID.test(rid) || fid !== r.fid) continue;
    sent += await sendTo(env, c, d, fid, r.to, { kind: 'remind', fid, rid, box: JSON.stringify(r.box), tag: String(r.tag || 'remind').slice(0, 40), snz: r.snz || '', fn: (env && env.SENDER_URL) || '' })
      .catch(e => { console.error('Reminder failed', rid, e.message); return 0; });
  }
  return sent;
}
async function requestsWaiting(env, c, d, now) {
  if (c.left < 15) return 0;
  const waiting = await d.query('notify', field('at', 'GREATER_THAN_OR_EQUAL', num(now - LOG_WINDOW)), 5);
  let sent = 0;
  for (const doc of waiting) {
    if (c.left < 15) break;
    sent += await sendRequest(env, c, d, doc).catch(e => { console.error('Notify failed', e.message); return 0; });
  }
  return sent;
}
// twice an hour: clear requests too old to send
async function tidy(c, d, now) {
  const old = await d.query('notify', field('at', 'LESS_THAN', num(now - 3600000)), 100);
  if (old.length) await d.writeEach(old.map(x => ({ delete: x.name })));
  return old.length;
}
async function everyMinute(env, now) {
  const c = run();
  let d;
  try { d = db(env, c); } catch (e) { console.error('Not set up:', e.message); return; }
  try { await remindersDue(env, c, d, now); } catch (e) { console.error('Reminders failed', e.message); }
  try { await requestsWaiting(env, c, d, now); } catch (e) { console.error('Waiting requests failed', e.message); }
  if (new Date(now).getUTCMinutes() % 30 === 0) { try { await tidy(c, d, now); } catch (e) { console.error('Tidy failed', e.message); } }
}

// Snooze, from the notification's button: needs the reminder's own secret, which only the family's
// phones have. Moves it 15 minutes (5 to 60) later.
async function snooze(env, q) {
  const rid = String(q.get('r') || ''), t = String(q.get('t') || ''), mins = Math.min(60, Math.max(5, Math.round(+q.get('m') || 15)));
  if (!RID.test(rid) || t.length < 16 || t.length > 64) return 400;
  const c = run(), d = db(env, c);
  const doc = await d.get('remind/' + rid);
  if (!doc || fieldsOf(doc.fields).snz !== t) return 404;
  const r = await d.commit([{ update: { name: doc.name, fields: { at: num(Date.now() + mins * 60000) } }, updateMask: { fieldPaths: ['at'] }, currentDocument: { updateTime: doc.updateTime } }]);
  return r.ok ? 200 : 409;
}

// Open /health in a browser to check the setup. Shows no secrets.
async function health(env) {
  let k;
  try { k = readKey(env); } catch (e) { return 'Not ready: ' + e.message + '. In the sender’s Settings › Variables and Secrets, add or replace GOOGLE_KEY with the type set to Secret, then Deploy (guide part 4).'; }
  const c = run();
  try { await googleToken(env, c); } catch (e) { return 'Not ready: the key is there, but ' + e.message + '. Make a new key (guide step 6) and paste it again (part 4).'; }
  try { await db(env, c).query('remind', null, 1); } catch (e) { return 'Not ready: signed in, but the ' + e.message + '. Check the sender account has the Cloud Datastore User role (guide part 2).'; }
  const t = await googleToken(env, c);
  const res = await c.fetch(`https://fcm.googleapis.com/v1/projects/${k.project_id}/messages:send`, {
    method: 'POST', headers: { authorization: 'Bearer ' + t, 'content-type': 'application/json' },
    body: JSON.stringify({ validate_only: true, message: { token: 'bub-health-check', data: { kind: 'check' } } })
  });
  if (res.status === 401 || res.status === 403) return 'Not ready: the database works, but sending notifications was refused. Check the sender account has the Firebase Cloud Messaging API Admin role (guide part 2).';
  return 'Ready. The sender can use your database and send notifications for ' + k.project_id + '.';
}

const HEADERS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' };
const reply = (status, text) => new Response(text, { status, headers: HEADERS });

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...HEADERS, 'access-control-allow-methods': 'GET, POST', 'access-control-max-age': '86400' } });
      if (url.pathname === '/poke') {
        if (request.method !== 'POST') return reply(405, 'no');
        const n = url.searchParams.get('n') || '';
        if (!ID.test(n)) return reply(400, 'no');
        ctx.waitUntil(poke(env, n).catch(e => console.error('Poke failed', e.message)));
        return reply(202, 'ok');
      }
      if (url.pathname === '/snooze') { const code = await snooze(env, url.searchParams); return reply(code, code === 200 ? 'ok' : 'no'); }
      if (url.pathname === '/health') return reply(200, await health(env));
      return reply(200, 'Bub Feed Log notification sender. Open /health to check the setup.');
    } catch (e) {
      console.error('Failed', e && e.message);
      return reply(500, 'error');
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(everyMinute(env, (event && event.scheduledTime) || Date.now()));
  }
};

// for the tests
export const _test = { phoneGone, fieldsOf, readKey, pemToDer, resetToken: () => { saved = null; }, BUDGET };
