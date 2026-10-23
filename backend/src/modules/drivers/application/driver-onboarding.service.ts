import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { Database, type Queryable, type Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { FleetService, type RegisterVehicleInput, type Vehicle } from '../../fleet';
import { ServiceAreasService } from '../../geography';
import { IdentityService } from '../../identity';
import {
  driverDocumentStateMachine,
  driverStateMachine,
  EDITABLE_PROFILE_STATUSES,
  EXTENSION_BY_CONTENT_TYPE,
  isVehicleDocument,
  normaliseLicenseNumber,
  verificationGaps,
  type DocumentContentType,
  type DocumentType,
  type Driver,
  type DriverDocument,
} from '../domain/driver';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  type SignedUpload,
} from '../infrastructure/document-storage';
import { DriversRepository } from '../infrastructure/drivers.repository';

export interface DriverRegistrationInput {
  readonly displayName: string;
  readonly fullLegalName: string;
  readonly drivingLicenseNumber: string;
  readonly serviceAreaCode: string;
}

/** Driver-facing onboarding and verification use cases (STATE_MACHINES §6). */
@Injectable()
export class DriverOnboardingService {
  constructor(
    private readonly db: Database,
    private readonly drivers: DriversRepository,
    private readonly identity: IdentityService,
    private readonly serviceAreas: ServiceAreasService,
    private readonly fleet: FleetService,
    private readonly audit: AuditService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Idempotent: identical repeats return the existing profile with `created: false`. */
  async register(
    auth: AuthContext,
    input: DriverRegistrationInput,
  ): Promise<{ driver: Driver; created: boolean }> {
    const fullLegalName = input.fullLegalName.trim().replace(/\s+/g, ' ');
    const drivingLicenseNumber = normaliseLicenseNumber(input.drivingLicenseNumber);
    return this.db.transaction(async (tx) => {
      const area = await this.serviceAreas.findActiveByCode(tx, input.serviceAreaCode);
      if (!area) {
        throw new AppError(
          'SERVICE_AREA_NOT_FOUND',
          `No active service area '${input.serviceAreaCode}'.`,
        );
      }
      const { user } = await this.identity.ensureUserWithRole(
        tx,
        auth.identity,
        input.displayName,
        'driver',
      );
      driverStateMachine.assert('(initial)', 'applicant', 'driver');
      const created = await this.drivers.insertIfAbsent(tx, {
        userId: user.id,
        serviceAreaId: area.id,
        fullLegalName,
        drivingLicenseNumber,
      });
      const driver = await this.lockDriver(tx, user.id);
      if (!created) {
        const same =
          driver.serviceAreaId === area.id &&
          driver.fullLegalName === fullLegalName &&
          driver.drivingLicenseNumber === drivingLicenseNumber;
        if (!same) {
          throw new AppError(
            'ALREADY_REGISTERED',
            'A driver profile already exists with different details; use PATCH /v1/driver/profile.',
          );
        }
        return { driver, created: false };
      }
      await this.audit.record(tx, {
        actor: { type: 'user', userId: user.id, role: 'driver' },
        action: 'driver.registered',
        entityType: 'driver',
        entityId: user.id,
        metadata: { serviceAreaCode: area.code },
      });
      return { driver, created: true };
    });
  }

  async getProfile(auth: AuthContext): Promise<Driver> {
    return this.findDriver(this.db, actorAs(auth, 'driver').userId);
  }

  async updateProfile(
    auth: AuthContext,
    changes: { fullLegalName?: string | undefined; drivingLicenseNumber?: string | undefined },
  ): Promise<Driver> {
    const driverId = actorAs(auth, 'driver').userId;
    return this.db.transaction(async (tx) => {
      const driver = await this.lockDriver(tx, driverId);
      if (!EDITABLE_PROFILE_STATUSES.includes(driver.status)) {
        throw new AppError(
          'PROFILE_NOT_EDITABLE',
          `The profile cannot be edited while ${driver.status}.`,
          {
            extensions: { currentStatus: driver.status },
          },
        );
      }
      await this.drivers.updateProfile(tx, driverId, {
        fullLegalName: changes.fullLegalName?.trim().replace(/\s+/g, ' '),
        drivingLicenseNumber: changes.drivingLicenseNumber
          ? normaliseLicenseNumber(changes.drivingLicenseNumber)
          : undefined,
      });
      return this.findDriver(tx, driverId);
    });
  }

  async registerVehicle(auth: AuthContext, input: RegisterVehicleInput): Promise<Vehicle> {
    const actor = actorAs(auth, 'driver');
    return this.db.transaction(async (tx) => {
      const driver = await this.lockDriver(tx, actor.userId);
      if (driver.status === 'suspended') {
        throw new AppError('PROFILE_NOT_EDITABLE', 'Suspended drivers cannot register vehicles.', {
          extensions: { currentStatus: driver.status },
        });
      }
      const vehicle = await this.fleet.registerVehicle(tx, driver.userId, input);
      await this.audit.record(tx, {
        actor,
        action: 'vehicle.registered',
        entityType: 'vehicle',
        entityId: vehicle.id,
        metadata: { vehicleTypeCode: vehicle.vehicleTypeCode },
      });
      return vehicle;
    });
  }

  async listVehicles(auth: AuthContext): Promise<Vehicle[]> {
    const driverId = actorAs(auth, 'driver').userId;
    await this.findDriver(this.db, driverId);
    return this.fleet.listDriverVehicles(this.db, driverId);
  }

  /**
   * Issues a signed upload URL for a server-chosen path. The signed URL is obtained BEFORE the
   * transaction so no external call happens while rows are locked.
   */
  async requestDocumentUpload(
    auth: AuthContext,
    input: {
      documentType: DocumentType;
      contentType: DocumentContentType;
      vehicleId?: string | undefined;
    },
  ): Promise<{ document: DriverDocument; upload: SignedUpload }> {
    const driverId = actorAs(auth, 'driver').userId;
    const needsVehicle = isVehicleDocument(input.documentType);
    if (needsVehicle !== (input.vehicleId !== undefined)) {
      throw new AppError(
        'VALIDATION_FAILED',
        'vehicleId is required for vehicle documents and only for them.',
        {
          errors: [{ path: 'vehicleId', message: needsVehicle ? 'required' : 'not allowed' }],
        },
      );
    }
    const driver = await this.findDriver(this.db, driverId);
    if (input.vehicleId) {
      const vehicle = await this.fleet.findVehicle(this.db, input.vehicleId);
      if (!vehicle || vehicle.driverId !== driverId) throw new AppError('VEHICLE_NOT_FOUND');
    }

    const documentId = randomUUID();
    const bucket = this.config.storage.driverDocumentsBucket;
    const path = `drivers/${driver.userId}/${documentId}.${EXTENSION_BY_CONTENT_TYPE[input.contentType]}`;
    const upload = await this.storage.createSignedUploadUrl(bucket, path, input.contentType);

    const document = await this.db.transaction(async (tx) => {
      driverDocumentStateMachine.assert('(initial)', 'upload_pending', 'driver');
      return this.drivers.insertDocument(tx, {
        id: documentId,
        driverId,
        vehicleId: input.vehicleId ?? null,
        documentType: input.documentType,
        contentType: input.contentType,
        bucket,
        path,
      });
    });
    return { document, upload };
  }

  /** Confirms an upload after checking the object exists in storage. Idempotent. */
  async confirmDocumentUpload(auth: AuthContext, documentId: string): Promise<DriverDocument> {
    const actor = actorAs(auth, 'driver');
    const existing = await this.drivers.findDocument(this.db, documentId);
    if (!existing || existing.driverId !== actor.userId) throw new AppError('DOCUMENT_NOT_FOUND');
    if (existing.status !== 'upload_pending') return existing;

    if (!(await this.storage.objectExists(existing.storageBucket, existing.storagePath))) {
      throw new AppError(
        'DOCUMENT_NOT_UPLOADED',
        'Upload the file to the signed URL before confirming.',
      );
    }

    return this.db.transaction(async (tx) => {
      const document = await this.drivers.lockDocument(tx, documentId);
      if (!document) throw new AppError('DOCUMENT_NOT_FOUND');
      if (document.status !== 'upload_pending') return document;
      driverDocumentStateMachine.assert(document.status, 'uploaded', 'driver');
      const uploaded = await this.drivers.markDocumentUploaded(tx, document);
      await this.audit.record(tx, {
        actor,
        action: 'driver_document.uploaded',
        entityType: 'driver_document',
        entityId: document.id,
        metadata: { documentType: document.documentType, vehicleId: document.vehicleId },
      });
      return uploaded;
    });
  }

  async listDocuments(auth: AuthContext): Promise<DriverDocument[]> {
    const driverId = actorAs(auth, 'driver').userId;
    await this.findDriver(this.db, driverId);
    return this.drivers.listDocuments(this.db, driverId);
  }

  async submitForReview(auth: AuthContext): Promise<Driver> {
    const actor = actorAs(auth, 'driver');
    return this.db.transaction(async (tx) => {
      const driver = await this.lockDriver(tx, actor.userId);
      if (driver.status === 'pending_review') return driver; // natural idempotency
      driverStateMachine.assert(driver.status, 'pending_review', 'driver');

      const [documents, vehicles] = await Promise.all([
        this.drivers.listDocuments(tx, driver.userId),
        this.fleet.listDriverVehicles(tx, driver.userId),
      ]);
      const gaps = verificationGaps(documents, vehicles);
      if (gaps.length > 0) {
        throw new AppError(
          'VERIFICATION_REQUIREMENTS_NOT_MET',
          'Required documents or vehicle are missing.',
          {
            extensions: { missing: gaps },
          },
        );
      }
      await this.drivers.markSubmitted(tx, driver.userId);
      await this.audit.record(tx, {
        actor,
        action: 'driver.submitted_for_review',
        entityType: 'driver',
        entityId: driver.userId,
      });
      return this.findDriver(tx, driver.userId);
    });
  }

  private async findDriver(db: Queryable, driverId: string): Promise<Driver> {
    const driver = await this.drivers.find(db, driverId);
    if (!driver) throw new AppError('DRIVER_NOT_FOUND', 'No driver profile exists for this user.');
    return driver;
  }

  private async lockDriver(tx: Tx, driverId: string): Promise<Driver> {
    const driver = await this.drivers.lock(tx, driverId);
    if (!driver) throw new AppError('DRIVER_NOT_FOUND', 'No driver profile exists for this user.');
    return driver;
  }
}
