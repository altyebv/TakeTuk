import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { sqlPoint } from '../../geography';
import type {
  DocumentContentType,
  DocumentStatus,
  DocumentType,
  Driver,
  DriverAvailability,
  DriverDocument,
  DriverStatus,
} from '../domain/driver';
import { required } from '../../../shared/required';

interface DriverRow {
  user_id: string;
  service_area_id: string;
  service_area_code: string;
  status: DriverStatus;
  full_legal_name: string;
  driving_license_number: string;
  submitted_at: Date | null;
  reviewed_at: Date | null;
  review_note: string | null;
  availability: DriverAvailability;
  active_vehicle_id: string | null;
  availability_changed_at: Date;
  created_at: Date;
  created_at_key: string;
}

const DRIVER_SELECT = `
  select d.user_id, d.service_area_id, a.code as service_area_code, d.status, d.full_legal_name,
         d.driving_license_number, d.submitted_at, d.reviewed_at, d.review_note, d.availability,
         d.active_vehicle_id, d.availability_changed_at, d.created_at, d.created_at::text as created_at_key
    from taketuk.drivers d
    join taketuk.service_areas a on a.id = d.service_area_id`;

const toDriver = (row: DriverRow): Driver => ({
  userId: row.user_id,
  serviceAreaId: row.service_area_id,
  serviceAreaCode: row.service_area_code,
  status: row.status,
  fullLegalName: row.full_legal_name,
  drivingLicenseNumber: row.driving_license_number,
  submittedAt: row.submitted_at,
  reviewedAt: row.reviewed_at,
  reviewNote: row.review_note,
  availability: row.availability,
  activeVehicleId: row.active_vehicle_id,
  availabilityChangedAt: row.availability_changed_at,
  createdAt: row.created_at,
});

interface DocumentRow {
  id: string;
  driver_id: string;
  vehicle_id: string | null;
  document_type: DocumentType;
  content_type: DocumentContentType;
  status: DocumentStatus;
  storage_bucket: string;
  storage_path: string;
  created_at: Date;
  uploaded_at: Date | null;
}

const DOCUMENT_COLUMNS = `id, driver_id, vehicle_id, document_type, content_type, status, storage_bucket,
  storage_path, created_at, uploaded_at`;

const toDocument = (row: DocumentRow): DriverDocument => ({
  id: row.id,
  driverId: row.driver_id,
  vehicleId: row.vehicle_id,
  documentType: row.document_type,
  contentType: row.content_type,
  status: row.status,
  storageBucket: row.storage_bucket,
  storagePath: row.storage_path,
  createdAt: row.created_at,
  uploadedAt: row.uploaded_at,
});

export interface DriverListRow {
  readonly driver: Driver;
  readonly sortKey: string;
}

@Injectable()
export class DriversRepository {
  /** Returns true when the row was created (false: a driver row already existed). */
  async insertIfAbsent(
    tx: Tx,
    input: {
      userId: string;
      serviceAreaId: string;
      fullLegalName: string;
      drivingLicenseNumber: string;
    },
  ): Promise<boolean> {
    const { rowCount } = await tx.query(
      `insert into taketuk.drivers (user_id, service_area_id, status, full_legal_name, driving_license_number)
       values ($1, $2, 'applicant', $3, $4)
       on conflict (user_id) do nothing`,
      [input.userId, input.serviceAreaId, input.fullLegalName, input.drivingLicenseNumber],
    );
    return rowCount === 1;
  }

  async find(db: Queryable, userId: string): Promise<Driver | null> {
    const { rows } = await db.query<DriverRow>(`${DRIVER_SELECT} where d.user_id = $1`, [userId]);
    return rows[0] ? toDriver(rows[0]) : null;
  }

  async lock(tx: Tx, userId: string): Promise<Driver | null> {
    const { rows } = await tx.query<DriverRow>(
      `${DRIVER_SELECT} where d.user_id = $1 for update of d`,
      [userId],
    );
    return rows[0] ? toDriver(rows[0]) : null;
  }

  async list(
    db: Queryable,
    filter: {
      status?: DriverStatus | undefined;
      limit: number;
      after?: { sortKey: string; id: string } | undefined;
    },
  ): Promise<DriverListRow[]> {
    const { rows } = await db.query<DriverRow>(
      `${DRIVER_SELECT}
        where ($1::text is null or d.status = $1)
          and ($2::timestamptz is null or (d.created_at, d.user_id) < ($2::timestamptz, $3::uuid))
        order by d.created_at desc, d.user_id desc
        limit $4`,
      [
        filter.status ?? null,
        filter.after?.sortKey ?? null,
        filter.after?.id ?? null,
        filter.limit,
      ],
    );
    return rows.map((r) => ({ driver: toDriver(r), sortKey: r.created_at_key }));
  }

  async updateProfile(
    tx: Tx,
    userId: string,
    changes: { fullLegalName?: string | undefined; drivingLicenseNumber?: string | undefined },
  ): Promise<void> {
    await tx.query(
      `update taketuk.drivers
          set full_legal_name = coalesce($2, full_legal_name),
              driving_license_number = coalesce($3, driving_license_number)
        where user_id = $1`,
      [userId, changes.fullLegalName ?? null, changes.drivingLicenseNumber ?? null],
    );
  }

  async markSubmitted(tx: Tx, userId: string): Promise<void> {
    await tx.query(
      `update taketuk.drivers set status = 'pending_review', submitted_at = now() where user_id = $1`,
      [userId],
    );
  }

  /** Review transition. Suspension forces the driver offline in the same statement. */
  async updateReview(
    tx: Tx,
    userId: string,
    change: { status: DriverStatus; reviewedBy: string; note: string | null },
  ): Promise<void> {
    await tx.query(
      `update taketuk.drivers
          set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4,
              availability = case when $2 = 'approved' then availability else 'offline' end,
              availability_changed_at = case
                when $2 <> 'approved' and availability <> 'offline' then now() else availability_changed_at end
        where user_id = $1`,
      [userId, change.status, change.reviewedBy, change.note],
    );
  }

  async setAvailability(
    tx: Tx,
    userId: string,
    availability: DriverAvailability,
    activeVehicleId: string | null,
  ): Promise<void> {
    await tx.query(
      `update taketuk.drivers
          set availability = $2,
              active_vehicle_id = $3,
              availability_changed_at = case when availability <> $2 then now() else availability_changed_at end
        where user_id = $1`,
      [userId, availability, activeVehicleId],
    );
  }

  async upsertLocation(
    db: Queryable,
    input: {
      driverId: string;
      lat: number;
      lng: number;
      accuracyMeters: number | null;
      recordedAt: Date;
    },
  ): Promise<Date> {
    const { rows } = await db.query<{ received_at: Date }>(
      `insert into taketuk.driver_locations (driver_id, location, accuracy_meters, device_recorded_at, received_at)
       values ($1, ${sqlPoint('$3', '$2')}, $4, $5, now())
       on conflict (driver_id) do update
         set location = excluded.location,
             accuracy_meters = excluded.accuracy_meters,
             device_recorded_at = excluded.device_recorded_at,
             received_at = excluded.received_at
       returning received_at`,
      [input.driverId, input.lat, input.lng, input.accuracyMeters, input.recordedAt],
    );
    return required(rows[0], 'row').received_at;
  }

  // ---------------------------------------------------------------- documents

  async insertDocument(
    tx: Tx,
    input: {
      id: string;
      driverId: string;
      vehicleId: string | null;
      documentType: DocumentType;
      contentType: DocumentContentType;
      bucket: string;
      path: string;
    },
  ): Promise<DriverDocument> {
    const { rows } = await tx.query<DocumentRow>(
      `insert into taketuk.driver_documents
         (id, driver_id, vehicle_id, document_type, content_type, storage_bucket, storage_path, status)
       values ($1, $2, $3, $4, $5, $6, $7, 'upload_pending')
       returning ${DOCUMENT_COLUMNS}`,
      [
        input.id,
        input.driverId,
        input.vehicleId,
        input.documentType,
        input.contentType,
        input.bucket,
        input.path,
      ],
    );
    return toDocument(required(rows[0], 'row'));
  }

  async findDocument(db: Queryable, documentId: string): Promise<DriverDocument | null> {
    const { rows } = await db.query<DocumentRow>(
      `select ${DOCUMENT_COLUMNS} from taketuk.driver_documents where id = $1`,
      [documentId],
    );
    return rows[0] ? toDocument(rows[0]) : null;
  }

  async lockDocument(tx: Tx, documentId: string): Promise<DriverDocument | null> {
    const { rows } = await tx.query<DocumentRow>(
      `select ${DOCUMENT_COLUMNS} from taketuk.driver_documents where id = $1 for update`,
      [documentId],
    );
    return rows[0] ? toDocument(rows[0]) : null;
  }

  /** Marks the document uploaded and supersedes older uploads of the same type (and vehicle). */
  async markDocumentUploaded(tx: Tx, document: DriverDocument): Promise<DriverDocument> {
    await tx.query(
      `update taketuk.driver_documents
          set status = 'superseded'
        where driver_id = $1 and document_type = $2 and vehicle_id is not distinct from $3
          and status = 'uploaded' and id <> $4`,
      [document.driverId, document.documentType, document.vehicleId, document.id],
    );
    const { rows } = await tx.query<DocumentRow>(
      `update taketuk.driver_documents set status = 'uploaded', uploaded_at = now()
        where id = $1 returning ${DOCUMENT_COLUMNS}`,
      [document.id],
    );
    return toDocument(required(rows[0], 'row'));
  }

  async listDocuments(db: Queryable, driverId: string): Promise<DriverDocument[]> {
    const { rows } = await db.query<DocumentRow>(
      `select ${DOCUMENT_COLUMNS} from taketuk.driver_documents
        where driver_id = $1 order by created_at, id`,
      [driverId],
    );
    return rows.map(toDocument);
  }
}
