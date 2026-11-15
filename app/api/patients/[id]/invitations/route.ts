import { NextResponse } from 'next/server';
import { z } from 'zod';
import * as crypto from 'crypto';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { hashPasscodeWithHmac } from '@/lib/auth/passcode';
import { recordCareEvent } from '@/lib/audit/care-events';
import * as admin from 'firebase-admin';

export const runtime = 'nodejs';

const CreateInvitationSchema = z.object({
  targetRole: z.enum(['family_member', 'caregiver']),
});

/**
 * Generates a cryptographically strong 6-digit numerical passcode (100000 - 999999).
 */
function generate6DigitPasscode(): string {
  const min = 100000;
  const max = 999999;
  return crypto.randomInt(min, max + 1).toString();
}

// POST /api/patients/[id]/invitations - Generate a secure 6-digit invitation passcode
export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, ['primary_family']);
    const body = await request.json();
    const { targetRole } = CreateInvitationSchema.parse(body);

    const rawPasscode = generate6DigitPasscode();
    const db = adminFirestore();
    const invitationRef = db.collection('invitations').doc();

    // Salted HMAC-SHA256 with invitation-specific context (patientId + invitationId) & server pepper
    const passcodeHash = hashPasscodeWithHmac(rawPasscode, {
      patientId,
      invitationId: invitationRef.id,
    });

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24-hour TTL

    const invitationRecord = {
      id: invitationRef.id,
      patientId,
      passcodeHash,
      targetRole,
      status: 'pending',
      attempts: 0,
      maxAttempts: 5,
      expiresAt: admin.firestore.Timestamp.fromDate(expiresAt),
      createdBy: user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    await invitationRef.set(invitationRecord);

    // Record append-only audit event
    await recordCareEvent({
      patientId,
      eventType: 'INVITATION_GENERATED',
      actorUid: user.uid,
      actorName: user.name || user.email,
      actorRole: member.role,
      action: `Generated 6-digit access invitation for ${targetRole}`,
      entitySnapshot: { invitationId: invitationRef.id, targetRole, expiresAt: expiresAt.toISOString() },
    });

    return NextResponse.json(
      {
        success: true,
        invitationId: invitationRef.id,
        passcode: rawPasscode, // Raw passcode shown to primary family member once
        targetRole,
        expiresAt: expiresAt.toISOString(),
      },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: error.errors.map((e) => e.message).join(', ') }, { status: 400 });
    }
    return NextResponse.json(
      { error: error.message || 'Failed to generate invitation' },
      { status: error.statusCode || 500 }
    );
  }
}
