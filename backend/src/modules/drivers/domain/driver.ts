import { INITIAL, StateMachine } from '../../../shared/state-machine';

export const DRIVER_STATUSES = [
  'applicant',
  'pending_review',
  'approved',
  'rejected',
  'suspended',
] as const;
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export type DriverAvailability = 'offline' | 'online';

/** docs/domain/STATE_MACHINES.md §6 (driver verification). */
export const driverStateMachine = new StateMachine<DriverStatus, 'driver' | 'admin'>('driver', [
  { from: INITIAL, to: 'applicant', actors: ['driver'] },
  { from: 'applicant', to: 'pending_review', actors: ['driver'] },
  { from: 'rejected', to: 'pending_review', actors: ['driver'] },
  { from: 'pending_review', to: 'approved', actors: ['admin'] },
  { from: 'pending_review', to: 'rejected', actors: ['admin'] },
  { from: 'approved', to: 'suspended', actors: ['admin'] },
  { from: 'suspended', to: 'approved', actors: ['admin'] },
]);

/** Profile fields may change only before approval or after rejection. */
export const EDITABLE_PROFILE_STATUSES: readonly DriverStatus[] = ['applicant', 'rejected'];

export const DOCUMENT_TYPES = [
  'driver_photo',
  'driving_license',
  'national_id',
  'vehicle_registration',
  'vehicle_photo',
] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const VEHICLE_DOCUMENT_TYPES: readonly DocumentType[] = [
  'vehicle_registration',
  'vehicle_photo',
];

/**
 * Documents required before a driver can submit for review. PROVISIONAL: the legally required
 * set for Sudan is an open product decision (OPEN_DECISIONS DRV-1). Change it here only.
 */
export const REQUIRED_DRIVER_DOCUMENTS: readonly DocumentType[] = [
  'driver_photo',
  'driving_license',
  'national_id',
];
export const REQUIRED_VEHICLE_DOCUMENTS: readonly DocumentType[] = [
  'vehicle_registration',
  'vehicle_photo',
];

export const DOCUMENT_CONTENT_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const;
export type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

export const EXTENSION_BY_CONTENT_TYPE: Readonly<Record<DocumentContentType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};

export type DocumentStatus = 'upload_pending' | 'uploaded' | 'superseded';

export const driverDocumentStateMachine = new StateMachine<DocumentStatus, 'driver' | 'system'>(
  'driver_document',
  [
    { from: INITIAL, to: 'upload_pending', actors: ['driver'] },
    { from: 'upload_pending', to: 'uploaded', actors: ['driver'] },
    { from: 'uploaded', to: 'superseded', actors: ['system'] },
  ],
);

export function isVehicleDocument(type: DocumentType): boolean {
  return VEHICLE_DOCUMENT_TYPES.includes(type);
}

/** Licence numbers: trimmed, whitespace collapsed, Latin letters upper-cased. */
export function normaliseLicenseNumber(input: string): string {
  return input.trim().replace(/\s+/g, ' ').toUpperCase();
}

export interface Driver {
  readonly userId: string;
  readonly serviceAreaId: string;
  readonly serviceAreaCode: string;
  readonly status: DriverStatus;
  readonly fullLegalName: string;
  readonly drivingLicenseNumber: string;
  readonly submittedAt: Date | null;
  readonly reviewedAt: Date | null;
  readonly reviewNote: string | null;
  readonly availability: DriverAvailability;
  readonly activeVehicleId: string | null;
  readonly availabilityChangedAt: Date;
  readonly createdAt: Date;
}

export interface DriverDocument {
  readonly id: string;
  readonly driverId: string;
  readonly vehicleId: string | null;
  readonly documentType: DocumentType;
  readonly contentType: DocumentContentType;
  readonly status: DocumentStatus;
  readonly storageBucket: string;
  readonly storagePath: string;
  readonly createdAt: Date;
  readonly uploadedAt: Date | null;
}

export interface VerificationGap {
  readonly scope: 'driver' | 'vehicle';
  readonly documentType?: DocumentType;
  readonly vehicleId?: string;
  readonly reason: string;
}

/**
 * Pure check of the submission requirements (DRV-1): required driver documents, plus at least
 * one non-rejected vehicle with all required vehicle documents.
 */
export function verificationGaps(
  documents: readonly Pick<DriverDocument, 'documentType' | 'vehicleId' | 'status'>[],
  vehicles: readonly { id: string; status: string }[],
): VerificationGap[] {
  const uploaded = documents.filter((d) => d.status === 'uploaded');
  const gaps: VerificationGap[] = REQUIRED_DRIVER_DOCUMENTS.filter(
    (type) => !uploaded.some((d) => d.documentType === type && d.vehicleId === null),
  ).map((type) => ({ scope: 'driver', documentType: type, reason: 'document not uploaded' }));

  const candidates = vehicles.filter((v) => v.status !== 'rejected');
  if (candidates.length === 0) {
    gaps.push({ scope: 'vehicle', reason: 'no vehicle registered' });
    return gaps;
  }
  const complete = candidates.some((vehicle) =>
    REQUIRED_VEHICLE_DOCUMENTS.every((type) =>
      uploaded.some((d) => d.documentType === type && d.vehicleId === vehicle.id),
    ),
  );
  if (!complete) {
    for (const vehicle of candidates) {
      for (const type of REQUIRED_VEHICLE_DOCUMENTS) {
        if (!uploaded.some((d) => d.documentType === type && d.vehicleId === vehicle.id)) {
          gaps.push({
            scope: 'vehicle',
            vehicleId: vehicle.id,
            documentType: type,
            reason: 'document not uploaded',
          });
        }
      }
    }
  }
  return gaps;
}
