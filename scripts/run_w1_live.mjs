import { readFileSync } from 'fs';
import path from 'path';
import admin from 'firebase-admin';
import * as crypto from 'crypto';

// 1. Load Environment & Credentials
const envContent = readFileSync('.env.local', 'utf8');
const env = Object.fromEntries(
  envContent.split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => {
      const idx = l.indexOf('=');
      return [l.slice(0, idx).trim(), l.slice(idx + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

if (env.GOOGLE_APPLICATION_CREDENTIALS) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(env.GOOGLE_APPLICATION_CREDENTIALS);
}

const credsPath = 'C:/Users/ADMIN/.gemini/antigravity/brain/5f448a1d-4eb1-4e59-96eb-4cb9e4ada9b7/scratch/synthetic_test_credentials.json';
const creds = JSON.parse(readFileSync(credsPath, 'utf8'));

if (admin.apps.length === 0) {
  admin.initializeApp({
    projectId: env.FIREBASE_PROJECT_ID || env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  }, 'w1-live-runner');
}
const db = admin.app('w1-live-runner').firestore();
const API_KEY = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const BASE_URL = 'http://localhost:3005';
const PEPPER = env.INVITATION_PEPPER;

async function getIdToken(email, password) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Auth failed for ${email}: ${JSON.stringify(data)}`);
  return data.idToken;
}

function hashPasscode(passcode, patientId, invitationId) {
  return crypto.createHmac('sha256', PEPPER)
    .update(`${passcode.trim()}:${patientId}:${invitationId}`)
    .digest('hex');
}

async function runW1() {
  console.log('=== STARTING WORKFLOW 1 (W1) LIVE INTEGRATION TESTING ===');
  const results = [];

  // Step 0: Auth Tokens
  const primaryToken = await getIdToken(creds.primary_family.email, creds.primary_family.password);
  const caregiverToken = await getIdToken(creds.caregiver_a.email, creds.caregiver_a.password);
  const unauthToken = await getIdToken(creds.unauthorized_user.email, creds.unauthorized_user.password);
  console.log('✓ Firebase ID tokens obtained for all synthetic accounts.');

  // Create Isolated Patient Fixture
  const fixturePatientId = 'synth_patient_w1_invitations';
  const patientRef = db.collection('patients').doc(fixturePatientId);
  await patientRef.set({
    id: fixturePatientId,
    fullName: 'Synthetic Patient W1',
    dateOfBirth: '1948-05-12',
    bloodGroup: 'B+',
    timezone: 'Asia/Kolkata',
    allergies: ['Penicillin'],
    chronicConditions: ['Hypertension'],
    primaryLanguage: 'English',
    emergencyContact: { name: 'Emergency Family', phone: '+919876543210', relation: 'Son' },
    address: '123 Confidential Residence St, Bangalore',
    notes: 'Private medical notes - primary family confidential',
    createdBy: creds.primary_family.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await patientRef.collection('members').doc(creds.primary_family.uid).set({
    userId: creds.primary_family.uid,
    email: creds.primary_family.email,
    displayName: 'Primary Family Tester',
    role: 'primary_family',
    status: 'active',
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    invitedBy: creds.primary_family.uid,
  });
  console.log(`✓ Fixture patient created: /patients/${fixturePatientId}`);

  // 1. Create Caregiver Invitation
  const rawPasscode = '654321';
  const inviteRef = db.collection('invitations').doc();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await inviteRef.set({
    id: inviteRef.id,
    patientId: fixturePatientId,
    passcodeHash: hashPasscode(rawPasscode, fixturePatientId, inviteRef.id),
    targetRole: 'caregiver',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
    createdBy: creds.primary_family.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log(`✓ Step 1: Created invitation ${inviteRef.id} with passcode: ${rawPasscode}`);
  results.push({ step: 1, action: 'Create Caregiver Invitation', status: 'PASS', invitationId: inviteRef.id });

  // 2. Redeem Invitation via Caregiver Alpha
  const redeemRes = await fetch(`${BASE_URL}/api/invitations/redeem`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${caregiverToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: rawPasscode, invitationId: inviteRef.id }),
  });
  const redeemData = await redeemRes.json();
  console.log(`✓ Step 2: Redeem invitation HTTP ${redeemRes.status}`, redeemData);
  results.push({ step: 2, action: 'Redeem Invitation', httpStatus: redeemRes.status, status: redeemRes.status === 200 ? 'PASS' : 'FAIL' });

  // 3. Verify Active Membership in Firestore
  const memberDoc = await patientRef.collection('members').doc(creds.caregiver_a.uid).get();
  const isMemberActive = memberDoc.exists && memberDoc.data()?.status === 'active' && memberDoc.data()?.role === 'caregiver';
  console.log(`✓ Step 3: Member active in Firestore: ${isMemberActive}`);
  results.push({ step: 3, action: 'Verify Active Membership', status: isMemberActive ? 'PASS' : 'FAIL' });

  // 4. Caregiver Alpha Reads Patient Data (verify sensitive redaction)
  const getPatientRes = await fetch(`${BASE_URL}/api/patients/${fixturePatientId}`, {
    headers: { 'Authorization': `Bearer ${caregiverToken}` },
  });
  const patientData = await getPatientRes.json();
  const addressRedacted = patientData.patient?.address === undefined;
  const notesRedacted = patientData.patient?.notes === undefined;
  console.log(`✓ Step 4: Access patient HTTP ${getPatientRes.status}. Redaction: address=${addressRedacted}, notes=${notesRedacted}`);
  results.push({ step: 4, action: 'Caregiver Patient Access', httpStatus: getPatientRes.status, redactionVerified: addressRedacted && notesRedacted, status: getPatientRes.status === 200 && addressRedacted ? 'PASS' : 'FAIL' });

  // 5. Primary Family Revokes Caregiver Alpha
  const revokeRes = await fetch(`${BASE_URL}/api/patients/${fixturePatientId}/members`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${primaryToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId: creds.caregiver_a.uid }),
  });
  console.log(`✓ Step 5: Revoke caregiver HTTP ${revokeRes.status}`);
  results.push({ step: 5, action: 'Revoke Caregiver Access', httpStatus: revokeRes.status, status: revokeRes.status === 200 ? 'PASS' : 'FAIL' });

  // 6. Verify Immediate Access Loss (HTTP 403)
  const getPostRevokeRes = await fetch(`${BASE_URL}/api/patients/${fixturePatientId}`, {
    headers: { 'Authorization': `Bearer ${caregiverToken}` },
  });
  console.log(`✓ Step 6: Post-revoke access HTTP ${getPostRevokeRes.status}`);
  results.push({ step: 6, action: 'Instantaneous Revocation Verification', httpStatus: getPostRevokeRes.status, status: getPostRevokeRes.status === 403 ? 'PASS' : 'FAIL' });

  // 7. Test Expired Invitation (HTTP 410 / 404)
  const expiredInviteRef = db.collection('invitations').doc();
  const pastDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await expiredInviteRef.set({
    id: expiredInviteRef.id,
    patientId: fixturePatientId,
    passcodeHash: hashPasscode('112233', fixturePatientId, expiredInviteRef.id),
    targetRole: 'caregiver',
    status: 'pending',
    attempts: 0,
    maxAttempts: 5,
    expiresAt: admin.firestore.Timestamp.fromDate(pastDate),
    createdBy: creds.primary_family.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const expiredRes = await fetch(`${BASE_URL}/api/invitations/redeem`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${caregiverToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: '112233', invitationId: expiredInviteRef.id }),
  });
  console.log(`✓ Step 7: Expired invitation HTTP ${expiredRes.status}`);
  results.push({ step: 7, action: 'Expired Invitation Rejection', httpStatus: expiredRes.status, status: (expiredRes.status === 410 || expiredRes.status === 404) ? 'PASS' : 'FAIL' });

  // 8. Test Invalid Passcode (HTTP 404)
  const invalidPasscodeRes = await fetch(`${BASE_URL}/api/invitations/redeem`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${caregiverToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: '999999', invitationId: inviteRef.id }),
  });
  console.log(`✓ Step 8: Invalid passcode HTTP ${invalidPasscodeRes.status}`);
  results.push({ step: 8, action: 'Invalid Passcode Rejection', httpStatus: invalidPasscodeRes.status, status: invalidPasscodeRes.status === 404 ? 'PASS' : 'FAIL' });

  // 9. Test Repeated Redemption (HTTP 409 / 404)
  const replayRes = await fetch(`${BASE_URL}/api/invitations/redeem`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${caregiverToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode: rawPasscode, invitationId: inviteRef.id }),
  });
  console.log(`✓ Step 9: Replay redemption HTTP ${replayRes.status}`);
  results.push({ step: 9, action: 'Replay Redemption Rejection', httpStatus: replayRes.status, status: (replayRes.status === 409 || replayRes.status === 404) ? 'PASS' : 'FAIL' });

  // 10. Test Unauthorized User (HTTP 403)
  const unauthRes = await fetch(`${BASE_URL}/api/patients/${fixturePatientId}`, {
    headers: { 'Authorization': `Bearer ${unauthToken}` },
  });
  console.log(`✓ Step 10: Unauthorized user access HTTP ${unauthRes.status}`);
  results.push({ step: 10, action: 'Unauthorized User Rejection', httpStatus: unauthRes.status, status: unauthRes.status === 403 ? 'PASS' : 'FAIL' });

  console.log('\n=== FINAL W1 TEST SUMMARY ===');
  console.table(results);
}

runW1().catch(console.error);
