export type UserRole = 'primary_family' | 'family_member' | 'caregiver' | 'patient';

export type MembershipStatus = 'active' | 'revoked';

export interface CareCircleMember {
  userId: string;
  email: string;
  displayName: string;
  role: UserRole;
  status: MembershipStatus;
  joinedAt: string; // ISO string or Firestore timestamp representation
  invitedBy?: string;
}

export type InvitationStatus = 'pending' | 'redeemed' | 'expired';

export interface Invitation {
  id: string;
  patientId: string;
  passcodeHash: string; // SHA-256
  targetRole: 'family_member' | 'caregiver';
  status: InvitationStatus;
  attempts: number;
  maxAttempts: number;
  expiresAt: string;
  createdBy: string;
  createdAt: string;
  redeemedBy?: string;
  redeemedAt?: string;
}

export interface AuthSession {
  uid: string;
  email?: string;
  displayName?: string;
}

export interface PatientAccessContext {
  userId: string;
  patientId: string;
  role: UserRole;
  status: MembershipStatus;
}
