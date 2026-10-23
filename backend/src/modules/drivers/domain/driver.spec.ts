import { driverStateMachine, verificationGaps, type DocumentType } from './driver';

const doc = (
  documentType: DocumentType,
  vehicleId: string | null = null,
  status: 'uploaded' | 'upload_pending' | 'superseded' = 'uploaded',
) => ({
  documentType,
  vehicleId,
  status,
});

const complete = (vehicleId: string) => [
  doc('driver_photo'),
  doc('driving_license'),
  doc('national_id'),
  doc('vehicle_registration', vehicleId),
  doc('vehicle_photo', vehicleId),
];

describe('verificationGaps', () => {
  it('is empty when driver and one vehicle are fully documented', () => {
    expect(verificationGaps(complete('v1'), [{ id: 'v1', status: 'pending_review' }])).toEqual([]);
  });

  it('reports missing driver documents and missing vehicles', () => {
    const gaps = verificationGaps([doc('driver_photo')], []);
    expect(gaps).toEqual([
      { scope: 'driver', documentType: 'driving_license', reason: 'document not uploaded' },
      { scope: 'driver', documentType: 'national_id', reason: 'document not uploaded' },
      { scope: 'vehicle', reason: 'no vehicle registered' },
    ]);
  });

  it('ignores pending and superseded uploads', () => {
    const docs = complete('v1').map((d) =>
      d.documentType === 'national_id' ? { ...d, status: 'upload_pending' as const } : d,
    );
    expect(verificationGaps(docs, [{ id: 'v1', status: 'pending_review' }])).toEqual([
      { scope: 'driver', documentType: 'national_id', reason: 'document not uploaded' },
    ]);
  });

  it('does not count rejected vehicles, and accepts any one complete vehicle', () => {
    expect(verificationGaps(complete('v1'), [{ id: 'v1', status: 'rejected' }])).toEqual([
      { scope: 'vehicle', reason: 'no vehicle registered' },
    ]);
    const twoVehicles = [
      { id: 'v1', status: 'pending_review' },
      { id: 'v2', status: 'pending_review' },
    ];
    expect(verificationGaps(complete('v2'), twoVehicles)).toEqual([]);
  });
});

describe('driver state machine', () => {
  it('reserves approval and suspension for admins and submission for drivers', () => {
    expect(driverStateMachine.allows('pending_review', 'approved', 'admin')).toBe(true);
    expect(driverStateMachine.allows('pending_review', 'approved', 'driver')).toBe(false);
    expect(driverStateMachine.allows('applicant', 'pending_review', 'driver')).toBe(true);
    expect(driverStateMachine.allows('applicant', 'approved', 'admin')).toBe(false);
    expect(driverStateMachine.allows('approved', 'suspended', 'admin')).toBe(true);
    expect(driverStateMachine.allows('suspended', 'approved', 'driver')).toBe(false);
  });
});
