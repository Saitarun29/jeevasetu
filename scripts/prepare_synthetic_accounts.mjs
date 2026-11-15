import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import admin from 'firebase-admin';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

// 1. Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const lines = fs.readFileSync(envPath, 'utf8').split('\n');
const env = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const k = trimmed.slice(0, idx).trim();
    let v = trimmed.slice(idx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    env[k] = v;
  }
}

const googleAppCreds = env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;
const adminProjectId = env.FIREBASE_PROJECT_ID;
const clientApiKey = env.NEXT_PUBLIC_FIREBASE_API_KEY;
const clientProjectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (googleAppCreds) {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(googleAppCreds);
}

// 2. Initialize Admin & Client SDKs
const adminApp = admin.initializeApp({
  projectId: adminProjectId || clientProjectId
}, 'phase4-account-prep');
const adminAuth = adminApp.auth();
const adminDb = adminApp.firestore();

const clientConfig = {
  apiKey: clientApiKey,
  authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: clientProjectId,
  storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.NEXT_PUBLIC_FIREBASE_APP_ID
};

const clientApp = getApps().length > 0 ? getApp() : initializeApp(clientConfig, 'phase4-client-test');
const clientAuth = getAuth(clientApp);

// 3. Define the 4 synthetic identities
const syntheticIdentities = [
  {
    key: 'primary_family',
    label: 'Synthetic Primary Family',
    email: 'synth.family.primary@example.com',
    role: 'primary_family'
  },
  {
    key: 'caregiver_a',
    label: 'Synthetic Caregiver Alpha',
    email: 'synth.caregiver.alpha@example.com',
    role: 'caregiver'
  },
  {
    key: 'caregiver_b',
    label: 'Synthetic Caregiver Beta',
    email: 'synth.caregiver.beta@example.com',
    role: 'caregiver'
  },
  {
    key: 'unauthorized_user',
    label: 'Synthetic Unauthorized User',
    email: 'synth.unauthorized.user@example.com',
    role: null
  }
];

function generateSecurePassword() {
  // Strong random password with letters, digits, symbols
  return 'JvS-' + crypto.randomBytes(12).toString('base64url') + '!9a';
}

async function getOrCreateUser(identity, password) {
  let userRecord;
  try {
    userRecord = await adminAuth.getUserByEmail(identity.email);
    // Update password and displayName to ensure consistent test credentials
    await adminAuth.updateUser(userRecord.uid, {
      password,
      displayName: identity.label
    });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      userRecord = await adminAuth.createUser({
        email: identity.email,
        password,
        displayName: identity.label,
        emailVerified: true
      });
    } else {
      throw err;
    }
  }
  return userRecord;
}

async function run() {
  const accountResults = [];
  const secureCredentials = {};

  // Step A: Create/Update users in Firebase Auth
  for (const ident of syntheticIdentities) {
    const password = generateSecurePassword();
    const userRecord = await getOrCreateUser(ident, password);

    // Verify account existence in Admin SDK
    const verifiedUser = await adminAuth.getUser(userRecord.uid);

    // Verify email/password sign-in against live Firebase Auth client SDK
    let signInSuccess = false;
    let tokenMinted = false;
    let authError = null;

    try {
      const userCredential = await signInWithEmailAndPassword(clientAuth, ident.email, password);
      signInSuccess = Boolean(userCredential && userCredential.user);
      const idToken = await userCredential.user.getIdToken();
      tokenMinted = Boolean(idToken && idToken.length > 50);
    } catch (e) {
      authError = e.message || String(e);
    }

    secureCredentials[ident.key] = {
      uid: userRecord.uid,
      email: ident.email,
      password, // Stored ONLY in secure external file
      role: ident.role,
      label: ident.label
    };

    accountResults.push({
      key: ident.key,
      label: ident.label,
      email: ident.email,
      uid: userRecord.uid,
      expectedRole: ident.role,
      adminVerified: Boolean(verifiedUser && verifiedUser.uid === userRecord.uid),
      signInTested: signInSuccess,
      idTokenMinted: tokenMinted,
      authError
    });
  }

  // Step B: Save credentials outside the repository
  const secureExtDir = path.resolve('C:/Users/ADMIN/.gemini/antigravity/brain/5f448a1d-4eb1-4e59-96eb-4cb9e4ada9b7/scratch');
  if (!fs.existsSync(secureExtDir)) {
    fs.mkdirSync(secureExtDir, { recursive: true });
  }
  const secureCredPath = path.join(secureExtDir, 'synthetic_test_credentials.json');
  fs.writeFileSync(secureCredPath, JSON.stringify(secureCredentials, null, 2), { encoding: 'utf8', mode: 0o600 });

  // Also save to user keys directory if it exists
  const userKeysDir = path.resolve('C:/Users/ADMIN/.keys');
  if (fs.existsSync(userKeysDir)) {
    fs.writeFileSync(path.join(userKeysDir, 'synthetic_test_credentials.json'), JSON.stringify(secureCredentials, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  // Step C: Create synthetic patient profile in Firestore
  const primaryUser = secureCredentials['primary_family'];
  const caregiverA = secureCredentials['caregiver_a'];
  const caregiverB = secureCredentials['caregiver_b'];

  const patientRef = adminDb.collection('patients').doc();
  const patientId = patientRef.id;
  const now = admin.firestore.FieldValue.serverTimestamp();

  const patientData = {
    id: patientId,
    fullName: 'Synthetic Patient Ramanathan (Phase 4 Test)',
    dateOfBirth: '1948-05-12',
    bloodGroup: 'O+',
    timezone: 'Asia/Kolkata',
    allergies: ['Penicillin (Synthetic)'],
    chronicConditions: ['Hypertension (Synthetic)'],
    primaryLanguage: 'English',
    emergencyContact: {
      name: 'Synthetic Emergency Contact',
      phone: '+919876543210',
      relation: 'Daughter'
    },
    notes: 'Synthetic patient profile for JEEVASETU automated acceptance tests.',
    createdBy: primaryUser.uid,
    createdAt: now,
    updatedAt: now
  };

  const batch = adminDb.batch();

  // 1. Patient Doc
  batch.set(patientRef, patientData);

  // 2. Primary Family Membership
  const primaryMemberRef = patientRef.collection('members').doc(primaryUser.uid);
  batch.set(primaryMemberRef, {
    userId: primaryUser.uid,
    email: primaryUser.email,
    displayName: primaryUser.label,
    role: 'primary_family',
    status: 'active',
    joinedAt: now,
    invitedBy: primaryUser.uid
  });

  const primaryAccessRef = adminDb.collection('users').doc(primaryUser.uid).collection('accessible_patients').doc(patientId);
  batch.set(primaryAccessRef, {
    patientId,
    fullName: patientData.fullName,
    role: 'primary_family',
    status: 'active',
    linkedAt: now
  });

  // 3. Caregiver A Membership
  const cgAMemberRef = patientRef.collection('members').doc(caregiverA.uid);
  batch.set(cgAMemberRef, {
    userId: caregiverA.uid,
    email: caregiverA.email,
    displayName: caregiverA.label,
    role: 'caregiver',
    status: 'active',
    joinedAt: now,
    invitedBy: primaryUser.uid
  });

  const cgAAccessRef = adminDb.collection('users').doc(caregiverA.uid).collection('accessible_patients').doc(patientId);
  batch.set(cgAAccessRef, {
    patientId,
    fullName: patientData.fullName,
    role: 'caregiver',
    status: 'active',
    linkedAt: now
  });

  // 4. Caregiver B Membership
  const cgBMemberRef = patientRef.collection('members').doc(caregiverB.uid);
  batch.set(cgBMemberRef, {
    userId: caregiverB.uid,
    email: caregiverB.email,
    displayName: caregiverB.label,
    role: 'caregiver',
    status: 'active',
    joinedAt: now,
    invitedBy: primaryUser.uid
  });

  const cgBAccessRef = adminDb.collection('users').doc(caregiverB.uid).collection('accessible_patients').doc(patientId);
  batch.set(cgBAccessRef, {
    patientId,
    fullName: patientData.fullName,
    role: 'caregiver',
    status: 'active',
    linkedAt: now
  });

  // Note: Unauthorized user receives NO membership and NO document under users/{uid}/accessible_patients.

  // 5. Initial audit event
  const careEventRef = patientRef.collection('care_events').doc();
  batch.set(careEventRef, {
    id: careEventRef.id,
    patientId,
    eventType: 'PATIENT_CREATED',
    timestamp: now,
    actorUid: primaryUser.uid,
    actorName: primaryUser.label,
    actorRole: 'primary_family',
    action: `Created synthetic healthcare profile for ${patientData.fullName}`,
    entitySnapshot: {
      fullName: patientData.fullName,
      dateOfBirth: patientData.dateOfBirth,
      isSynthetic: true
    }
  });

  await batch.commit();

  // Step D: Verify Memberships and Confirm Unauthorized User Isolation
  const membersSnap = await patientRef.collection('members').get();
  const membershipSummary = membersSnap.docs.map(d => ({
    uid: d.id,
    role: d.data().role,
    status: d.data().status
  }));

  const unauthAccessSnap = await adminDb.collection('users').doc(secureCredentials['unauthorized_user'].uid).collection('accessible_patients').get();
  const unauthMemberDoc = await patientRef.collection('members').doc(secureCredentials['unauthorized_user'].uid).get();

  const isolationVerified = unauthAccessSnap.empty && !unauthMemberDoc.exists;

  // Output non-sensitive summary
  console.log(JSON.stringify({
    success: true,
    patient: {
      patientId,
      fullName: patientData.fullName,
      createdBy: primaryUser.uid
    },
    accounts: accountResults,
    membershipSummary,
    unauthorizedUserIsolation: {
      verified: isolationVerified,
      accessiblePatientCount: unauthAccessSnap.size,
      hasMemberDoc: unauthMemberDoc.exists
    },
    credentialsSavedPath: secureCredPath
  }, null, 2));
}

run().catch(err => {
  console.error(JSON.stringify({ error: err.message || String(err) }));
  process.exit(1);
});
