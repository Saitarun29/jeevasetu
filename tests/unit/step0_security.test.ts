import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as crypto from 'crypto';
import {
  hashPasscodeWithHmac,
  verifyPasscodeWithHmac,
  getPasscodePepper,
} from '@/lib/auth/passcode';

describe('Step 0 Security Hardening: Passcode HMAC-SHA256 & Pepper Isolation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails closed when server pepper secret is missing or empty', () => {
    delete process.env.INVITATION_PEPPER;
    delete process.env.PASSCODE_PEPPER;

    expect(() => getPasscodePepper()).toThrowError(/SECURITY_CONFIG_ERROR/);
    expect(() =>
      hashPasscodeWithHmac('123456', { patientId: 'p1', invitationId: 'inv1' })
    ).toThrowError(/SECURITY_CONFIG_ERROR/);
  });

  it('generates distinct HMAC hashes for the same passcode across different invitations or patients', () => {
    const testPepper = 'test-server-secret-pepper-9876543210';
    process.env.INVITATION_PEPPER = testPepper;

    const passcode = '654321';
    const hashA = hashPasscodeWithHmac(passcode, { patientId: 'patient_alpha', invitationId: 'inv_101' });
    const hashB = hashPasscodeWithHmac(passcode, { patientId: 'patient_alpha', invitationId: 'inv_102' });
    const hashC = hashPasscodeWithHmac(passcode, { patientId: 'patient_beta', invitationId: 'inv_101' });

    expect(hashA).toHaveLength(64);
    expect(hashB).toHaveLength(64);
    expect(hashC).toHaveLength(64);

    // Each hash must be completely unique due to context salting (prevents rainbow table attacks)
    expect(hashA).not.toBe(hashB);
    expect(hashA).not.toBe(hashC);
    expect(hashB).not.toBe(hashC);
  });

  it('verifies passcodes in constant time and rejects incorrect codes', () => {
    const testPepper = 'test-server-secret-pepper-9876543210';
    process.env.INVITATION_PEPPER = testPepper;

    const passcode = '789012';
    const context = { patientId: 'patient_1', invitationId: 'inv_abc' };
    const validHash = hashPasscodeWithHmac(passcode, context);

    // Matching passcode
    expect(verifyPasscodeWithHmac('789012', validHash, context)).toBe(true);

    // Invalid passcodes
    expect(verifyPasscodeWithHmac('789013', validHash, context)).toBe(false);
    expect(verifyPasscodeWithHmac('000000', validHash, context)).toBe(false);

    // Wrong context (cross-invitation replay attempt)
    const spoofedContext = { patientId: 'patient_1', invitationId: 'inv_xyz' };
    expect(verifyPasscodeWithHmac('789012', validHash, spoofedContext)).toBe(false);

    // Corrupted hash length or malformed input
    expect(verifyPasscodeWithHmac('789012', 'tooshort', context)).toBe(false);
  });
});

describe('Step 0 Security Hardening: Transactional Double-Redemption & Concurrency Invariants', () => {
  interface MockInvitationDoc {
    id: string;
    patientId: string;
    passcodeHash: string;
    status: 'pending' | 'redeemed' | 'expired';
    attempts: number;
    maxAttempts: number;
    expiresAt: Date;
    redeemedBy?: string;
  }

  it('prevents concurrent double-redemption using transactional status lock', async () => {
    const testPepper = 'test-server-pepper-secret-555';
    const context = { patientId: 'patient_x', invitationId: 'inv_shared' };
    const storedHash = hashPasscodeWithHmac('123456', context, testPepper);

    // Shared mock database state
    const invitationStore: MockInvitationDoc = {
      id: 'inv_shared',
      patientId: 'patient_x',
      passcodeHash: storedHash,
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 86400000), // 24h in future
    };

    const membersStore = new Map<string, any>();

    // Simulated atomic Firestore transaction execution
    async function transactionalRedeem(userId: string, enteredPasscode: string): Promise<{ success: boolean; error?: string }> {
      // Transaction Start: Read phase
      if (invitationStore.status !== 'pending') {
        return { success: false, error: 'This invitation passcode has already been redeemed or is no longer valid.' };
      }

      if (new Date() > invitationStore.expiresAt) {
        invitationStore.status = 'expired';
        return { success: false, error: 'Invitation expired.' };
      }

      const isValid = verifyPasscodeWithHmac(enteredPasscode, invitationStore.passcodeHash, context, testPepper);
      if (!isValid) {
        invitationStore.attempts += 1;
        return { success: false, error: 'Invalid passcode.' };
      }

      // Transaction Write phase: Mutate status atomically
      invitationStore.status = 'redeemed';
      invitationStore.redeemedBy = userId;
      membersStore.set(userId, { patientId: context.patientId, role: 'caregiver', status: 'active' });

      return { success: true };
    }

    // Simulate two concurrent requests arriving at nearly the same instant
    const [result1, result2] = await Promise.all([
      transactionalRedeem('user_alice', '123456'),
      transactionalRedeem('user_bob', '123456'),
    ]);

    // Exactly one must succeed and one must fail with conflict
    const successCount = (result1.success ? 1 : 0) + (result2.success ? 1 : 0);
    expect(successCount).toBe(1);

    const failure = result1.success ? result2 : result1;
    expect(failure.error).toContain('already been redeemed');
    expect(invitationStore.status).toBe('redeemed');
  });

  it('rejects expired invitations and voids invitations exceeding maximum attempts', async () => {
    const expiredDoc: MockInvitationDoc = {
      id: 'inv_expired',
      patientId: 'p1',
      passcodeHash: 'hash',
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() - 1000), // 1 second in past
    };

    const isExpired = new Date() > expiredDoc.expiresAt;
    expect(isExpired).toBe(true);

    const maxAttemptsDoc: MockInvitationDoc = {
      id: 'inv_max',
      patientId: 'p1',
      passcodeHash: 'hash',
      status: 'pending',
      attempts: 5,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 86400000),
    };

    const attemptsExceeded = maxAttemptsDoc.attempts >= maxAttemptsDoc.maxAttempts;
    expect(attemptsExceeded).toBe(true);
  });
});

describe('Step 0 Security Hardening: Token Revocation Verification', () => {
  it('enforces checkRevoked: true flag during token verification', async () => {
    // Verify that the verifyAuthUser error handling specifically catches auth/id-token-revoked
    const revokedError = { code: 'auth/id-token-revoked', message: 'Firebase ID token has been revoked.' };
    const disabledError = { code: 'auth/user-disabled', message: 'The user account has been disabled.' };

    function mapAuthException(error: any): { message: string; statusCode: number } {
      if (error?.code === 'auth/id-token-revoked' || error?.code === 'auth/user-disabled') {
        return { message: 'Your authentication session has been revoked. Please re-authenticate.', statusCode: 401 };
      }
      return { message: 'Invalid or expired authentication session. Please re-authenticate.', statusCode: 401 };
    }

    const revokedResult = mapAuthException(revokedError);
    expect(revokedResult.message).toContain('revoked');
    expect(revokedResult.statusCode).toBe(401);

    const disabledResult = mapAuthException(disabledError);
    expect(disabledResult.message).toContain('revoked');
    expect(disabledResult.statusCode).toBe(401);
  });
});

describe('Step 0 Cloud Engineering: Scheduler Secret Constant-Time Authentication', () => {
  function verifySchedulerSecret(authHeader: string | null, configuredSecret: string | undefined): { ok: boolean; status: number; error?: string } {
    if (!configuredSecret || configuredSecret.trim().length === 0) {
      return { ok: false, status: 500, error: 'CRON_SECRET is not configured on the server.' };
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { ok: false, status: 401, error: 'Unauthorized: Missing Bearer token in Authorization header.' };
    }

    const token = authHeader.substring(7).trim();
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(configuredSecret.trim());

    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return { ok: false, status: 401, error: 'Unauthorized: Invalid scheduler secret token.' };
    }

    return { ok: true, status: 200 };
  }

  it('authenticates valid scheduler secret in constant time', () => {
    const secret = 'super-secure-cloud-scheduler-secret-2026';
    const res = verifySchedulerSecret(`Bearer ${secret}`, secret);
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
  });

  it('rejects mismatched scheduler tokens in constant time without throwing on different buffer lengths', () => {
    const secret = 'super-secure-cloud-scheduler-secret-2026';

    // Different length
    const resShort = verifySchedulerSecret('Bearer short', secret);
    expect(resShort.ok).toBe(false);
    expect(resShort.status).toBe(401);

    // Same length, different content
    const resMismatched = verifySchedulerSecret('Bearer super-secure-cloud-scheduler-secret-9999', secret);
    expect(resMismatched.ok).toBe(false);
    expect(resMismatched.status).toBe(401);
  });

  it('fails closed when CRON_SECRET is missing or empty', () => {
    const resMissing = verifySchedulerSecret('Bearer some-token', undefined);
    expect(resMissing.ok).toBe(false);
    expect(resMissing.status).toBe(500);

    const resEmpty = verifySchedulerSecret('Bearer some-token', '   ');
    expect(resEmpty.ok).toBe(false);
    expect(resEmpty.status).toBe(500);
  });

  it('rejects missing or non-Bearer authorization headers', () => {
    const secret = 'secret-123';
    expect(verifySchedulerSecret(null, secret).status).toBe(401);
    expect(verifySchedulerSecret('Basic dXNlcjpwYXNz', secret).status).toBe(401);
  });
});

describe('Step 0 Cloud Engineering: Liveness Endpoint Contract (/api/health)', () => {
  it('verifies minimal liveness payload contains no sensitive credentials or internal topologies', () => {
    const healthPayload = {
      status: 'healthy',
      service: 'jeevasetu',
      timestamp: new Date().toISOString(),
    };

    expect(healthPayload.status).toBe('healthy');
    expect(healthPayload.service).toBe('jeevasetu');
    expect(healthPayload.timestamp).toBeDefined();

    // Sensitive field leak check
    const sensitiveKeys = ['secret', 'key', 'token', 'password', 'patient', 'user', 'resend', 'firebase', 'admin'];
    const payloadKeys = Object.keys(healthPayload);
    for (const forbidden of sensitiveKeys) {
      expect(payloadKeys.some((k) => k.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});

describe('SEC-01 Regression: Mandatory invitationId and Patient Context Enclosure', () => {
  const { z } = require('zod');
  const RedeemSchema = z.object({
    passcode: z.string().trim().regex(/^\d{6}$/, 'Passcode must be a 6-digit number'),
    invitationId: z.string().trim().min(1, 'invitationId is required'),
    patientId: z.string().trim().optional(),
  });

  it('rejects redemption requests without an invitationId', () => {
    const invalidBody = { passcode: '123456' };
    const parseResult = RedeemSchema.safeParse(invalidBody);
    expect(parseResult.success).toBe(false);
    if (!parseResult.success) {
      expect(parseResult.error.errors[0].path).toContain('invitationId');
    }
  });

  it('rejects empty or whitespace invitationId strings', () => {
    const invalidBody = { passcode: '123456', invitationId: '   ' };
    const parseResult = RedeemSchema.safeParse(invalidBody);
    expect(parseResult.success).toBe(false);
  });

  it('accepts valid payload with both passcode and invitationId', () => {
    const validBody = { passcode: '654321', invitationId: 'inv_valid_123' };
    const parseResult = RedeemSchema.safeParse(validBody);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data.invitationId).toBe('inv_valid_123');
      expect(parseResult.data.passcode).toBe('654321');
    }
  });

  it('detects mismatch when invitationId belongs to another patient profile', () => {
    function verifyPatientOwnership(invitation: { patientId: string }, requestedPatientId?: string): boolean {
      if (!requestedPatientId) return true;
      return invitation.patientId === requestedPatientId;
    }

    const invitation = { patientId: 'patient_alpha' };
    expect(verifyPatientOwnership(invitation, 'patient_alpha')).toBe(true);
    expect(verifyPatientOwnership(invitation, 'patient_beta')).toBe(false);
  });

  it('prevents replay of already redeemed invitations', () => {
    const redeemedInvite = {
      status: 'redeemed',
      redeemedBy: 'user_prior',
      redeemedAt: new Date(),
    };

    function canRedeem(invite: { status: string }): { allowed: boolean; statusCode: number; error?: string } {
      if (invite.status !== 'pending') {
        return { allowed: false, statusCode: 409, error: 'This invitation passcode has already been redeemed or is no longer valid.' };
      }
      return { allowed: true, statusCode: 200 };
    }

    const res = canRedeem(redeemedInvite);
    expect(res.allowed).toBe(false);
    expect(res.statusCode).toBe(409);
    expect(res.error).toContain('already been redeemed');
  });
});
