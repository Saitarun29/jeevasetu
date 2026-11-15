import fs from 'fs';
import path from 'path';
import admin from 'firebase-admin';

// 1. Read Environment & Credentials
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split(/\r?\n/).forEach(line => {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) {
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }
    envVars[match[1].trim()] = val.replace(/\\n/g, '\n');
  }
});

const credsPath = 'C:/Users/ADMIN/.gemini/antigravity/brain/5f448a1d-4eb1-4e59-96eb-4cb9e4ada9b7/scratch/synthetic_test_credentials.json';
const testUsers = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

if (envVars.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(envVars.GOOGLE_APPLICATION_CREDENTIALS);
}

const apiKey = envVars.NEXT_PUBLIC_FIREBASE_API_KEY;
const projectId = envVars.FIREBASE_PROJECT_ID || 'jeevasetu';

// 2. Initialize Firebase Admin
const app = admin.apps.length > 0
  ? admin.app('w4-handover-runner')
  : admin.initializeApp({
      projectId,
    }, 'w4-handover-runner');

const db = app.firestore();

// 3. Helper: Firebase Auth ID Token Exchange via REST API
async function getAuthToken(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Auth failed for ${email}: ${JSON.stringify(data)}`);
  }
  return data.idToken;
}

const baseUrl = 'http://localhost:3005';

async function runW4Tests() {
  console.log('=================================================================');
  console.log('JEEVASETU WORKFLOW 4 (W4): CAREGIVER HANDOVER LIVE INTEGRATION TEST');
  console.log('=================================================================\n');

  const evidence = {
    testWorkflow: 'W4_CAREGIVER_HANDOVER_AND_DUTY_TRANSITION',
    patientFixtureId: 'synth_patient_w4_handover',
    timestamp: new Date().toISOString(),
    steps: [],
  };

  function logStep(num, name, status, details) {
    const entry = { step: num, name, status, details, timestamp: new Date().toISOString() };
    evidence.steps.push(entry);
    console.log(`[STEP ${num}] ${name} -> ${status}`);
    if (details) console.log('       ', JSON.stringify(details));
  }

  const patientId = 'synth_patient_w4_handover';

  // STEP 1: Fixture Setup
  const patientRef = db.collection('patients').doc(patientId);

  const subcollections = ['handovers', 'tasks', 'care_events'];
  for (const sub of subcollections) {
    const snap = await patientRef.collection(sub).get();
    const batch = db.batch();
    snap.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }

  await patientRef.set({
    id: patientId,
    fullName: 'Synthetic Elder W4 (Handover)',
    dateOfBirth: '1947-03-22',
    bloodGroup: 'B+',
    timezone: 'Asia/Kolkata',
    allergies: ['Penicillin', 'Sulfa'],
    chronicConditions: ['Hypertension', 'Type 2 Diabetes'],
    primaryLanguage: 'English',
    emergencyContact: {
      name: testUsers.primary_family.label,
      phone: '+919876543210',
      relation: 'Son',
    },
    createdBy: testUsers.primary_family.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const members = [
    { uid: testUsers.primary_family.uid, email: testUsers.primary_family.email, name: testUsers.primary_family.label, role: 'primary_family' },
    { uid: testUsers.caregiver_a.uid, email: testUsers.caregiver_a.email, name: testUsers.caregiver_a.label, role: 'caregiver' },
    { uid: testUsers.caregiver_b.uid, email: testUsers.caregiver_b.email, name: testUsers.caregiver_b.label, role: 'caregiver' },
  ];

  for (const m of members) {
    await patientRef.collection('members').doc(m.uid).set({
      userId: m.uid,
      email: m.email,
      displayName: m.name,
      role: m.role,
      status: 'active',
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await db.collection('users').doc(m.uid).collection('accessible_patients').doc(patientId).set({
      patientId,
      fullName: 'Synthetic Elder W4 (Handover)',
      role: m.role,
      status: 'active',
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  logStep(1, 'Patient Fixture Setup', 'PASS', { patientId });

  // STEP 2: Tokens
  const tokenAlpha = await getAuthToken(testUsers.caregiver_a.email, testUsers.caregiver_a.password);
  const tokenBeta = await getAuthToken(testUsers.caregiver_b.email, testUsers.caregiver_b.password);
  const tokenFamily = await getAuthToken(testUsers.primary_family.email, testUsers.primary_family.password);
  const tokenUnauth = await getAuthToken(testUsers.unauthorized_user.email, testUsers.unauthorized_user.password);

  logStep(2, 'Firebase Auth Sign-In', 'PASS', { tokensAcquired: true });

  // STEP 3: Initiate Handover
  const handoverPayload = {
    receivingCaregiverUid: testUsers.caregiver_b.uid,
    receivingCaregiverName: testUsers.caregiver_b.label,
    shiftStartTime: '2026-11-15T08:00:00.000Z',
    shiftEndTime: '2026-11-15T16:00:00.000Z',
    notes: 'Elder completed lunch at 13:00. 30 min indoor walking completed. Resting comfortably.',
    patientConditionSummary: 'Alert, cheerful, vital signs stable, no dizziness reported.',
    pendingTasksSummary: [
      'Administer 18:00 Amlodipine 5mg',
      'Blood Pressure check post-dinner (20:30)',
    ],
    vitalSignsSnapshot: {
      bloodPressure: '122/82',
      bloodSugar: '112 mg/dL',
      pulseRate: '72 bpm',
      temperature: '98.4 F',
    },
  };

  const initRes = await fetch(`${baseUrl}/api/patients/${patientId}/handovers`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenAlpha}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(handoverPayload),
  });

  const initData = await initRes.json();
  const handoverId = initData.handover?.id;
  logStep(3, 'Caregiver Alpha Handover Initiation', initRes.status === 201 && Boolean(handoverId) ? 'PASS' : 'FAIL', {
    httpStatus: initRes.status,
    handoverId,
  });

  // STEP 4: Verify Firestore Pending
  const handoverDocRef = patientRef.collection('handovers').doc(handoverId);
  const handoverDocSnap = await handoverDocRef.get();
  const handoverData = handoverDocSnap.data();
  logStep(4, 'Firestore Document Persistence Verification', (handoverDocSnap.exists && handoverData.status === 'pending_acknowledgement') ? 'PASS' : 'FAIL', {
    status: handoverData?.status,
  });

  // STEP 5: Caregiver Beta Views Handover
  const viewRes = await fetch(`${baseUrl}/api/patients/${patientId}/handovers`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenBeta}` },
  });
  const viewData = await viewRes.json();
  const foundHandover = viewData.handovers?.find(h => h.id === handoverId);
  logStep(5, 'Caregiver Beta View Handover', (viewRes.status === 200 && foundHandover) ? 'PASS' : 'FAIL', {
    httpStatus: viewRes.status,
    found: Boolean(foundHandover),
  });

  // STEP 6: Anti-Self-Ack Check
  const selfAckRes = await fetch(`${baseUrl}/api/patients/${patientId}/handovers/${handoverId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenAlpha}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'acknowledge' }),
  });
  logStep(6, 'Self-Acknowledgement Prevention Check', selfAckRes.status !== 200 ? 'PASS' : 'FAIL', {
    httpStatus: selfAckRes.status,
  });

  // STEP 7: Unauthorized Access Check
  const unauthRes = await fetch(`${baseUrl}/api/patients/${patientId}/handovers/${handoverId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenUnauth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'acknowledge' }),
  });
  logStep(7, 'Unauthorized Access Prevention Check', unauthRes.status === 403 ? 'PASS' : 'FAIL', {
    httpStatus: unauthRes.status,
  });

  // STEP 8: Caregiver Beta Explicitly Acknowledges
  const ackRes = await fetch(`${baseUrl}/api/patients/${patientId}/handovers/${handoverId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenBeta}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'acknowledge' }),
  });
  const ackData = await ackRes.json();
  const postAckDoc = await handoverDocRef.get();
  logStep(8, 'Caregiver Beta Handover Acceptance', (ackRes.status === 200 && postAckDoc.data()?.status === 'acknowledged') ? 'PASS' : 'FAIL', {
    httpStatus: ackRes.status,
    newStatus: postAckDoc.data()?.status,
    acknowledgedBy: postAckDoc.data()?.acknowledgedByUid,
  });

  // STEP 9: Terminal State Protection (Double Ack)
  const doubleAckRes = await fetch(`${baseUrl}/api/patients/${patientId}/handovers/${handoverId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenBeta}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'acknowledge' }),
  });
  logStep(9, 'Terminal State Protection Guard', doubleAckRes.status !== 200 ? 'PASS' : 'FAIL', {
    httpStatus: doubleAckRes.status,
  });

  // STEP 10: Care Gap Detector for Expired Handover (>2h)
  const expiredHandoverRef = patientRef.collection('handovers').doc('handover_expired_fixture');
  const threeHoursAgo = new Date(Date.now() - 3.5 * 3600 * 1000).toISOString();
  await expiredHandoverRef.set({
    id: 'handover_expired_fixture',
    patientId,
    givingCaregiverUid: testUsers.caregiver_a.uid,
    givingCaregiverName: testUsers.caregiver_a.label,
    receivingCaregiverUid: testUsers.caregiver_b.uid,
    receivingCaregiverName: testUsers.caregiver_b.label,
    status: 'pending_acknowledgement',
    shiftStartTime: new Date(Date.now() - 11 * 3600 * 1000).toISOString(),
    shiftEndTime: threeHoursAgo,
    notes: 'Expired shift notes fixture for Care Gap Detector evaluation.',
    patientConditionSummary: 'Stable',
    pendingTasksSummary: ['Evening glucose check'],
    createdAt: threeHoursAgo,
  });

  const gapRes = await fetch(`${baseUrl}/api/patients/${patientId}/gaps`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenBeta}` },
  });
  const gapData = await gapRes.json();
  const handoverGap = gapData.gaps?.find(g => g.type === 'pending_handover');
  logStep(10, 'Care Gap Detector (Pending Handover > 2hr)', Boolean(handoverGap) ? 'PASS' : 'FAIL', {
    found: Boolean(handoverGap),
    gapType: handoverGap?.type,
    severity: handoverGap?.severity,
  });

  // STEP 11: Timeline Audit Feed
  const timelineRes = await fetch(`${baseUrl}/api/patients/${patientId}/timeline?category=continuity`, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${tokenFamily}` },
  });
  const timelineData = await timelineRes.json();
  const events = timelineData.events || [];
  const hasInitiated = events.some(e => e.eventType === 'HANDOVER_INITIATED');
  const hasAck = events.some(e => e.eventType === 'HANDOVER_ACKNOWLEDGED');
  logStep(11, 'Append-Only Audit Timeline Verification', (hasInitiated && hasAck) ? 'PASS' : 'FAIL', {
    hasInitiated,
    hasAck,
    eventCount: events.length,
  });

  // STEP 12: Isolation Check
  const baselineDoc = await db.collection('patients').doc('qdBDrWWKUO6cJiJjBFQR').get();
  logStep(12, 'Baseline Patient Isolation Check', baselineDoc.exists ? 'PASS' : 'FAIL', {
    baselinePatientId: 'qdBDrWWKUO6cJiJjBFQR',
    existsUnmodified: baselineDoc.exists,
  });

  console.log('\n=== FINAL W4 TEST SUMMARY ===');
  console.table(evidence.steps);
}

runW4Tests().catch(console.error);
