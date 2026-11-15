import { adminAuth, adminFirestore } from '@/lib/firebase/admin';
import { CareCircleMember, UserRole } from '@/types/auth';

export class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
  }
}

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
}

/**
 * Extracts and verifies Firebase ID token from Authorization header or cookies.
 * Strictly Node.js server route execution.
 */
export async function verifyAuthUser(request: Request): Promise<AuthenticatedUser> {
  let token: string | null = null;
  let isCookie = false;

  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  }

  if (!token) {
    // Attempt reading from cookie if provided
    const cookieHeader = request.headers.get('cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/session=([^;]+)/);
      if (match) {
        token = match[1];
        isCookie = true;
      }
    }
  }

  if (!token) {
    throw new AuthError('Missing authentication token. Please log in.', 401);
  }

  // 1. Authoritative Session Cookie Verification if token was extracted from cookie
  if (isCookie) {
    try {
      const decodedCookie = await adminAuth().verifySessionCookie(token, true);
      return {
        uid: decodedCookie.uid,
        email: decodedCookie.email,
        name: decodedCookie.name,
      };
    } catch (cookieError: any) {
      if (
        cookieError?.code === 'auth/session-cookie-revoked' ||
        cookieError?.code === 'auth/user-disabled'
      ) {
        throw new AuthError('Your authentication session has been revoked. Please re-authenticate.', 401);
      }
      throw new AuthError('Invalid or expired authentication session. Please re-authenticate.', 401);
    }
  }

  // 2. Authoritative Bearer ID Token Verification
  try {
    // Enable checkRevoked: true to instantaneously reject revoked or disabled tokens
    const decodedToken = await adminAuth().verifyIdToken(token, true);
    return {
      uid: decodedToken.uid,
      email: decodedToken.email,
      name: decodedToken.name,
    };
  } catch (error: any) {
    if (error?.code === 'auth/id-token-revoked' || error?.code === 'auth/user-disabled') {
      throw new AuthError('Your authentication session has been revoked. Please re-authenticate.', 401);
    }
    // Fallback: verify as session cookie if bearer token was formatted as session cookie
    try {
      const decodedCookie = await adminAuth().verifySessionCookie(token, true);
      return {
        uid: decodedCookie.uid,
        email: decodedCookie.email,
        name: decodedCookie.name,
      };
    } catch (_) {}
    throw new AuthError('Invalid or expired authentication session. Please re-authenticate.', 401);
  }
}

export interface VerifiedPatientAccess {
  user: AuthenticatedUser;
  member: CareCircleMember;
  patientId: string;
}

/**
 * Authoritative Server-Side Access Control:
 * Patient-specific membership records in `/patients/{patientId}/members/{userId}`
 * are the authoritative source for access permissions.
 *
 * Checks:
 * 1. Authenticated user identity.
 * 2. Membership in the care circle.
 * 3. Active status (supports instantaneous access revocation without waiting for token refresh).
 * 4. Operation role permissions.
 */
export async function verifyPatientAccess(
  request: Request,
  patientId: string,
  allowedRoles?: UserRole[]
): Promise<VerifiedPatientAccess> {
  const user = await verifyAuthUser(request);

  if (!patientId) {
    throw new AuthError('Patient ID is required.', 400);
  }

  const db = adminFirestore();
  const memberDoc = await db
    .collection('patients')
    .doc(patientId)
    .collection('members')
    .doc(user.uid)
    .get();

  if (!memberDoc.exists) {
    throw new AuthError('You are not an authorized member of this patient care circle.', 403);
  }

  const memberData = memberDoc.data() as CareCircleMember;

  // Enforce instantaneous revocation check
  if (memberData.status !== 'active') {
    throw new AuthError('Your access to this patient care circle has been revoked.', 403);
  }

  // Enforce role permission check if specified
  if (allowedRoles && allowedRoles.length > 0 && !allowedRoles.includes(memberData.role)) {
    throw new AuthError(
      `Permission denied. This operation requires one of: [${allowedRoles.join(', ')}]. Your role is: ${memberData.role}.`,
      403
    );
  }

  return {
    user,
    member: memberData,
    patientId,
  };
}
