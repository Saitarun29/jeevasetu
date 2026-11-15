import { NextResponse } from 'next/server';
import { z } from 'zod';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyPatientAccess } from '@/lib/auth/server-auth';
import { recordCareEvent } from '@/lib/audit/care-events';

export const runtime = 'nodejs';

// GET /api/patients/[id]/members - List all members in care circle
export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { patientId } = await verifyPatientAccess(request, params.id);
    const db = adminFirestore();

    const membersSnapshot = await db
      .collection('patients')
      .doc(patientId)
      .collection('members')
      .orderBy('joinedAt', 'desc')
      .get();

    const members = membersSnapshot.docs.map((doc) => {
      const data = doc.data();
      return {
        userId: data.userId,
        email: data.email,
        displayName: data.displayName,
        role: data.role,
        status: data.status,
        joinedAt: data.joinedAt?.toDate ? data.joinedAt.toDate().toISOString() : data.joinedAt,
      };
    });

    return NextResponse.json({ members });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to fetch care circle members' },
      { status: error.statusCode || 500 }
    );
  }
}

const RevokeMemberSchema = z.object({
  targetUserId: z.string().min(1),
});

// DELETE /api/patients/[id]/members - Revoke member access (Instantaneous revocation, primary_family only)
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user, member, patientId } = await verifyPatientAccess(request, params.id, ['primary_family']);
    const body = await request.json();
    const { targetUserId } = RevokeMemberSchema.parse(body);

    if (targetUserId === user.uid) {
      return NextResponse.json({ error: 'Cannot revoke your own primary_family access' }, { status: 400 });
    }

    const db = adminFirestore();
    const batch = db.batch();

    // Set member record status to 'revoked'
    const targetMemberRef = db.collection('patients').doc(patientId).collection('members').doc(targetUserId);
    batch.update(targetMemberRef, { status: 'revoked' });

    // Update user's accessible_patients list
    const userAccessRef = db.collection('users').doc(targetUserId).collection('accessible_patients').doc(patientId);
    batch.update(userAccessRef, { status: 'revoked' });

    await batch.commit();

    // Record append-only audit event
    await recordCareEvent({
      patientId,
      eventType: 'CARE_CIRCLE_MEMBER_REVOKED',
      actorUid: user.uid,
      actorName: user.name || user.email,
      actorRole: member.role,
      action: `Revoked access for user ${targetUserId}`,
      entitySnapshot: { targetUserId },
    });

    return NextResponse.json({ success: true, message: 'Member access revoked successfully' });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to revoke member access' },
      { status: error.statusCode || 500 }
    );
  }
}
