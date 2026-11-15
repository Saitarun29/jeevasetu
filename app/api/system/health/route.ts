import { NextResponse } from 'next/server';
import { adminFirestore } from '@/lib/firebase/admin';
import { verifyAuthUser } from '@/lib/auth/server-auth';
import { isResendConfigured } from '@/lib/email/resend';
import { SystemHealthMetrics } from '@/types/reminder';

export const runtime = 'nodejs';

/**
 * GET /api/system/health
 * Returns operational health metrics: scheduler status, last execution, reminder counts, provider readiness.
 * Requires authenticated user session.
 */
export async function GET(request: Request) {
  try {
    await verifyAuthUser(request);
    const db = adminFirestore();

    const summaryDoc = await db.collection('system_health').doc('summary').get();
    const runsSnap = await db
      .collection('system_health')
      .doc('summary')
      .collection('runs')
      .orderBy('startedAt', 'desc')
      .limit(5)
      .get();

    const summaryData = summaryDoc.exists ? summaryDoc.data()! : {};
    const recentExecutions = runsSnap.docs.map((d) => d.data() as any);

    const providerConfigured = isResendConfigured();
    const lastRunTimestamp = summaryData.lastRunTimestamp || null;
    const lastRunStatus = summaryData.lastRunStatus || null;

    let schedulerStatus: 'operational' | 'degraded' | 'unconfigured' = 'unconfigured';
    if (!providerConfigured) {
      schedulerStatus = 'unconfigured';
    } else if (lastRunStatus === 'failed') {
      schedulerStatus = 'degraded';
    } else if (lastRunStatus === 'success') {
      schedulerStatus = 'operational';
    }

    const metrics: SystemHealthMetrics = {
      schedulerStatus,
      lastRunTimestamp,
      lastRunStatus,
      totalSentReminders: summaryData.totalSentReminders || 0,
      totalFailedReminders: summaryData.totalFailedReminders || 0,
      pendingQueueCount: 0,
      providerConfigured,
      recentExecutions,
    };

    return NextResponse.json({
      health: 'ok',
      timestamp: new Date().toISOString(),
      metrics,
    });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve system health metrics' },
      { status: error.statusCode || 500 }
    );
  }
}
