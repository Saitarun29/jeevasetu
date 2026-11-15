import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import admin from 'firebase-admin';

// 1. Load Credentials & Configuration
const credsPath = 'C:/Users/ADMIN/.gemini/antigravity/brain/5f448a1d-4eb1-4e59-96eb-4cb9e4ada9b7/scratch/synthetic_test_credentials.json';
const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

// Parse .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
for (const line of envContent.split('\n')) {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || '';
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[match[1]] = val.replace(/\\n/g, '\n');
  }
}

if (env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(env.GOOGLE_APPLICATION_CREDENTIALS);
}

// Initialize Admin SDK
const app = admin.apps.length > 0
  ? admin.app('w2-medication-runner')
  : admin.initializeApp({
      projectId: env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    }, 'w2-medication-runner');

const db = app.firestore();

// Helper: Firebase Auth ID Token Exchange via REST API
async function getIdToken(email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.NEXT_PUBLIC_FIREBASE_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Auth failed for ${email}: ${JSON.stringify(err)}`);
  }
  const data = await res.json();
  return data.idToken;
}

const BASE_URL = 'http://localhost:3005';
const PATIENT_ID = 'synth_patient_w2_medication';

async function runWorkflow2() {
  console.log('=== STARTING WORKFLOW 2 (W2) LIVE INTEGRATION TEST ===\n');
  const results = { steps: [], passCount: 0, failCount: 0 };

  function recordStep(name, success, details) {
    results.steps.push({ name, success, details });
    if (success) {
      results.passCount++;
      console.log(`[PASS] ${name}`);
    } else {
      results.failCount++;
      console.error(`[FAIL] ${name}:`, details);
    }
  }

  try {
    // --- Step 0: Auth & Fixture Setup ---
    console.log('Step 0: Authenticating Synthetic Primary Family & Caregiver Alpha...');
    const primaryToken = await getIdToken(creds.primary_family.email, creds.primary_family.password);
    const caregiverToken = await getIdToken(creds.caregiver_a.email, creds.caregiver_a.password);
    console.log('Tokens successfully obtained for both synthetic actors.');

    console.log(`Step 0b: Ensuring isolated patient fixture '${PATIENT_ID}' in Firestore...`);
    const patientRef = db.collection('patients').doc(PATIENT_ID);
    await patientRef.set({
      id: PATIENT_ID,
      fullName: 'Synthetic Patient W2 (Adherence & Schedule)',
      dateOfBirth: '1948-06-15',
      bloodGroup: 'B+',
      timezone: 'Asia/Kolkata',
      allergies: ['Penicillin'],
      chronicConditions: ['Hypertension', 'Type 2 Diabetes'],
      primaryLanguage: 'Hindi',
      emergencyContact: {
        name: creds.primary_family.label,
        phone: '+919876543210',
        relation: 'Son',
      },
      createdBy: creds.primary_family.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Primary Family member
    await patientRef.collection('members').doc(creds.primary_family.uid).set({
      userId: creds.primary_family.uid,
      email: creds.primary_family.email,
      displayName: creds.primary_family.label,
      role: 'primary_family',
      status: 'active',
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: creds.primary_family.uid,
    });

    // Caregiver Alpha member
    await patientRef.collection('members').doc(creds.caregiver_a.uid).set({
      userId: creds.caregiver_a.uid,
      email: creds.caregiver_a.email,
      displayName: creds.caregiver_a.label,
      role: 'caregiver',
      status: 'active',
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      invitedBy: creds.primary_family.uid,
    });

    recordStep('Step 0: Fixture Setup', true, { patientId: PATIENT_ID });

    // --- Step 1: Create Medication Regimen ---
    console.log('\nStep 1: Creating Medication Regimen via POST /api/patients/{id}/medications...');
    const today = new Date().toISOString().slice(0, 10);
    const createMedRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryToken}`,
      },
      body: JSON.stringify({
        name: 'Amlodipine Besylate',
        dosage: '5mg',
        form: 'tablet',
        instructions: 'Take 1 tablet daily after morning breakfast with warm water',
        prescribedBy: 'Dr. R. K. Sharma (Cardiology)',
        frequency: 'daily',
        times: ['08:00', '20:00'],
        startDate: today,
      }),
    });

    const createMedData = await createMedRes.json();
    const medId = createMedData.medicationId;
    recordStep('Step 1: Create Medication Regimen', createMedRes.status === 201 && Boolean(medId), {
      status: createMedRes.status,
      medicationId: medId,
      version: createMedData.medication?.version,
    });

    // --- Step 2: Verify Firestore Persistence ---
    console.log('\nStep 2: Verifying medication persistence in Firestore (/patients/{id}/medications/{medId})...');
    const medDoc = await patientRef.collection('medications').doc(medId).get();
    const medData = medDoc.data();
    const step2Pass = medDoc.exists && medData.version === 1 && medData.name === 'Amlodipine Besylate';
    recordStep('Step 2: Verify Firestore Persistence', step2Pass, {
      path: `/patients/${PATIENT_ID}/medications/${medId}`,
      exists: medDoc.exists,
      version: medData?.version,
      isActive: medData?.isActive,
      isArchived: medData?.isArchived,
    });

    // --- Step 3: Record Dose as TAKEN via Medication Event API ---
    console.log('\nStep 3: Recording 08:00 dose as TAKEN via POST /api/patients/{id}/medications/events...');
    const actionIdTaken = crypto.randomUUID();
    const takenRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caregiverToken}`,
      },
      body: JSON.stringify({
        actionId: actionIdTaken,
        medicationId: medId,
        scheduledDate: today,
        scheduledTime: '08:00',
        status: 'TAKEN',
        source: 'online',
      }),
    });
    const takenData = await takenRes.json();
    console.log('DEBUG takenData:', takenRes.status, takenData);
    recordStep('Step 3: Record Dose as TAKEN', takenRes.status === 201 && takenData.event?.status === 'TAKEN', {
      status: takenRes.status,
      actionId: actionIdTaken,
      actorUid: takenData.event?.actorUid,
      actorRole: takenData.event?.actorRole,
    });

    // --- Step 4: Record Dose as SKIPPED with Mandatory Reason Note ---
    console.log('\nStep 4a: Testing SKIPPED rejection when reason note is missing (Expect 400)...');
    const actionIdSkipNoReason = crypto.randomUUID();
    const skipFailRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caregiverToken}`,
      },
      body: JSON.stringify({
        actionId: actionIdSkipNoReason,
        medicationId: medId,
        scheduledDate: today,
        scheduledTime: '20:00',
        status: 'SKIPPED',
        note: '', // Invalid: missing reason
      }),
    });
    recordStep('Step 4a: SKIPPED Missing Reason Rejected (HTTP 400)', skipFailRes.status === 400, {
      status: skipFailRes.status,
    });

    console.log('Step 4b: Recording 20:00 dose as SKIPPED with documented reason note...');
    const actionIdSkipped = crypto.randomUUID();
    const skipSuccessRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caregiverToken}`,
      },
      body: JSON.stringify({
        actionId: actionIdSkipped,
        medicationId: medId,
        scheduledDate: today,
        scheduledTime: '20:00',
        status: 'SKIPPED',
        note: 'Elder experienced mild stomach sensitivity; skipped per doctor advice.',
      }),
    });
    const skipData = await skipSuccessRes.json();
    recordStep('Step 4b: Record Dose as SKIPPED with Reason', skipSuccessRes.status === 201 && skipData.event?.status === 'SKIPPED', {
      status: skipSuccessRes.status,
      actionId: actionIdSkipped,
      note: skipData.event?.note,
    });

    // --- Step 5: Verify Medication Timeline in Firestore ---
    console.log('\nStep 5: Verifying append-only timeline events in Firestore...');
    const careEventsSnap = await patientRef.collection('care_events').get();
    const eventTypes = careEventsSnap.docs.map((d) => d.data().eventType);
    const hasMedCreated = eventTypes.includes('MEDICATION_CREATED');
    const hasMedTaken = eventTypes.includes('MEDICATION_TAKEN');
    const hasMedSkipped = eventTypes.includes('MEDICATION_SKIPPED');
    recordStep('Step 5: Verify Firestore Care Events Timeline', hasMedCreated && hasMedTaken && hasMedSkipped, {
      totalCareEvents: careEventsSnap.size,
      eventTypes,
      path: `/patients/${PATIENT_ID}/care_events`,
    });

    // --- Step 6: Verify Adherence State Calculation Engine ---
    console.log('\nStep 6: Verifying 4-state adherence calculation via GET /api/patients/{id}/medications/doses...');
    const dosesRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/doses?date=${today}`, {
      headers: { Authorization: `Bearer ${primaryToken}` },
    });
    const dosesData = await dosesRes.json();
    const dose0800 = dosesData.doses?.find((d) => d.scheduledTime === '08:00');
    const dose2000 = dosesData.doses?.find((d) => d.scheduledTime === '20:00');
    const step6Pass = dose0800?.status === 'TAKEN' && dose2000?.status === 'SKIPPED';
    recordStep('Step 6: Adherence State Calculation', step6Pass, {
      status: dosesRes.status,
      metrics: dosesData.metrics,
      dose0800Status: dose0800?.status,
      dose2000Status: dose2000?.status,
    });

    // --- Step 7: Test Duplicate Event Submission (Idempotency) ---
    console.log('\nStep 7: Testing idempotent duplicate rejection using existing actionId...');
    const dupRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caregiverToken}`,
      },
      body: JSON.stringify({
        actionId: actionIdTaken, // Duplicate UUID replay
        medicationId: medId,
        scheduledDate: today,
        scheduledTime: '08:00',
        status: 'TAKEN',
      }),
    });
    const dupData = await dupRes.json();
    recordStep('Step 7: Duplicate Event Idempotency (HTTP 200 isDuplicate)', dupRes.status === 200 && dupData.isDuplicate === true, {
      status: dupRes.status,
      isDuplicate: dupData.isDuplicate,
      message: dupData.message,
    });

    // --- Step 8: Test Stale Schedule Version / Concurrency Collision (HTTP 409) ---
    console.log('\nStep 8a: Updating medication schedule to version 2 (Primary Family)...');
    const patchRes1 = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/${medId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryToken}`,
      },
      body: JSON.stringify({
        expectedVersion: 1, // Valid current version
        dosage: '10mg',
      }),
    });
    const patchData1 = await patchRes1.json();
    console.log(`Medication successfully updated to version ${patchData1.version}`);

    console.log('Step 8b: Testing concurrency collision with stale expectedVersion: 1 (Expect HTTP 409)...');
    const patchRes2 = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/${medId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${primaryToken}`,
      },
      body: JSON.stringify({
        expectedVersion: 1, // Stale! Current version is 2
        dosage: '15mg',
      }),
    });
    const patchData2 = await patchRes2.json();

    console.log('Step 8c: Testing offline event collision against stale prescription version (Expect HTTP 409)...');
    const staleEventRes = await fetch(`${BASE_URL}/api/patients/${PATIENT_ID}/medications/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${caregiverToken}`,
      },
      body: JSON.stringify({
        actionId: crypto.randomUUID(),
        medicationId: medId,
        scheduledDate: today,
        scheduledTime: '08:00',
        status: 'TAKEN',
        expectedVersion: 1, // Stale! Server is version 2
        source: 'offline_sync',
      }),
    });
    const staleEventData = await staleEventRes.json();

    const step8Pass = patchRes2.status === 409 && staleEventRes.status === 409;
    recordStep('Step 8: Stale Schedule Version Concurrency Collision (HTTP 409)', step8Pass, {
      patchStatus: patchRes2.status,
      patchError: patchData2.error,
      eventStatus: staleEventRes.status,
      eventError: staleEventData.error,
    });

  } catch (err) {
    console.error('Workflow 2 Execution Exception:', err);
    recordStep('Execution Exception', false, { message: err.message, stack: err.stack });
  }

  console.log('\n=== WORKFLOW 2 SUMMARY ===');
  console.log(`Passed: ${results.passCount} / ${results.steps.length}`);
  console.log(`Failed: ${results.failCount} / ${results.steps.length}`);
  return results;
}

runWorkflow2();
