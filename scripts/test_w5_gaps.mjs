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
  ? admin.app('w5-gaps-runner')
  : admin.initializeApp({
      projectId,
    }, 'w5-gaps-runner');

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
const PATIENT_ID = 'synth_patient_w5_gaps';

async function runW5Tests() {
  console.log('=================================================================');
  console.log('JEEVASETU WORKFLOW 5 (W5): CARE GAP DETECTION & AUTO-RESOLUTION');
  console.log('=================================================================\n');

  const evidence = {
    testWorkflow: 'W5_CARE_GAP_DETECTION_AND_RESOLUTION',
    patientFixtureId: PATIENT_ID,
    timestamp: new Date().toISOString(),
    steps: [],
  };

  function logStep(num, name, status, details) {
    const entry = { step: num, name, status, details, timestamp: new Date().toISOString() };
    evidence.steps.push(entry);
    console.log(`[STEP ${num}] ${name} -> ${status}`);
    if (details) console.log('       ', JSON.stringify(details));
  }

  // STEP 1: Fixture Setup
  const patientRef = db.collection('patients').doc(PATIENT_ID);
  await patientRef.set({
    id: PATIENT_ID,
    fullName: 'Synthetic Patient W5 Gaps',
    dateOfBirth: '1948-03-15',
    bloodGroup: 'A+',
    timezone: 'Asia/Kolkata',
    allergies: ['Penicillin'],
    chronicConditions: ['Type 2 Diabetes', 'Hypertension'],
    primaryLanguage: 'English',
    emergencyContact: {
      name: testUsers.primary_family.label,
      phone: '+919876543210',
      relation: 'Daughter',
    },
    createdBy: testUsers.primary_family.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await patientRef.collection('members').doc(testUsers.primary_family.uid).set({
    userId: testUsers.primary_family.uid,
    displayName: testUsers.primary_family.label,
    email: testUsers.primary_family.email,
    role: 'primary_family',
    status: 'active',
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await patientRef.collection('members').doc(testUsers.caregiver_a.uid).set({
    userId: testUsers.caregiver_a.uid,
    displayName: testUsers.caregiver_a.label,
    email: testUsers.caregiver_a.email,
    role: 'caregiver',
    status: 'active',
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  logStep(1, 'Patient Fixture Setup', 'PASS', { patientId: PATIENT_ID });

  // STEP 2: Tokens
  const tokenCaregiver = await getAuthToken(testUsers.caregiver_a.email, testUsers.caregiver_a.password);
  const tokenFamily = await getAuthToken(testUsers.primary_family.email, testUsers.primary_family.password);
  logStep(2, 'Token Acquisition', 'PASS', { tokensAcquired: true });

  // STEP 3: Inject Overdue Medication & Overdue Task
  const medId = 'med_w5_metformin';
  await patientRef.collection('medications').doc(medId).set({
    id: medId,
    patientId: PATIENT_ID,
    name: 'Metformin',
    dosage: '500mg',
    form: 'tablet',
    instructions: 'Take after breakfast',
    frequency: 'daily',
    times: ['08:00'], // Scheduled earlier today (>60m overdue)
    startDate: '2026-11-01',
    isActive: true,
    isArchived: false,
    version: 1,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdBy: testUsers.primary_family.uid,
  });

  const taskId = 'task_w5_vitals';
  await patientRef.collection('tasks').doc(taskId).set({
    id: taskId,
    patientId: PATIENT_ID,
    title: 'Morning Blood Pressure Check',
    description: 'Check systolic/diastolic blood pressure before breakfast',
    priority: 'urgent',
    status: 'pending',
    dueDate: '2026-11-14T09:00:00.000Z', // Overdue yesterday
    assignedToUid: testUsers.caregiver_a.uid,
    assignedToName: testUsers.caregiver_a.label,
    assignedByUid: testUsers.primary_family.uid,
    assignedByName: testUsers.primary_family.label,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  logStep(3, 'Inject Overdue Conditions', 'PASS', { medId, taskId });

  // STEP 4: Trigger Care Gap Detection via API
  const gapsRes = await fetch(`${baseUrl}/api/patients/${PATIENT_ID}/gaps`, {
    headers: { 'Authorization': `Bearer ${tokenFamily}` },
  });
  const gapsData = await gapsRes.json();
  const detectedGaps = gapsData.gaps || [];

  const hasMedGap = detectedGaps.some(g => g.type === 'unconfirmed_dose');
  const hasTaskGap = detectedGaps.some(g => g.type === 'overdue_task');
  logStep(4, 'Evaluate Care Gaps Detection', (hasMedGap && hasTaskGap) ? 'PASS' : 'FAIL', {
    totalGaps: detectedGaps.length,
    hasMedGap,
    hasTaskGap,
  });

  // STEP 5: Apply Corrective Action
  // 5A: Confirm Dose as TAKEN
  const today = new Date().toISOString().slice(0, 10);
  const doseRes = await fetch(`${baseUrl}/api/patients/${PATIENT_ID}/medications/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tokenCaregiver}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      actionId: crypto.randomUUID(),
      medicationId: medId,
      scheduledDate: today,
      scheduledTime: '08:00',
      status: 'TAKEN',
      source: 'online',
    }),
  });

  // 5B: Complete Overdue Task
  const taskRes = await fetch(`${baseUrl}/api/patients/${PATIENT_ID}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${tokenCaregiver}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'completed' }),
  });

  logStep(5, 'Apply Corrective Actions', (doseRes.status === 201 && taskRes.status === 200) ? 'PASS' : 'FAIL', {
    doseStatus: doseRes.status,
    taskStatus: taskRes.status,
  });

  // STEP 6: Re-evaluate Gaps (Automatic Resolution Verification)
  const postRes = await fetch(`${baseUrl}/api/patients/${PATIENT_ID}/gaps`, {
    headers: { 'Authorization': `Bearer ${tokenFamily}` },
  });
  const postData = await postRes.json();
  const postGaps = postData.gaps || [];
  const remainingMedOrTaskGaps = postGaps.filter(g => g.type === 'unconfirmed_dose' || g.type === 'overdue_task');
  logStep(6, 'Verify Auto-Resolution', remainingMedOrTaskGaps.length === 0 ? 'PASS' : 'FAIL', {
    remainingTargetGaps: remainingMedOrTaskGaps.length,
    allRemainingGaps: postGaps.length,
  });

  // STEP 7: Audit Event Trail Verification
  const timelineRes = await fetch(`${baseUrl}/api/patients/${PATIENT_ID}/timeline`, {
    headers: { 'Authorization': `Bearer ${tokenFamily}` },
  });
  const timelineData = await timelineRes.json();
  const events = timelineData.events || [];
  const hasMedTakenEvent = events.some(e => e.eventType === 'MEDICATION_TAKEN');
  const hasTaskCompletedEvent = events.some(e => e.eventType === 'TASK_COMPLETED');
  logStep(7, 'Timeline Audit Trail', (hasMedTakenEvent && hasTaskCompletedEvent) ? 'PASS' : 'FAIL', {
    hasMedTakenEvent,
    hasTaskCompletedEvent,
    totalEvents: events.length,
  });

  // STEP 8: Idempotency of Second Evaluation
  const recheckRes = await fetch(`${baseUrl}/api/patients/${PATIENT_ID}/gaps`, {
    headers: { 'Authorization': `Bearer ${tokenFamily}` },
  });
  const recheckData = await recheckRes.json();
  logStep(8, 'Idempotency of Care Gap Evaluation', recheckData.gaps?.length === postGaps.length ? 'PASS' : 'FAIL', {
    initialPostCount: postGaps.length,
    recheckCount: recheckData.gaps?.length,
  });

  console.log('\n=== FINAL W5 TEST SUMMARY ===');
  console.table(evidence.steps);
}

runW5Tests().catch(console.error);
