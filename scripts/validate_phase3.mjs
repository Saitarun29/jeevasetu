import fs from 'fs';
import path from 'path';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// 1. Read .env.local safely
const envPath = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.log(JSON.stringify({ error: '.env.local not found' }));
  process.exit(1);
}

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

// 2. Validate Client Variables
const clientKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID'
];

const clientStatus = clientKeys.map(key => {
  const val = env[key] || '';
  const isSet = Boolean(val && val.length > 0 && !val.includes('AIzaSyExample') && val !== 'demo-api-key');
  let formatValid = false;
  let reason = '';
  if (!isSet) {
    reason = 'Empty or demo value';
  } else if (key === 'NEXT_PUBLIC_FIREBASE_API_KEY') {
    formatValid = val.startsWith('AIza') && val.length >= 35;
    reason = formatValid ? 'Standard Web API key format' : 'Unexpected key prefix or length';
  } else if (key === 'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN') {
    formatValid = val.endsWith('.firebaseapp.com') || val.includes('.');
    reason = formatValid ? 'Valid domain format' : 'Domain missing dot or invalid suffix';
  } else if (key === 'NEXT_PUBLIC_FIREBASE_PROJECT_ID') {
    formatValid = /^[a-z0-9-]+$/.test(val);
    reason = formatValid ? 'Standard GCP project id format' : 'Contains invalid characters';
  } else if (key === 'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') {
    formatValid = val.endsWith('.appspot.com') || val.endsWith('.firebasestorage.app');
    reason = formatValid ? 'Standard storage bucket domain' : 'Unexpected bucket suffix';
  } else if (key === 'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID') {
    formatValid = /^\d+$/.test(val);
    reason = formatValid ? 'Numeric sender ID' : 'Non-numeric sender ID';
  } else if (key === 'NEXT_PUBLIC_FIREBASE_APP_ID') {
    formatValid = val.startsWith('1:') && val.includes(':web:');
    reason = formatValid ? 'Standard Web App ID format' : 'Unexpected App ID structure';
  }
  return {
    key,
    status: isSet && formatValid ? 'SET' : (isSet ? 'INVALID FORMAT' : 'MISSING'),
    length: val.length,
    reason
  };
});

// 3. Test Firebase Client Initialization
let clientInitSuccess = false;
let clientAuthSuccess = false;
let clientError = null;

try {
  const firebaseConfig = {
    apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.NEXT_PUBLIC_FIREBASE_APP_ID
  };

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig, 'diagnostic-app');
  clientInitSuccess = Boolean(app && app.name);
  const auth = getAuth(app);
  clientAuthSuccess = Boolean(auth && auth.name);
} catch (err) {
  clientError = err.message || String(err);
}

// 4. Admin Credentials Check
const adminProjectId = env.FIREBASE_PROJECT_ID;
const adminClientEmail = env.FIREBASE_CLIENT_EMAIL;
const adminPrivateKey = env.FIREBASE_PRIVATE_KEY;
const googleAppCreds = env.GOOGLE_APPLICATION_CREDENTIALS || process.env.GOOGLE_APPLICATION_CREDENTIALS;

const hasDirectAdminCreds = Boolean(
  adminProjectId && adminProjectId.length > 0 &&
  adminClientEmail && adminClientEmail.length > 0 &&
  adminPrivateKey && adminPrivateKey.length > 0
);

const hasAdcCreds = Boolean(googleAppCreds && fs.existsSync(googleAppCreds));

// Consistency check between client and admin project ID
let projectIdConsistent = null;
if (hasDirectAdminCreds) {
  projectIdConsistent = (adminProjectId === env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
}

console.log(JSON.stringify({
  clientVariables: clientStatus,
  clientInit: {
    initialized: clientInitSuccess,
    authAvailable: clientAuthSuccess,
    error: clientError
  },
  adminStatus: {
    hasDirectServiceAccount: hasDirectAdminCreds,
    hasApplicationDefaultCredentials: hasAdcCreds,
    projectIdConfigured: Boolean(adminProjectId && adminProjectId.length > 0),
    clientEmailConfigured: Boolean(adminClientEmail && adminClientEmail.length > 0),
    privateKeyConfigured: Boolean(adminPrivateKey && adminPrivateKey.length > 0),
    projectIdMatchesClient: projectIdConsistent
  }
}, null, 2));
