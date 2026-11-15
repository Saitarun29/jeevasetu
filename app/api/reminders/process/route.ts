import { NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { executeScheduledReminderPipeline } from '@/lib/reminders/engine';

export const runtime = 'nodejs';

/**
 * POST /api/reminders/process
 * Secured Cloud Scheduler Cron Heartbeat Endpoint (invoked every 5 minutes).
 *
 * Security: Strictly validates 'Authorization: Bearer <CRON_SECRET>' in constant time.
 * Never exposes credentials to client.
 */
export async function POST(request: Request) {
  try {
    const authHeader = request.headers.get('Authorization');
    const configuredSecret = process.env.CRON_SECRET;

    if (!configuredSecret || configuredSecret.trim().length === 0) {
      return NextResponse.json(
        { error: 'CRON_SECRET is not configured on the server.' },
        { status: 500 }
      );
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Unauthorized: Missing Bearer token in Authorization header.' },
        { status: 401 }
      );
    }

    const token = authHeader.substring(7).trim();
    const tokenBuf = Buffer.from(token);
    const secretBuf = Buffer.from(configuredSecret.trim());

    // Constant-time comparison: buffers must be equal length and values must match. Fails closed.
    if (tokenBuf.length !== secretBuf.length || !crypto.timingSafeEqual(tokenBuf, secretBuf)) {
      return NextResponse.json(
        { error: 'Unauthorized: Invalid scheduler secret token.' },
        { status: 401 }
      );
    }

    // Identify scheduler invocation source
    const userAgent = request.headers.get('user-agent') || 'Google-Cloud-Scheduler';
    const processId = `scheduler_${Date.now()}_${userAgent.slice(0, 20)}`;

    const result = await executeScheduledReminderPipeline(processId);

    if (result.locked) {
      return NextResponse.json(
        {
          status: 'skipped',
          reason: result.reason,
        },
        { status: 423 } // Locked
      );
    }

    return NextResponse.json(result, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'Internal error during reminder processing.' },
      { status: 500 }
    );
  }
}
