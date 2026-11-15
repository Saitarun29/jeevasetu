// Safe validation script: verifies Firebase config without printing any secrets or keys
import fs from 'fs';
import path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');

if (!fs.existsSync(envPath)) {
  console.log(JSON.stringify({ status: 'ERROR', message: '.env.local not found' }));
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const lines = envContent.split('\n');

const configMap = {};
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const idx = trimmed.indexOf('=');
  if (idx !== -1) {
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim();
    configMap[key] = val;
  }
}

const requiredKeys = [
  'NEXT_PUBLIC_FIREBASE_API_KEY',
  'NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
  'NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'NEXT_PUBLIC_FIREBASE_APP_ID',
];

const checklist = requiredKeys.map((key) => {
  const val = configMap[key];
  const isSet = Boolean(val && val.length > 0 && !val.includes('AIzaSyExample') && val !== 'demo-api-key');
  return {
    key,
    configured: isSet,
    length: isSet ? val.length : 0,
  };
});

const allConfigured = checklist.every((item) => item.configured);

console.log(JSON.stringify({
  ready: allConfigured,
  checklist,
  invitationPepperSet: Boolean(configMap['INVITATION_PEPPER'] && configMap['INVITATION_PEPPER'].length >= 32),
  cronSecretSet: Boolean(configMap['CRON_SECRET'] && configMap['CRON_SECRET'].length >= 32),
  adminCredentialsSet: Boolean(
    configMap['FIREBASE_PROJECT_ID'] &&
    configMap['FIREBASE_CLIENT_EMAIL'] &&
    configMap['FIREBASE_PRIVATE_KEY']
  ),
}, null, 2));
