import { Injectable } from '@nestjs/common';
import { Database, type Tx } from '../../../infrastructure/database/database';
import { AuditService } from '../../../platform/audit';
import { actorAs, type AuthContext } from '../../../shared/auth/auth-context';
import { AppError } from '../../../shared/errors/app-error';
import { FleetService } from '../../fleet';
import type { Driver, DriverAvailability, DriverStatus } from '../domain/driver';
import { DriversRepository } from '../infrastructure/drivers.repository';
import { required } from '../../../shared/required';

/** Maximum tolerated device clock skew into the future for location timestamps. */
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface OperationalDriver {
  readonly driverId: string;
  readonly status: DriverStatus;
  readonly availability: DriverAvailability;
  readonly serviceAreaId: string;
  readonly activeVehicleId: string | null;
  readonly activeVehicleStatus: string | null;
  readonly activeVehicleTypeCode: string | null;
}

/** Driver availability and location use cases, plus the eligibility view used by mobility. */
@Injectable()
export class DriverOperationsService {
  constructor(
    private readonly db: Database,
    private readonly drivers: DriversRepository,
    private readonly fleet: FleetService,
    private readonly audit: AuditService,
  ) {}

  async setAvailability(
    auth: AuthContext,
    input: { availability: DriverAvailability; vehicleId?: string | undefined },
  ): Promise<Driver> {
    const actor = actorAs(auth, 'driver');
    return this.db.transaction(async (tx) => {
      const driver = await this.drivers.lock(tx, actor.userId);
      if (!driver) throw new AppError('DRIVER_NOT_FOUND');

      if (input.availability === 'offline') {
        if (driver.availability !== 'offline') {
          await this.drivers.setAvailability(tx, driver.userId, 'offline', driver.activeVehicleId);
          await this.audit.record(tx, {
            actor,
            action: 'driver.went_offline',
            entityType: 'driver',
            entityId: driver.userId,
          });
        }
        return required(await this.drivers.find(tx, driver.userId), 'record');
      }

      if (driver.status !== 'approved') {
        throw new AppError(
          'DRIVER_NOT_APPROVED',
          `Drivers can go online only when approved (currently ${driver.status}).`,
        );
      }
      const vehicleId = input.vehicleId ?? driver.activeVehicleId;
      if (!vehicleId) {
        throw new AppError('VALIDATION_FAILED', 'Choose the vehicle to go online with.', {
          errors: [{ path: 'vehicleId', message: 'required' }],
        });
      }
      const vehicle = await this.fleet.lockVehicle(tx, vehicleId);
      if (!vehicle || vehicle.driverId !== driver.userId) throw new AppError('VEHICLE_NOT_FOUND');
      if (vehicle.status !== 'approved') {
        throw new AppError(
          'VEHICLE_NOT_ELIGIBLE',
          `The vehicle is ${vehicle.status}, not approved.`,
        );
      }
      const changed = driver.availability !== 'online' || driver.activeVehicleId !== vehicle.id;
      await this.drivers.setAvailability(tx, driver.userId, 'online', vehicle.id);
      if (changed) {
        await this.audit.record(tx, {
          actor,
          action: 'driver.went_online',
          entityType: 'driver',
          entityId: driver.userId,
          metadata: { vehicleId: vehicle.id },
        });
      }
      return required(await this.drivers.find(tx, driver.userId), 'record');
    });
  }

  /**
   * Stores the latest position. Freshness for matching uses the server receive time, never the
   * device clock. Only approved drivers may report positions.
   */
  async updateLocation(
    auth: AuthContext,
    input: { lat: number; lng: number; accuracyMeters?: number | undefined; recordedAt: string },
  ): Promise<{ receivedAt: Date }> {
    const driverId = actorAs(auth, 'driver').userId;
    const recordedAt = new Date(input.recordedAt);
    if (recordedAt.getTime() > Date.now() + MAX_FUTURE_SKEW_MS) {
      throw new AppError('VALIDATION_FAILED', 'recordedAt is in the future.', {
        errors: [{ path: 'recordedAt', message: 'must not be in the future' }],
      });
    }
    const driver = await this.drivers.find(this.db, driverId);
    if (!driver) throw new AppError('DRIVER_NOT_FOUND');
    if (driver.status !== 'approved') throw new AppError('DRIVER_NOT_APPROVED');
    const receivedAt = await this.drivers.upsertLocation(this.db, {
      driverId,
      lat: input.lat,
      lng: input.lng,
      accuracyMeters: input.accuracyMeters ?? null,
      recordedAt,
    });
    return { receivedAt };
  }

  /**
   * Locks the driver row and returns what assignment needs to re-check eligibility inside the
   * caller's transaction (lock order: ride → offer → driver).
   */
  async lockOperationalDriver(tx: Tx, driverId: string): Promise<OperationalDriver | null> {
    const driver = await this.drivers.lock(tx, driverId);
    if (!driver) return null;
    const vehicle = driver.activeVehicleId
      ? await this.fleet.findVehicle(tx, driver.activeVehicleId)
      : null;
    return {
      driverId: driver.userId,
      status: driver.status,
      availability: driver.availability,
      serviceAreaId: driver.serviceAreaId,
      activeVehicleId: driver.activeVehicleId,
      activeVehicleStatus: vehicle?.status ?? null,
      activeVehicleTypeCode: vehicle?.vehicleTypeCode ?? null,
    };
  }
}
