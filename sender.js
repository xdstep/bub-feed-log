// Bub Feed Log: the notification sender, running on Cloudflare Workers (free plan).
//
// It does the job the Google Cloud functions did: sends the notifications the phones ask for, sends
// reminders when they're due (it checks every minute), and handles the Snooze button. What a
// notification says is sealed on the phones with the family's own key, so the sender can't read it.
//
// It needs one secret, GOOGLE_KEY: a Google service account key that may only use the database and
// send notifications (the setup guide makes it). Your logs stay encrypted, so the key can't read them.
//
// Optional (version 1.4): Google Calendar. With GOOGLE_OAUTH_ID and GOOGLE_OAUTH_SECRET (a Google
// sign-in client, setup guide step 17), a parent can connect their Google account once; the sender then makes
// one calendar in it and adds, moves or deletes appointments there when a family member's phone asks.
// It can only see and change the calendar it made. Every request carries the person's Firebase
// sign-in, checked here, and they must be in that family.
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
  const states = await d.query('calstate', field('exp', 'LESS_THAN', num(now)), 50);
  if (states.length) await d.writeEach(states.map(x => ({ delete: x.name })));
  return old.length + states.length;
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
  return 'Ready. The sender can use your database and send notifications for ' + k.project_id + '.' + (calReady(env) ? ' Google Calendar is set up.' : ' Google Calendar is not set up (optional, setup guide step 17).');
}

const HEADERS = { 'access-control-allow-origin': '*', 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' };
const reply = (status, text) => new Response(text, { status, headers: HEADERS });
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...HEADERS, 'content-type': 'application/json' } });

// ---------- Google Calendar (optional) ----------
const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
const calReady = env => !!(env && env.GOOGLE_OAUTH_ID && env.GOOGLE_OAUTH_SECRET);
const str = v => ({ stringValue: String(v) });
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha256Hex = async t => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
const b64 = buf => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));
const unb64url = s => { const t = String(s).replace(/-/g, '+').replace(/_/g, '/'); return unb64(t + '='.repeat((4 - t.length % 4) % 4)); };
const ZONE = /^[A-Za-z][A-Za-z0-9_+\-\/]{0,39}$/;

// The refresh token Google gives is sealed before it's saved, with a key made from the sender's secrets.
async function sealKey(env) {
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('bub-calendar:' + env.GOOGLE_OAUTH_SECRET + ':' + readKey(env).private_key));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
async function seal(env, text, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) }, await sealKey(env), new TextEncoder().encode(text));
  return b64(iv) + '.' + b64(c);
}
async function unseal(env, box, aad) {
  const [iv, c] = String(box || '').split('.');
  const p = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(aad) }, await sealKey(env), unb64(c));
  return new TextDecoder().decode(p);
}

// Who's asking: a Firebase sign-in token (RS256, signed by Google for this project), checked here.
let signKeys = null; // { keys: Map(kid -> key), exp }
async function firebaseKeys(c, fresh) {
  if (!fresh && signKeys && signKeys.exp > Date.now()) return signKeys.keys;
  const res = await c.fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error('sign-in keys not available (' + res.status + ')');
  const j = await res.json(), keys = new Map();
  for (const k of (j && j.keys) || []) {
    try { keys.set(k.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'])); } catch (e) { /* skip a key that won't load */ }
  }
  const age = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  signKeys = { keys, exp: Date.now() + Math.min(6 * 3600, age ? +age[1] : 3600) * 1000 };
  return keys;
}
async function signedInUid(env, c, request) {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(request.headers.get('authorization') || '');
  if (!m) return '';
  let h, p;
  try { h = JSON.parse(new TextDecoder().decode(unb64url(m[1]))); p = JSON.parse(new TextDecoder().decode(unb64url(m[2]))); } catch (e) { return ''; }
  if (!h || h.alg !== 'RS256' || typeof h.kid !== 'string' || !p) return '';
  const project = readKey(env).project_id, now = Math.floor(Date.now() / 1000);
  if (p.aud !== project || p.iss !== 'https://securetoken.google.com/' + project) return '';
  if (!(p.exp > now) || !(p.iat <= now + 300) || !(p.auth_time <= now + 300)) return '';
  if (typeof p.sub !== 'string' || !p.sub || p.sub.length > 128) return '';
  let key = (await firebaseKeys(c)).get(h.kid);
  if (!key) key = (await firebaseKeys(c, true)).get(h.kid);
  if (!key) return '';
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64url(m[3]), new TextEncoder().encode(m[1] + '.' + m[2]));
  return ok ? p.sub : '';
}
async function memberOf(d, fid, uid) {
  if (!FID.test(String(fid || '')) || !uid) return false;
  const doc = await d.get('families/' + fid);
  const mem = doc && doc.fields && doc.fields.members && doc.fields.members.mapValue && doc.fields.members.mapValue.fields;
  return !!(mem && Object.prototype.hasOwnProperty.call(mem, uid));
}
async function readJson(request) {
  const t = await request.text();
  if (t.length > 30000) return null;
  try { const j = JSON.parse(t); return j && typeof j === 'object' ? j : null; } catch (e) { return null; }
}
// sign-in, then membership; returns [error response] or [null, c, d, body, uid]
async function calGate(env, request) {
  if (!calReady(env)) return [json(503, { error: 'not-set-up' })];
  const body = await readJson(request);
  if (!body) return [json(400, { error: 'bad-request' })];
  const c = run(), d = db(env, c);
  const uid = await signedInUid(env, c, request);
  if (!uid) return [json(401, { error: 'signin' })];
  if (!(await memberOf(d, body.fid, uid))) return [json(403, { error: 'not-member' })];
  return [null, c, d, body, uid];
}

// a short-lived Google access token for a family's calendar, kept while this copy is warm
const calTokens = new Map();
async function calAccess(env, c, d, fid) {
  const doc = await d.get('calendar/' + fid);
  if (!doc) return null;
  const s = fieldsOf(doc.fields);
  const t = calTokens.get(fid);
  if (t && t.exp > Date.now() && t.cal === s.cal) return { cal: s.cal, token: t.token, tz: s.tz };
  const rt = await unseal(env, s.rt, fid);
  const r = await c.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: FORM, body: new URLSearchParams({ client_id: env.GOOGLE_OAUTH_ID, client_secret: env.GOOGLE_OAUTH_SECRET, refresh_token: rt, grant_type: 'refresh_token' }).toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    // access taken back in the Google account: forget the connection, so the phones say so
    if (j.error === 'invalid_grant') { await d.commit([{ delete: doc.name }]); calTokens.delete(fid); return null; }
    throw new Error('Google refused the calendar (' + (j.error || r.status) + ')');
  }
  calTokens.set(fid, { token: j.access_token, exp: Date.now() + ((+j.expires_in || 3600) - 120) * 1000, cal: s.cal });
  return { cal: s.cal, token: j.access_token, tz: s.tz };
}
function eventBody(ev, tz) {
  const start = +ev.start, end = +ev.end;
  if (!(start > 0) || !(end >= start) || end - start > 24 * 3600000) return null;
  const z = ZONE.test(String(ev.tz || '')) ? ev.tz : tz;
  return {
    summary: String(ev.title || 'Appointment').slice(0, 120), location: String(ev.where || '').slice(0, 120), description: String(ev.notes || '').slice(0, 900),
    start: { dateTime: new Date(start).toISOString(), timeZone: z }, end: { dateTime: new Date(end).toISOString(), timeZone: z },
    status: 'confirmed', reminders: { useDefault: false, overrides: [] }
  };
}
// event ids are made from the family and the appointment, so asking twice changes one event
const eventId = async (fid, id) => (await sha256Hex(fid + ':' + id)).slice(0, 40);

async function calStart(env, request) {
  const [no, c, d, b, uid] = await calGate(env, request);
  if (no) return no;
  const back = String(b.back || ''), origin = request.headers.get('origin') || '';
  if (back.length > 300 || !/^(https:\/\/[^/\s]+|http:\/\/localhost(:\d+)?)\/[^\s#]*$/.test(back) || (origin && !back.startsWith(origin + '/'))) return json(400, { error: 'bad-request' });
  const st = hex(crypto.getRandomValues(new Uint8Array(16)));
  const name = String(b.name || 'Baby').replace(/[\u0000-\u001f]/g, '').slice(0, 40) || 'Baby';
  const tz = ZONE.test(String(b.tz || '')) ? b.tz : 'Australia/Melbourne';
  const r = await d.commit([{ update: { name: d.name('calstate/' + st), fields: { fid: str(b.fid), uid: str(uid), name: str(name), tz: str(tz), back: str(back), exp: num(Date.now() + 15 * 60000) } }, currentDocument: { exists: false } }]);
  if (!r.ok) throw new Error('state not saved (' + r.status + ')');
  const q = new URLSearchParams({ client_id: env.GOOGLE_OAUTH_ID, redirect_uri: new URL(request.url).origin + '/cal/back', response_type: 'code', scope: CAL_SCOPE, access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state: st });
  return json(200, { url: 'https://accounts.google.com/o/oauth2/v2/auth?' + q.toString() });
}
const PAGE_HEAD = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bub Feed Log</title><body style="font: 17px/1.5 system-ui, sans-serif; margin: 0; padding: 32px 22px; background: #f3ecf5; color: #2a1b33">';
const page = (status, text) => new Response(PAGE_HEAD + '<p>' + text + '</p>', { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
async function calBack(env, request) {
  const url = new URL(request.url), st = url.searchParams.get('state') || '', code = url.searchParams.get('code') || '';
  const expired = () => page(400, 'That link has expired. Go back to Bub Feed Log and try again from Settings › Appointments.');
  if (!calReady(env) || !/^[0-9a-f]{32}$/.test(st)) return expired();
  const c = run(), d = db(env, c);
  const doc = await d.get('calstate/' + st);
  if (!doc) return expired();
  const took = await d.commit([{ delete: doc.name, currentDocument: { updateTime: doc.updateTime } }]); // used once
  if (!took.ok) return expired();
  const s = fieldsOf(doc.fields);
  const go = why => new Response(null, { status: 303, headers: { location: s.back + '#cal=' + (why ? 'no~' + why : 'ok'), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  if (!(s.exp > Date.now())) return go('expired');
  if (url.searchParams.get('error') || !code) return go('denied');
  const tr = await c.fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: FORM, body: new URLSearchParams({ code, client_id: env.GOOGLE_OAUTH_ID, client_secret: env.GOOGLE_OAUTH_SECRET, redirect_uri: url.origin + '/cal/back', grant_type: 'authorization_code' }).toString() });
  const tj = await tr.json().catch(() => ({}));
  if (!tr.ok || !tj.access_token) return go('token');
  if (!String(tj.scope || '').split(/\s+/).includes(CAL_SCOPE)) return go('scope');
  if (!tj.refresh_token) return go('token');
  const cr = await c.fetch(CAL_API + '/calendars', { method: 'POST', headers: { authorization: 'Bearer ' + tj.access_token, 'content-type': 'application/json' }, body: JSON.stringify({ summary: s.name, timeZone: s.tz, description: 'Appointments from Bub Feed Log' }) });
  const cj = await cr.json().catch(() => ({}));
  if (!cr.ok || !cj.id) return go('calendar');
  // a connection made before for this family: let Google know it's no longer used
  const old = await d.get('calendar/' + s.fid);
  if (old) { try { await c.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: FORM, body: 'token=' + encodeURIComponent(await unseal(env, fieldsOf(old.fields).rt, s.fid)) }); } catch (e) { /* gone already */ } }
  const w = await d.commit([{ update: { name: d.name('calendar/' + s.fid), fields: { rt: str(await seal(env, tj.refresh_token, s.fid)), cal: str(cj.id), tz: str(s.tz), by: str(s.uid), at: num(Date.now()) } } }]);
  if (!w.ok) return go('save');
  calTokens.set(s.fid, { token: tj.access_token, exp: Date.now() + ((+tj.expires_in || 3600) - 120) * 1000, cal: cj.id });
  return go('');
}
async function calSyncReq(env, request) {
  const [no, c, d, b] = await calGate(env, request);
  if (no) return no;
  const acc = await calAccess(env, c, d, b.fid);
  if (!acc) return json(404, { error: 'not-connected' });
  const ops = (Array.isArray(b.ops) ? b.ops : []).slice(0, 12), done = [];
  const base = `${CAL_API}/calendars/${encodeURIComponent(acc.cal)}/events`, hdr = { authorization: 'Bearer ' + acc.token, 'content-type': 'application/json' };
  for (const o of ops) {
    if (c.left < 4) break; // the rest next time
    if (!o || typeof o.id !== 'string' || !/^[A-Za-z0-9_-]{4,40}$/.test(o.id)) continue;
    const eid = await eventId(b.fid, o.id);
    if (o.op === 'del') {
      const r = await c.fetch(`${base}/${eid}`, { method: 'DELETE', headers: hdr });
      if (r.ok || r.status === 404 || r.status === 410) done.push({ id: o.id, op: 'del' });
      else console.warn('Event not deleted', r.status);
      continue;
    }
    const ev = o.op === 'put' && o.ev && typeof o.ev === 'object' ? eventBody(o.ev, acc.tz) : null;
    if (!ev) continue;
    let r = await c.fetch(`${base}/${eid}`, { method: 'PUT', headers: hdr, body: JSON.stringify(ev) });
    if (r.status === 404) {
      r = await c.fetch(base, { method: 'POST', headers: hdr, body: JSON.stringify({ id: eid, ...ev }) });
      if (r.status === 404) { // the calendar itself was deleted in Google Calendar
        await d.commit([{ delete: d.name('calendar/' + b.fid) }]); calTokens.delete(b.fid);
        return json(404, { error: 'not-connected' });
      }
    }
    if (r.ok) done.push({ id: o.id, op: 'put' }); else console.warn('Event not saved', r.status);
  }
  return json(200, { done });
}
async function calStatus(env, request) {
  const [no, , d, b] = await calGate(env, request);
  if (no) return no;
  const doc = await d.get('calendar/' + b.fid);
  return json(200, doc ? { connected: true, at: fieldsOf(doc.fields).at || 0 } : { connected: false });
}
async function calOff(env, request) {
  const [no, c, d, b] = await calGate(env, request);
  if (no) return no;
  const doc = await d.get('calendar/' + b.fid);
  if (!doc) return json(404, { error: 'not-connected' });
  try { await c.fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: FORM, body: 'token=' + encodeURIComponent(await unseal(env, fieldsOf(doc.fields).rt, b.fid)) }); } catch (e) { /* gone already */ }
  await d.commit([{ delete: doc.name }]);
  calTokens.delete(b.fid);
  return json(200, { ok: true });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...HEADERS, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '86400' } });
      if (url.pathname === '/cal/back' && request.method === 'GET') return await calBack(env, request);
      if (url.pathname.startsWith('/cal/')) {
        if (request.method !== 'POST') return reply(405, 'no');
        if (url.pathname === '/cal/start') return await calStart(env, request);
        if (url.pathname === '/cal/sync') return await calSyncReq(env, request);
        if (url.pathname === '/cal/status') return await calStatus(env, request);
        if (url.pathname === '/cal/off') return await calOff(env, request);
        return reply(404, 'no');
      }
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
      return url.pathname.startsWith('/cal/') && url.pathname !== '/cal/back' ? json(500, { error: 'server' }) : reply(500, 'error');
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(everyMinute(env, (event && event.scheduledTime) || Date.now()));
  }
};

// for the tests
export const _test = { phoneGone, fieldsOf, readKey, pemToDer, resetToken: () => { saved = null; }, BUDGET, eventId, resetCal: () => { signKeys = null; calTokens.clear(); } };
