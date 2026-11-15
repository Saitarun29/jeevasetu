// JEEVASETU live integration verification.
// Uses REAL Firebase Admin credentials from .env.local, REAL Firebase Auth tokens,
// REAL HTTP calls against the production server on :3100, and REAL Firestore reads.
// Synthetic data only; everything created here is deleted at the end.
import { readFileSync } from 'fs';
import admin from 'firebase-admin';

const BASE = 'http://localhost:3100';
const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^"(.*)"$/, '$1');
}
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const PROJECT_ID = env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: PROJECT_ID,
    clientEmail: env.FIREBASE_CLIENT_EMAIL,
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  }),
});
const db = admin.firestore();
const auth = admin.auth();

const results = [];
function record(id, title, pass, evidence) {
  results.push({ id, title, pass, evidence });
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${id} | ${title} | ${evidence}`);
}

async function tokenFor(uid) {
  const customToken = await auth.createCustomToken(uid);
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }) }
  );
  const data = await res.json();
  if (!data.idToken) throw new Error('Token exchange failed: ' + JSON.stringify(data).slice(0, 300));
  return data.idToken;
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

const stamp = Date.now();
const uidA = `live_primary_${stamp}`;
const uidB = `live_caregiver_${stamp}`;
const uidC = `live_stranger_${stamp}`;
const email = (u) => `${u}@example.com`.replace(/[^a-z0-9@._-]/gi, '').toLowerCase();

const createdUsers = [];
let patientId = null;
let invitationId = null;

try {
  // ---------- synthetic users ----------
  for (const [uid, name] of [[uidA, 'Live Primary'], [uidB, 'Live Caregiver'], [uidC, 'Live Stranger']]) {
    await auth.createUser({ uid, email: email(uid), emailVerified: true, displayName: name });
    createdUsers.push(uid);
  }
  const tokenA = await tokenFor(uidA);
  const tokenB = await tokenFor(uidB);
  const tokenC = await tokenFor(uidC);
  record('AUTH-1', 'Firebase custom-token -> ID token exchange for 3 synthetic users', !!tokenA && !!tokenB && !!tokenC, 'all 3 ID tokens issued');

  // ---------- 1. Unauthenticated denial ----------
  {
    const r = await api('/api/patients/anything');
    record('SEC-1', 'Unauthenticated request rejected', r.status === 401, `GET /api/patients/x -> ${r.status}`);
  }

  // ---------- 2. Patient registration ----------
  {
    const r = await api('/api/patients', {
      method: 'POST', token: tokenA,
      body: {
        fullName: 'Synthetic Rao (Live Test)', dateOfBirth: '1944-02-11', bloodGroup: 'O+',
        timezone: 'Asia/Kolkata', allergies: ['Penicillin'], chronicConditions: ['Hypertension'],
        primaryLanguage: 'English', emergencyContact: { name: 'Live Son', phone: '+919999000111', relation: 'Son' },
        address: 'Synthetic address', notes: 'synthetic only',
      },
    });
    patientId = r.json?.patient?.id || r.json?.id || null;
    record('REG-1', 'Patient registration via API (real Firestore write)', r.status === 201 && !!patientId, `POST /api/patients -> ${r.status}, patientId=${patientId}`);
    const member = patientId ? await db.collection('patients').doc(patientId).collection('members').doc(uidA).get() : null;
    record('REG-2', 'Creator auto-enrolled as active primary_family', !!(member?.exists && member.data().role === 'primary_family' && member.data().status === 'active'), `member doc exists=${member?.exists}, role=${member?.data()?.role}, status=${member?.data()?.status}`);
  }

  // ---------- 3. Profile access (authorized) ----------
  {
    const r = await api(`/api/patients/${patientId}`, { token: tokenA });
    record('ACC-1', 'Authorized patient profile access', r.status === 200, `GET /api/patients/{id} -> ${r.status}`);
  }

  // ---------- 4. Cross-patient isolation ----------
  {
    const r = await api(`/api/patients/${patientId}`, { token: tokenC });
    record('SEC-2', 'Non-member denied patient access (cross-patient isolation)', r.status === 403, `stranger GET /api/patients/{id} -> ${r.status}`);
  }

  // ---------- 5. Invitation + redemption ----------
  {
    const r = await api(`/api/patients/${patientId}/invitations`, { method: 'POST', token: tokenA, body: { targetRole: 'caregiver' } });
    invitationId = r.json?.invitationId || r.json?.invitation?.id || null;
    const passcode = r.json?.passcode || r.json?.invitation?.passcode || null;
    record('INV-1', 'Invitation issuance (6-digit passcode)', r.status === 201 && !!passcode, `POST invitations -> ${r.status}, invitationId=${invitationId}`);

    if (passcode) {
      const redeem = await api('/api/invitations/redeem', { method: 'POST', token: tokenB, body: { passcode, invitationId } });
      record('INV-2', 'Caregiver redeems invitation', redeem.status === 200 || redeem.status === 201, `POST invitations/redeem -> ${redeem.status}`);
      const m = await db.collection('patients').doc(patientId).collection('members').doc(uidB).get();
      record('INV-3', 'Redeemed membership persists as active caregiver', !!(m.exists && m.data().role === 'caregiver' && m.data().status === 'active'), `role=${m.data()?.role}, status=${m.data()?.status}`);

      const replay = await api('/api/invitations/redeem', { method: 'POST', token: tokenC, body: { passcode, invitationId } });
      record('INV-4', 'Redeemed passcode cannot be reused', replay.status >= 400, `replay by stranger -> ${replay.status}`);
    } else {
      record('INV-2', 'Caregiver redeems invitation', false, 'no passcode returned by API');
    }
  }

  // ---------- 6. Role authorization ----------
  {
    const r = await api(`/api/patients/${patientId}/invitations`, { method: 'POST', token: tokenB, body: { targetRole: 'caregiver' } });
    record('SEC-3', 'Caregiver cannot mint invitations (role allowlist)', r.status === 403, `caregiver POST invitations -> ${r.status}`);
  }

  // ---------- 7. Medication creation ----------
  let medicationId = null;
  const todayLocal = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  {
    const r = await api(`/api/patients/${patientId}/medications`, {
      method: 'POST', token: tokenA,
      body: {
        name: 'Synthetic Metformin', dosage: '500mg', form: 'tablet', instructions: 'After breakfast',
        prescribedBy: 'Dr. Synthetic', frequency: 'daily', times: ['00:05', '23:55'],
        startDate: todayLocal,
      },
    });
    medicationId = r.json?.medication?.id || r.json?.id || null;
    record('MED-1', 'Medication schedule creation', r.status === 201 && !!medicationId, `POST medications -> ${r.status}, medicationId=${medicationId}`);
  }

  // ---------- 8. Dose expansion ----------
  {
    const r = await api(`/api/patients/${patientId}/medications/doses?date=${todayLocal}&gracePeriod=60`, { token: tokenA });
    const doses = r.json?.doses || [];
    const missed = doses.filter(d => d.status === 'MISSED').length;
    record('MED-2', 'Dose expansion + MISSED evaluation (past 00:05 dose)', r.status === 200 && doses.length === 2 && missed >= 1, `doses=${doses.length}, missed=${missed}, metrics=${JSON.stringify(r.json?.metrics)}`);
  }

  // ---------- 9. Adherence TAKEN + idempotency ----------
  const actionId = crypto.randomUUID ? crypto.randomUUID() : (await import('crypto')).randomUUID();
  {
    const body = { actionId, medicationId, scheduledDate: todayLocal, scheduledTime: '23:55', status: 'TAKEN', note: '', source: 'online', expectedVersion: 1, clientTimestamp: new Date().toISOString() };
    const first = await api(`/api/patients/${patientId}/medications/events`, { method: 'POST', token: tokenA, body });
    record('ADH-1', 'Record TAKEN (real Firestore medication_events write)', first.status === 201 && first.json?.isDuplicate === false, `first POST -> ${first.status}, isDuplicate=${first.json?.isDuplicate}`);
    const second = await api(`/api/patients/${patientId}/medications/events`, { method: 'POST', token: tokenA, body });
    record('ADH-2', 'Duplicate action UUID replay is idempotent (no double write)', second.status === 200 && second.json?.isDuplicate === true, `replay -> ${second.status}, isDuplicate=${second.json?.isDuplicate}`);
    const evSnap = await db.collection('patients').doc(patientId).collection('medication_events').where('medicationId', '==', medicationId).get();
    record('ADH-3', 'Exactly one medication_events doc after replay', evSnap.size === 1, `event docs=${evSnap.size}`);
  }

  // ---------- 10. Offline sync path + stale version conflict ----------
  {
    const offlineActionId = (await import('crypto')).randomUUID();
    const ok = await api(`/api/patients/${patientId}/medications/events`, {
      method: 'POST', token: tokenA,
      body: { actionId: offlineActionId, medicationId, scheduledDate: todayLocal, scheduledTime: '00:05', status: 'SKIPPED', note: 'test skip', source: 'offline_sync', expectedVersion: 1, clientTimestamp: new Date().toISOString() },
    });
    record('OFF-1', 'Offline-queued event syncs with source=offline_sync', ok.status === 201, `POST source=offline_sync -> ${ok.status}`);

    const staleActionId = (await import('crypto')).randomUUID();
    const stale = await api(`/api/patients/${patientId}/medications/events`, {
      method: 'POST', token: tokenA,
      body: { actionId: staleActionId, medicationId, scheduledDate: todayLocal, scheduledTime: '23:55', status: 'TAKEN', source: 'offline_sync', expectedVersion: 999, clientTimestamp: new Date().toISOString() },
    });
    const reason = stale.json?.error || '';
    record('OFF-2', 'Stale schedule version rejected with 409 (never silently overwritten)', stale.status === 409 && /version conflict/i.test(reason), `expectedVersion=999 -> ${stale.status}: ${String(reason).slice(0, 90)}`);
    const staleEvents = await db.collection('patients').doc(patientId).collection('medication_events').doc(staleActionId).get();
    record('OFF-3', 'Rejected stale event NOT persisted', !staleEvents.exists, `stale doc exists=${staleEvents.exists}`);
  }

  // ---------- 11. Timeline reflects real events ----------
  {
    const r = await api(`/api/patients/${patientId}/timeline?limit=50`, { token: tokenA });
    const events = r.json?.events || [];
    const types = events.map(e => e.eventType);
    record('TL-1', 'Shared care timeline returns real events (patient subcollection)', r.status === 200 && events.length > 0 && types.includes('MEDICATION_TAKEN') && types.includes('MEDICATION_SKIPPED'), `${events.length} events; has TAKEN=${types.includes('MEDICATION_TAKEN')}, SKIPPED=${types.includes('MEDICATION_SKIPPED')}`);
  }

  // ---------- 12. Appointments + conflict detection ----------
  let appointmentId = null;
  {
    const apptDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + 86400000));
    const body = { doctorName: 'Dr. Live Test', specialty: 'Cardiology', clinicName: 'Synthetic Clinic', clinicAddress: '1 Test Rd', localDate: apptDate, localTime: '10:30', reminderPreferences: { email24h: true, email2h: true } };
    const first = await api(`/api/patients/${patientId}/appointments`, { method: 'POST', token: tokenA, body });
    appointmentId = first.json?.appointment?.id || first.json?.id || null;
    record('APT-1', 'Appointment creation', (first.status === 201) && !!appointmentId, `POST appointments -> ${first.status}`);

    const conflict = await api(`/api/patients/${patientId}/appointments`, { method: 'POST', token: tokenA, body: { ...body, doctorName: 'Dr. Conflicting' } });
    const hasConflictPayload = !!(conflict.json?.conflict || conflict.json?.conflicts || /conflict/i.test(conflict.json?.error || ''));
    record('APT-2', 'Overlapping appointment blocked (conflict surfaced, not overwritten)', conflict.status === 409 || (conflict.status >= 400 && hasConflictPayload), `second same-slot POST -> ${conflict.status}`);

    const list = await api(`/api/patients/${patientId}/appointments`, { token: tokenA });
    const count = (list.json?.appointments || []).length;
    record('APT-3', 'Appointment list contains exactly the non-conflicting appointment', list.status === 200 && count === 1, `appointments=${count}`);
  }

  // ---------- 13. Tasks ----------
  let taskId = null;
  {
    const create = await api(`/api/patients/${patientId}/tasks`, {
      method: 'POST', token: tokenA,
      body: { title: 'Live synthetic BP check', description: 'Verify systolic', priority: 'high', dueDate: new Date(Date.now() + 3600000).toISOString(), assignedToUid: uidB, assignedToName: 'SPOOFED NAME SHOULD BE IGNORED' },
    });
    taskId = create.json?.task?.id || create.json?.id || null;
    const storedName = create.json?.task?.assignedToName;
    record('TASK-1', 'Care task assignment (assignee validated as active member)', create.status === 201 && !!taskId && storedName !== 'SPOOFED NAME SHOULD BE IGNORED', `POST tasks -> ${create.status}, stored assignedToName="${storedName}"`);

    const badAssign = await api(`/api/patients/${patientId}/tasks`, { method: 'POST', token: tokenA, body: { title: 'Bad assign', priority: 'low', dueDate: new Date().toISOString(), assignedToUid: uidC, assignedToName: 'Stranger' } });
    record('TASK-2', 'Task assignment to non-member rejected', badAssign.status === 400 || badAssign.status === 403, `assign to stranger -> ${badAssign.status}`);

    const complete = await api(`/api/patients/${patientId}/tasks/${taskId}`, { method: 'PATCH', token: tokenB, body: { status: 'completed', notes: 'done live' } });
    record('TASK-3', 'Caregiver completes assigned task', complete.status === 200 && complete.json?.task?.status === 'completed', `PATCH task -> ${complete.status}, status=${complete.json?.task?.status}`);

    const reopen = await api(`/api/patients/${patientId}/tasks/${taskId}`, { method: 'PATCH', token: tokenB, body: { status: 'pending' } });
    record('TASK-4', 'Completed task cannot be silently re-opened', reopen.status >= 400, `re-open attempt -> ${reopen.status}`);
  }

  // ---------- 14. Caregiver handover ----------
  let handoverId = null;
  {
    const init = await api(`/api/patients/${patientId}/handovers`, {
      method: 'POST', token: tokenB,
      body: { receivingCaregiverUid: uidA, receivingCaregiverName: 'Live Primary', shiftStartTime: '08:00', shiftEndTime: '16:00', notes: 'Live handover notes', patientConditionSummary: 'Stable synthetic patient', pendingTasksSummary: ['BP check'] },
    });
    handoverId = init.json?.handover?.id || init.json?.id || null;
    const status = init.json?.handover?.status;
    record('HO-1', 'Handover initiated as pending_acknowledgement (no premature transfer)', init.status === 201 && status === 'pending_acknowledgement', `POST handovers -> ${init.status}, status=${status}`);

    if (handoverId) {
      const selfAck = await api(`/api/patients/${patientId}/handovers/${handoverId}`, { method: 'PATCH', token: tokenB, body: { action: 'acknowledge' } });
      // Invariant: the giving caregiver can never acknowledge their own handover.
      // The engine denies with a permission error (403) before the designation check.
      record('HO-2', 'Giving caregiver cannot self-acknowledge (403, no transfer)', selfAck.status === 403, `giving caregiver PATCH -> ${selfAck.status}: ${String(selfAck.json?.error).slice(0, 70)}`);

      const strangerAck = await api(`/api/patients/${patientId}/handovers/${handoverId}`, { method: 'PATCH', token: tokenC, body: { action: 'acknowledge' } });
      record('HO-3', 'Non-member cannot acknowledge handover', strangerAck.status === 403, `stranger PATCH -> ${strangerAck.status}`);

      const ack = await api(`/api/patients/${patientId}/handovers/${handoverId}`, { method: 'PATCH', token: tokenA, body: { action: 'acknowledge' } });
      const after = await db.collection('patients').doc(patientId).collection('handovers').doc(handoverId).get();
      record('HO-4', 'Designated receiver acknowledges; responsibility transfers atomically', ack.status === 200 && after.data()?.status === 'acknowledged' && !!after.data()?.acknowledgedAt, `PATCH ack -> ${ack.status}, firestore status=${after.data()?.status}, acknowledgedAt=${!!after.data()?.acknowledgedAt}`);

      const doubleAck = await api(`/api/patients/${patientId}/handovers/${handoverId}`, { method: 'PATCH', token: tokenA, body: { action: 'acknowledge' } });
      record('HO-5', 'Double acknowledgement rejected (no duplicate audit event)', doubleAck.status >= 400, `second ack -> ${doubleAck.status}`);
    }
  }

  // ---------- 15. Care gap detection ----------
  {
    // Create a SECOND medication with a dose already well past the grace window and
    // NO recorded event, so it must be evaluated as MISSED by the gap detector.
    const overdueMed = await api(`/api/patients/${patientId}/medications`, {
      method: 'POST', token: tokenA,
      body: { name: 'Synthetic Overdue Med', dosage: '5mg', form: 'tablet', instructions: 'Synthetic', frequency: 'daily', times: ['00:01'], startDate: todayLocal },
    });

    const r = await api(`/api/patients/${patientId}/gaps`, { token: tokenA });
    const gaps = r.json?.gaps || [];
    const medGap = gaps.some(g => g.type === 'unconfirmed_dose');
    const handoverGap = gaps.some(g => g.type === 'pending_handover');
    record('GAP-1', 'Care gap endpoint returns structured gaps', r.status === 200 && Array.isArray(gaps) && gaps.length > 0, `gaps=${gaps.length}, critical=${r.json?.hasCriticalGaps}, types=${gaps.map(g => g.type).join(',')}`);
    record('GAP-2', 'Missed-dose gap detected (real field query + grace evaluation)', medGap, `overdue med created=${overdueMed.status}, unconfirmed_dose present=${medGap}`);
    record('GAP-3', 'No false pending-handover gap after acknowledgement', !handoverGap, `pending_handover present=${handoverGap}`);
  }

  // ---------- 16. Revoked membership denial ----------
  {
    await db.collection('patients').doc(patientId).collection('members').doc(uidB).update({ status: 'revoked' });
    const r = await api(`/api/patients/${patientId}/medications`, { token: tokenB });
    record('SEC-4', 'Revoked caregiver denied immediately (no token refresh needed)', r.status === 403, `revoked caregiver GET medications -> ${r.status}`);

    const write = await api(`/api/patients/${patientId}/tasks`, { method: 'POST', token: tokenB, body: { title: 'Revoked write', priority: 'low', dueDate: new Date().toISOString(), assignedToUid: uidA, assignedToName: 'x' } });
    record('SEC-5', 'Revoked caregiver denied on write path', write.status === 403, `revoked caregiver POST tasks -> ${write.status}`);
  }

  // ---------- 17. System health (email provider state) ----------
  {
    const r = await api('/api/system/health', { token: tokenA });
    const m = r.json?.metrics || {};
    record('EMAIL-1', 'System health reports email provider readiness honestly', r.status === 200 && typeof m.providerConfigured === 'boolean' && !!m.schedulerStatus, `status=${r.status}, scheduler=${m.schedulerStatus}, providerConfigured=${m.providerConfigured}`);

    const cron = await fetch(BASE + '/api/reminders/process', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    record('EMAIL-2', 'Reminder cron endpoint rejects unauthenticated/unkeyed call', cron.status === 401 || cron.status === 403, `POST reminders/process without secret -> ${cron.status}`);

    // Cloud Scheduler contract: Authorization: Bearer <CRON_SECRET> (constant-time compared server-side)
    const cronOk = await fetch(BASE + '/api/reminders/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.CRON_SECRET}` },
      body: '{}',
    });
    const cronJson = await cronOk.json().catch(() => ({}));
    record('EMAIL-3', 'Reminder cron executes with Authorization: Bearer <CRON_SECRET>', cronOk.status === 200, `POST with Bearer secret -> ${cronOk.status}, summary=${JSON.stringify(cronJson).slice(0, 160)}`);
  }

  // ---------- 18. Liveness probe is dynamic ----------
  {
    const h1 = await (await fetch(BASE + '/api/health', { cache: 'no-store' })).json();
    await new Promise(r => setTimeout(r, 1100));
    const h2 = await (await fetch(BASE + '/api/health', { cache: 'no-store' })).json();
    record('OPS-1', 'Liveness probe returns a fresh timestamp per request (dynamic, no-store)', h1.timestamp !== h2.timestamp, `${h1.timestamp} != ${h2.timestamp}`);
  }
} catch (err) {
  console.error('HARNESS ERROR:', err?.message || err);
  record('HARNESS', 'Harness completed without crashing', false, String(err?.message || err).slice(0, 200));
} finally {
  // ---------- cleanup ----------
  try {
    if (patientId) await db.recursiveDelete(db.collection('patients').doc(patientId));
    if (invitationId) await db.collection('invitations').doc(invitationId).delete();
    for (const uid of createdUsers) {
      try { await db.recursiveDelete(db.collection('users').doc(uid)); } catch {}
      try { await auth.deleteUser(uid); } catch {}
    }
  } catch (e) { console.error('CLEANUP WARN:', e.message); }

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass);
  console.log(`\n===== LIVE SUMMARY: ${passed}/${results.length} passed =====`);
  for (const f of failed) console.log(`FAILED: ${f.id} — ${f.title} — ${f.evidence}`);
  console.log('CLEANUP: synthetic patient + invitation + 3 auth users deleted =', !!(patientId));
}
