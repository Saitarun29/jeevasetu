import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
// A liveness probe must never be statically prerendered: each probe needs a fresh
// timestamp and a live 200, otherwise Cloud Run sees a frozen build-time response.
export const dynamic = 'force-dynamic';

/**
 * GET /api/health
 * Minimal unauthenticated Cloud Run container liveness probe.
 *
 * Operational contract:
 * - Returns 200 OK with minimal status indicators.
 * - Strictly never exposes patient data, secrets, or internal infrastructure topologies.
 * - Cache-Control: no-store to prevent stale edge cache probes.
 */
export async function GET() {
  return NextResponse.json(
    {
      status: 'healthy',
      service: 'jeevasetu',
      timestamp: new Date().toISOString(),
    },
    {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    }
  );
}
