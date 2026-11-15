import * as admin from 'firebase-admin';

// Verify runtime is Node.js
if (typeof window !== 'undefined') {
  throw new Error('Firebase Admin SDK must only be loaded in server-side Node.js environments.');
}

function formatPrivateKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  return key.replace(/\\n/g, '\n');
}

export function getFirebaseAdminApp(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = formatPrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  let app: admin.app.App;
  if (clientEmail && privateKey) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });
  } else {
    // Fallback to Application Default Credentials (e.g. running on Cloud Run with IAM service account)
    app = admin.initializeApp({
      projectId,
    });
  }

  try {
    app.firestore().settings({ ignoreUndefinedProperties: true });
  } catch (_) {}

  return app;
}

export const adminAuth = () => getFirebaseAdminApp().auth();
export const adminFirestore = () => getFirebaseAdminApp().firestore();
