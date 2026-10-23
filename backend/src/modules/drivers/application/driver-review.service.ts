import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../../config/app-config';
import { Database, type Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { OutboxService } from '../../../platform/outbox';
import { actorAs, type Actor, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { decodeCursor, toPage, type Page } from '../../../shared/pagination';
import { FleetService, type Vehicle, type VehicleStatus } from '../../fleet';
import {
  driverStateMachine,
  type Driver,
  type DriverDocument,
  type DriverStatus,
} from '../domain/driver';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../infrastructure/document-storage';
import { DriversRepository } from '../infrastructure/drivers.repository';
import { required } from '../../../shared/required';

export type DriverDecision = 'approve' | 'reject' | 'suspend' | 'reinstate';

const DRIVER_DECISIONS: Readonly<
  Record<DriverDecision, { to: DriverStatus; action: string; noteRequired: boolean }>
> = {
  approve: { to: 'approved', action: 'driver.approved', noteRequired: false },
  reject: { to: 'rejected', action: 'driver.rejected', noteRequired: true },
  suspend: { to: 'suspended', action: 'driver.suspended', noteRequired: true },
  reinstate: { to: 'approved', action: 'driver.reinstated', noteRequired: false },
};

const EXPECTED_FROM: Readonly<Record<DriverDecision, DriverStatus>> = {
  approve: 'pending_review',
  reject: 'pending_review',
  suspend: 'approved',
  reinstate: 'suspended',
};

const VEHICLE_DECISIONS: Readonly<
  Record<
    DriverDecision,
    { to: VehicleStatus; from: VehicleStatus; action: string; noteRequired: boolean }
  >
> = {
  approve: {
    to: 'approved',
    from: 'pending_review',
    action: 'vehicle.approved',
    noteRequired: false,
  },
  reject: {
    to: 'rejected',
    from: 'pending_review',
    action: 'vehicle.rejected',
    noteRequired: true,
  },
  suspend: { to: 'suspended', from: 'approved', action: 'vehicle.suspended', noteRequired: true },
  reinstate: {
    to: 'approved',
    from: 'suspended',
    action: 'vehicle.reinstated',
    noteRequired: false,
  },
};

export interface DriverReviewView {
  readonly driver: Driver;
  readonly vehicles: Vehicle[];
  readonly documents: DriverDocument[];
}

/** Admin verification and suspension use cases (STATE_MACHINES §6). */
@Injectable()
export class DriverReviewService {
  constructor(
    private readonly db: Database,
    private readonly drivers: DriversRepository,
    private readonly fleet: FleetService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async list(filter: {
    status?: DriverStatus | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<Page<Driver>> {
    const after = decodeCursor(filter.cursor);
    const rows = await this.drivers.list(this.db, {
      status: filter.status,
      limit: filter.limit + 1,
      after,
    });
    return toPage(
      rows,
      filter.limit,
      (r) => r.driver,
      (r) => ({ sortKey: r.sortKey, id: r.driver.userId }),
    );
  }

  async getForReview(driverId: string): Promise<DriverReviewView> {
    const driver = await this.drivers.find(this.db, driverId);
    if (!driver) throw new AppError('DRIVER_NOT_FOUND');
    const [vehicles, documents] = await Promise.all([
      this.fleet.listDriverVehicles(this.db, driverId),
      this.drivers.listDocuments(this.db, driverId),
    ]);
    return { driver, vehicles, documents };
  }

  async decideDriver(
    auth: AuthContext,
    driverId: string,
    decision: DriverDecision,
    note: string | null,
  ): Promise<Driver> {
    const admin = actorAs(auth, 'admin');
    const rule = DRIVER_DECISIONS[decision];
    if (rule.noteRequired && !note) {
      throw new AppError('VALIDATION_FAILED', `A note is required to ${decision} a driver.`, {
        errors: [{ path: 'note', message: 'required' }],
      });
    }
    if (admin.userId === driverId) {
      throw new AppError('SELF_REVIEW_FORBIDDEN');
    }
    return this.db.transaction(async (tx) => {
      const driver = await this.drivers.lock(tx, driverId);
      if (!driver) throw new AppError('DRIVER_NOT_FOUND');
      if (driver.status === rule.to && EXPECTED_FROM[decision] !== driver.status) {
        return driver; // natural idempotency: decision already applied
      }
      if (driver.status !== EXPECTED_FROM[decision]) {
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `Cannot ${decision} a driver who is ${driver.status}.`,
          {
            extensions: { currentStatus: driver.status },
          },
        );
      }
      driverStateMachine.assert(driver.status, rule.to, 'admin');
      await this.drivers.updateReview(tx, driverId, {
        status: rule.to,
        reviewedBy: admin.userId,
        note,
      });
      await this.audit.record(tx, {
        actor: admin,
        action: rule.action,
        entityType: 'driver',
        entityId: driverId,
        metadata: { from: driver.status, to: rule.to, ...(note ? { note } : {}) },
      });
      await this.outbox.enqueue(tx, {
        type: rule.action,
        aggregateType: 'driver',
        aggregateId: driverId,
        payload: { driverId, status: rule.to },
      });
      return required(await this.drivers.find(tx, driverId), 'record');
    });
  }

  async decideVehicle(
    auth: AuthContext,
    vehicleId: string,
    decision: DriverDecision,
    note: string | null,
  ): Promise<Vehicle> {
    const admin = actorAs(auth, 'admin');
    const rule = VEHICLE_DECISIONS[decision];
    if (rule.noteRequired && !note) {
      throw new AppError('VALIDATION_FAILED', `A note is required to ${decision} a vehicle.`, {
        errors: [{ path: 'note', message: 'required' }],
      });
    }
    const unlocked = await this.fleet.findVehicle(this.db, vehicleId);
    if (!unlocked) throw new AppError('VEHICLE_NOT_FOUND');
    if (unlocked.driverId === admin.userId) throw new AppError('SELF_REVIEW_FORBIDDEN');

    return this.db.transaction(async (tx) => {
      // Lock order: driver, then vehicle (STATE_MACHINES §3).
      const driver = await this.drivers.lock(tx, unlocked.driverId);
      const vehicle = await this.fleet.lockVehicle(tx, vehicleId);
      if (!driver || !vehicle) throw new AppError('VEHICLE_NOT_FOUND');
      if (vehicle.status === rule.to && vehicle.status !== rule.from) return vehicle;
      if (vehicle.status !== rule.from) {
        throw new AppError(
          'INVALID_STATE_TRANSITION',
          `Cannot ${decision} a vehicle that is ${vehicle.status}.`,
          {
            extensions: { currentStatus: vehicle.status },
          },
        );
      }
      const updated = await this.fleet.reviewVehicle(tx, vehicle, rule.to, admin, note);
      if (
        rule.to === 'suspended' &&
        driver.activeVehicleId === vehicle.id &&
        driver.availability === 'online'
      ) {
        await this.drivers.setAvailability(tx, driver.userId, 'offline', driver.activeVehicleId);
        await this.recordAvailability(
          tx,
          admin,
          driver.userId,
          'driver.went_offline',
          'vehicle_suspended',
        );
      }
      await this.audit.record(tx, {
        actor: admin,
        action: rule.action,
        entityType: 'vehicle',
        entityId: vehicle.id,
        metadata: {
          driverId: vehicle.driverId,
          from: vehicle.status,
          to: rule.to,
          ...(note ? { note } : {}),
        },
      });
      return updated;
    });
  }

  /**
   * Issues a short-lived signed view URL for a driver document. The URL is issued first and the
   * view is audited before the URL is returned; if auditing fails the URL is never delivered.
   */
  async documentViewUrl(
    auth: AuthContext,
    driverId: string,
    documentId: string,
  ): Promise<{ url: string; expiresAt: Date }> {
    const admin = actorAs(auth, 'admin');
    const document = await this.drivers.findDocument(this.db, documentId);
    if (!document || document.driverId !== driverId || document.status === 'upload_pending') {
      throw new AppError('DOCUMENT_NOT_FOUND');
    }
    const signed = await this.storage.createSignedViewUrl(
      document.storageBucket,
      document.storagePath,
      this.config.storage.viewUrlTtlSeconds,
    );
    await this.db.transaction((tx) =>
      this.audit.record(tx, {
        actor: admin,
        action: 'driver_document.viewed',
        entityType: 'driver_document',
        entityId: document.id,
        metadata: {
          driverId,
          documentType: document.documentType,
          ttlSeconds: this.config.storage.viewUrlTtlSeconds,
        },
      }),
    );
    return signed;
  }

  private async recordAvailability(
    tx: Tx,
    actor: Actor,
    driverId: string,
    action: string,
    reason: string,
  ) {
    await this.audit.record(tx, {
      actor,
      action,
      entityType: 'driver',
      entityId: driverId,
      metadata: { reason },
    });
  }
}
