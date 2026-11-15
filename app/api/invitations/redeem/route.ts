import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyAuthUser, AuthError } from '@/lib/auth/server-auth';
import { verifyPasscodeWithHmac, getPasscodePepper } from '@/lib/auth/passcode';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const RedeemSchema = z.object({
  passcode: z.string().trim().regex(/^\d{6}$/, 'Passcode must be a 6-digit number'),
  invitationId: z.string().trim().min(1, 'invitationId is required'),
  patientId: z.string().trim().optional(),
});

// POST /api/invitations/redeem - Redeem 6-digit invitation to join a care circle
export async function POST(request: Request) {
  try {
    const user = await verifyAuthUser(request);
    const body = await request.json();
    const { passcode, invitationId, patientId } = RedeemSchema.parse(body);

    // Security requirement: Ensure passcode pepper is configured (fail closed if missing)
    try {
      getPasscodePepper();
    } catch (pepperErr: any) {
      return NextResponse.json(
        { error: 'Server security configuration error. Invitation redemption is unavailable.' },
        { status: 500 }
      );
    }

    const db = adminFirestore();

    // 1. Rate Limiting Protection: Max 5 failed attempts per user in 15 minutes
    const rateLimitRef = db.collection('users').doc(user.uid).collection('security').doc('rate_limit');
    const rateLimitDoc = await rateLimitRef.get();
    const nowMs = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes

    if (rateLimitDoc.exists) {
      const rlData = rateLimitDoc.data()!;
      const lastAttempt = rlData.lastFailedAttempt?.toMillis() || 0;
      if (nowMs - lastAttempt < windowMs && rlData.failedAttempts >= 5) {
        return NextResponse.json(
          {
            error:
              'Too many invalid passcode attempts. For patient safety, your account is temporarily locked from redeeming codes for 15 minutes.',
          },
          { status: 429 }
        );
      }
    }

    // 2. Identify candidate invitation by exact invitationId (mandatory, O(1) indexed lookup)
    const candidateInviteRef = db.collection('invitations').doc(invitationId);
    const candidateDoc = await candidateInviteRef.get();

    if (!candidateDoc.exists) {
      // Record failed attempt for user rate limiting
      await rateLimitRef.set(
        {
          failedAttempts: admin.firestore.FieldValue.increment(1),
          lastFailedAttempt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return NextResponse.json(
        { error: 'Invalid invitation ID or passcode. Please check your credentials.' },
        { status: 404 }
      );
    }

    const candidateData = candidateDoc.data()!;

    // Verify invitation ID belongs to the requested patient if specified
    if (patientId && candidateData.patientId !== patientId) {
      await rateLimitRef.set(
        {
          failedAttempts: admin.firestore.FieldValue.increment(1),
          lastFailedAttempt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      return NextResponse.json(
        { error: 'Invitation ID does not belong to the requested patient.' },
        { status: 400 }
      );
    }

    // 3. Execute atomic Firestore transaction covering validation, expiration, redemption and membership creation
    const txResult = await db.runTransaction(async (transaction) => {
      // Read 1: Read invitation document within transaction lock
      const inviteDoc = await transaction.get(candidateInviteRef!);
      if (!inviteDoc.exists) {
        throw new AuthError('Invitation not found.', 404);
      }

      const inviteData = inviteDoc.data()!;

      // Enforce single-use invariant
      if (inviteData.status !== 'pending') {
        throw new AuthError('This invitation passcode has already been redeemed or is no longer valid.', 409);
      }

      // Check expiration (24h TTL)
      const now = new Date();
      const expiresAt = inviteData.expiresAt.toDate();
      if (now > expiresAt) {
        transaction.update(candidateInviteRef!, { status: 'expired' });
        throw new AuthError('This invitation passcode has expired (24-hour limit).', 410);
      }

      // Check max attempt limit
      if (inviteData.attempts >= inviteData.maxAttempts) {
        transaction.update(candidateInviteRef!, { status: 'expired' });
        throw new AuthError('Passcode exceeded maximum entry attempts and is now void for security reasons.', 429);
      }

      // Verify patientId consistency inside transaction if specified
      if (patientId && inviteData.patientId !== patientId) {
        throw new AuthError('Invitation does not belong to the specified patient.', 400);
      }

      // Re-verify HMAC hash within transaction
      const isPasscodeValid = verifyPasscodeWithHmac(passcode, inviteData.passcodeHash, {
        patientId: inviteData.patientId,
        invitationId: inviteDoc.id,
      });

      if (!isPasscodeValid) {
        transaction.update(candidateInviteRef!, { attempts: (inviteData.attempts || 0) + 1 });
        throw new AuthError('Invalid or already-used passcode. Please check the 6-digit code and try again.', 404);
      }

      // Read 2: Read associated patient profile
      const patientRef = db.collection('patients').doc(inviteData.patientId);
      const patientDoc = await transaction.get(patientRef);
      if (!patientDoc.exists) {
        throw new AuthError('Associated patient profile not found.', 404);
      }
      const patientData = patientDoc.data()!;

      // Read 3: Check if user is already an active member of this care circle
      const memberRef = patientRef.collection('members').doc(user.uid);
      const memberDoc = await transaction.get(memberRef);

      if (memberDoc.exists && memberDoc.data()?.status === 'active') {
        return {
          alreadyMember: true,
          patientId: inviteData.patientId,
          patientName: patientData.fullName,
          role: memberDoc.data()?.role,
        };
      }

      const serverNow = admin.firestore.FieldValue.serverTimestamp();

      // Write 1: Authoritative membership record
      transaction.set(memberRef, {
        userId: user.uid,
        email: user.email || '',
        displayName: user.name || 'Care Circle Member',
        role: inviteData.targetRole,
        status: 'active',
        joinedAt: serverNow,
        invitedBy: inviteData.createdBy,
      });

      // Write 2: User accessible patients index
      const userAccessRef = db.collection('users').doc(user.uid).collection('accessible_patients').doc(inviteData.patientId);
      transaction.set(userAccessRef, {
        patientId: inviteData.patientId,
        fullName: patientData.fullName,
        role: inviteData.targetRole,
        status: 'active',
        linkedAt: serverNow,
      });

      // Write 3: Mark invitation as redeemed (prevents any concurrent or replay redemption)
      transaction.update(candidateInviteRef!, {
        status: 'redeemed',
        redeemedBy: user.uid,
        redeemedAt: serverNow,
      });

      // Write 4: Reset user rate limit tracking on successful redemption
      transaction.delete(rateLimitRef);

      return {
        alreadyMember: false,
        patientId: inviteData.patientId,
        patientName: patientData.fullName,
        role: inviteData.targetRole,
        createdBy: inviteData.createdBy,
      };
    });

    if (txResult.alreadyMember) {
      return NextResponse.json({
        message: 'You are already an active member of this care circle.',
        patientId: txResult.patientId,
        role: txResult.role,
      });
    }

    // 4. Record append-only care event (executed only after successful atomic transaction commit)
    await recordCareEvent({
      patientId: txResult.patientId,
      eventType: 'CARE_CIRCLE_MEMBER_JOINED',
      actorUid: user.uid,
      actorName: user.name || user.email,
      actorRole: txResult.role,
      action: `Joined ${txResult.patientName}'s care circle via invitation passcode`,
      entitySnapshot: { targetRole: txResult.role, invitedBy: txResult.createdBy },
    });

    return NextResponse.json({
      success: true,
      patientId: txResult.patientId,
      patientName: txResult.patientName,
      assignedRole: txResult.role,
      message: `Successfully joined ${txResult.patientName}'s care circle as ${txResult.role.replace('_', ' ')}.`,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to redeem invitation' },
      { status: error.statusCode || 500 }
    );
  }
}
