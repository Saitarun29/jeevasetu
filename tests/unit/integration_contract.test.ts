import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Cross-layer contract regression tests.
 *
 * These lock the wire/contract boundaries between the offline sync client,
 * the server API routes, and the Firestore audit storage. The specific bugs
 * these guard against were real integration defects found in code review:
 *   1. sync client sent `actionUUID` while the server validated `actionId` -> every
 *      offline sync would 400-loop forever.
 *   2. server events route accepted `expectedVersion` in the wire format but never
 *      enforced it -> offline dose logs could silently land against a changed
 *      prescription (schedule conflicts silently overwritten).
 *   3. timeline route read a top-level `care_events` collection while every writer
 *      used `/patients/{id}/care_events` -> timeline always returned empty.
 *   4. gap detector queried `medications.where('status','==','active')` but the
 *      Medication document uses boolean `isActive`/`isArchived` -> medication
 *      gaps were never detected.
 */
function readRepoFile(relPath: string): string {
  return readFileSync(join(__dirname, '..', '..', relPath), 'utf-8');
}

describe('Integration Contracts: Offline Sync -> Server Events API', () => {
  const syncSource = readRepoFile('lib/offline/sync-service.ts');
  const eventsRouteSource = readRepoFile(
    'app/api/patients/[id]/medications/events/route.ts'
  );

  it('offline sync payload uses the server-validated `actionId` field (not actionUUID)', () => {
    expect(syncSource).toContain('actionId: item.id');
    expect(syncSource).not.toContain('actionUUID:');
  });

  it('events route validates actionId as a client-generated UUID (idempotency doc ID)', () => {
    expect(eventsRouteSource).toContain("actionId: z.string().uuid(");
    // UUID must remain the Firestore document ID for idempotent replay
    expect(eventsRouteSource).toContain('.doc(validatedData.actionId)');
  });

  it('events route enforces expectedVersion conflicts with a 409 (no silent overwrite)', () => {
    expect(eventsRouteSource).toContain('expectedVersion: z.number().optional()');
    expect(eventsRouteSource).toContain('conflictErr.statusCode = 409');
    expect(eventsRouteSource).toContain('Schedule version conflict');
  });
});

describe('Integration Contracts: Care Timeline Read Path', () => {
  const timelineRouteSource = readRepoFile('app/api/patients/[id]/timeline/route.ts');
  const careEventsSource = readRepoFile('lib/audit/care-events.ts');

  it('timeline route reads the same patient-scoped subcollection that writers use', () => {
    // Writers (lib/audit/care-events.ts) persist to /patients/{patientId}/care_events
    expect(careEventsSource).toContain(
      "collection('patients').doc(input.patientId).collection('care_events')"
    );

    // Timeline reader must read the patient subcollection, NOT a top-level collection
    const readPath =
      ".collection('patients')\n      .doc(params.id)\n      .collection('care_events')";
    expect(timelineRouteSource).toContain(readPath);
  });

  it('timeline route enforces a bounded limit (no unbounded pulls)', () => {
    expect(timelineRouteSource).toContain('Math.min(Math.max(limitParam, 1), 100)');
    expect(timelineRouteSource).toContain('events.slice(0, limit)');
  });
});

describe('Integration Contracts: Care Gap Detector Field Schema', () => {
  const gapDetectorSource = readRepoFile('lib/continuity/gap-detector.ts');

  it('queries medications using the real isActive/isArchived boolean fields', () => {
    expect(gapDetectorSource).toContain("where('isArchived', '==', false)");
    expect(gapDetectorSource).toContain("where('isActive', '==', true)");
    // Must never regress to a non-existent string status field
    expect(gapDetectorSource).not.toContain("where('status', '==', 'active')");
  });
});
