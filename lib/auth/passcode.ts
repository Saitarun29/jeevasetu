import * as crypto from 'crypto';

/**
 * Retrieves the server-side pepper secret used for HMAC-SHA256 passcode hashing.
 * Fails closed if the secret is missing or empty.
 */
export function getPasscodePepper(): string {
  const pepper = process.env.INVITATION_PEPPER || process.env.PASSCODE_PEPPER;
  if (!pepper || pepper.trim().length === 0) {
    throw new Error('SECURITY_CONFIG_ERROR: Passcode pepper secret is not configured on the server. Failing closed.');
  }
  return pepper.trim();
}

export interface PasscodeHashContext {
  patientId: string;
  invitationId: string;
}

/**
 * Computes a secure HMAC-SHA256 hash of a 6-digit passcode salted with
 * invitation-specific context (patientId + invitationId) and keyed by the server pepper.
 *
 * This prevents precomputed rainbow table attacks against the 6-digit passcode space.
 */
export function hashPasscodeWithHmac(
  passcode: string,
  context: PasscodeHashContext,
  customPepper?: string
): string {
  const pepper = customPepper || getPasscodePepper();
  const normalizedPasscode = passcode.trim();

  if (!context.patientId || !context.invitationId) {
    throw new Error('SECURITY_CONFIG_ERROR: Passcode context (patientId, invitationId) is required.');
  }

  const saltPayload = `${normalizedPasscode}:${context.patientId}:${context.invitationId}`;
  return crypto.createHmac('sha256', pepper).update(saltPayload).digest('hex');
}

/**
 * Constant-time verification of a candidate passcode against the stored HMAC-SHA256 hash.
 * Returns false safely if lengths differ or if verification fails.
 */
export function verifyPasscodeWithHmac(
  passcode: string,
  storedHash: string,
  context: PasscodeHashContext,
  customPepper?: string
): boolean {
  try {
    const computedHash = hashPasscodeWithHmac(passcode, context, customPepper);
    const computedBuf = Buffer.from(computedHash, 'hex');
    const storedBuf = Buffer.from(storedHash, 'hex');

    if (computedBuf.length !== storedBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(computedBuf, storedBuf);
  } catch {
    return false;
  }
}
