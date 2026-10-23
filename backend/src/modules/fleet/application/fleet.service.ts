import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { AppError } from '../../../shared/errors/app-error';
import {
  normalisePlate,
  vehicleStateMachine,
  type Vehicle,
  type VehicleStatus,
  type VehicleTypeInfo,
} from '../domain/vehicle';
import { VehiclesRepository } from '../infrastructure/vehicles.repository';

export interface RegisterVehicleInput {
  readonly vehicleTypeCode: string;
  readonly plateNumber: string;
  readonly description: string | null;
}

/**
 * Fleet module public API. Vehicle records and the vehicle state machine live here; the drivers
 * module orchestrates driver-facing and review use cases through this service.
 */
@Injectable()
export class FleetService {
  constructor(private readonly vehicles: VehiclesRepository) {}

  listVehicleTypes(db: Queryable): Promise<VehicleTypeInfo[]> {
    return this.vehicles.listVehicleTypes(db);
  }

  isCompatible(db: Queryable, vehicleTypeCode: string, serviceTypeCode: string): Promise<boolean> {
    return this.vehicles.isCompatible(db, vehicleTypeCode, serviceTypeCode);
  }

  async registerVehicle(tx: Tx, driverId: string, input: RegisterVehicleInput): Promise<Vehicle> {
    if (!(await this.vehicles.vehicleTypeExists(tx, input.vehicleTypeCode))) {
      throw new AppError('VEHICLE_NOT_ELIGIBLE', `Unknown vehicle type ${input.vehicleTypeCode}.`);
    }
    vehicleStateMachine.assert('(initial)', 'pending_review', 'driver');
    return this.vehicles.insert(tx, {
      driverId,
      vehicleTypeCode: input.vehicleTypeCode,
      plateNumber: normalisePlate(input.plateNumber),
      description: input.description,
    });
  }

  findVehicle(db: Queryable, vehicleId: string): Promise<Vehicle | null> {
    return this.vehicles.find(db, vehicleId);
  }

  lockVehicle(tx: Tx, vehicleId: string): Promise<Vehicle | null> {
    return this.vehicles.lock(tx, vehicleId);
  }

  listDriverVehicles(db: Queryable, driverId: string): Promise<Vehicle[]> {
    return this.vehicles.listByDriver(db, driverId);
  }

  /** Admin review transition. The caller must hold the vehicle row lock (`lockVehicle`). */
  async reviewVehicle(
    tx: Tx,
    vehicle: Vehicle,
    to: VehicleStatus,
    reviewer: { userId: string },
    note: string | null,
  ): Promise<Vehicle> {
    if (vehicle.status === to) {
      return vehicle; // naturally idempotent repeat
    }
    vehicleStateMachine.assert(vehicle.status, to, 'admin');
    return this.vehicles.updateReview(tx, vehicle.id, {
      status: to,
      reviewedBy: reviewer.userId,
      note,
    });
  }
}
