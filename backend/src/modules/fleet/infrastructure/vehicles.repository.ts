import { Injectable } from '@nestjs/common';
import type { Queryable, Tx } from '../../../infrastructure/database/database';
import { isUniqueViolation } from '../../../infrastructure/database/pg-errors';
import { AppError } from '../../../shared/errors/app-error';
import type { Vehicle, VehicleStatus, VehicleTypeInfo } from '../domain/vehicle';
import { required } from '../../../shared/required';

interface VehicleRow {
  id: string;
  driver_id: string;
  vehicle_type_code: string;
  plate_number: string;
  description: string | null;
  status: VehicleStatus;
  review_note: string | null;
  reviewed_at: Date | null;
  created_at: Date;
}

const VEHICLE_COLUMNS = `id, driver_id, vehicle_type_code, plate_number, description, status,
  review_note, reviewed_at, created_at`;

const toVehicle = (row: VehicleRow): Vehicle => ({
  id: row.id,
  driverId: row.driver_id,
  vehicleTypeCode: row.vehicle_type_code,
  plateNumber: row.plate_number,
  description: row.description,
  status: row.status,
  reviewNote: row.review_note,
  reviewedAt: row.reviewed_at,
  createdAt: row.created_at,
});

@Injectable()
export class VehiclesRepository {
  async listVehicleTypes(db: Queryable): Promise<VehicleTypeInfo[]> {
    const { rows } = await db.query<{
      code: string;
      display_name: string;
      passenger_capable: boolean;
      services: string[] | null;
    }>(
      `select t.code, t.display_name, t.passenger_capable,
              array_remove(array_agg(c.service_type_code order by c.service_type_code), null) as services
         from taketuk.vehicle_types t
         left join taketuk.service_vehicle_compatibility c on c.vehicle_type_code = t.code
        where t.active
        group by t.code
        order by t.code`,
    );
    return rows.map((r) => ({
      code: r.code,
      displayName: r.display_name,
      passengerCapable: r.passenger_capable,
      compatibleServiceTypes: r.services ?? [],
    }));
  }

  async vehicleTypeExists(db: Queryable, code: string): Promise<boolean> {
    const { rows } = await db.query(
      `select 1 from taketuk.vehicle_types where code = $1 and active`,
      [code],
    );
    return rows.length > 0;
  }

  async isCompatible(
    db: Queryable,
    vehicleTypeCode: string,
    serviceTypeCode: string,
  ): Promise<boolean> {
    const { rows } = await db.query(
      `select 1 from taketuk.service_vehicle_compatibility c
         join taketuk.vehicle_types v on v.code = c.vehicle_type_code and v.active
         join taketuk.service_types s on s.code = c.service_type_code and s.active
        where c.vehicle_type_code = $1 and c.service_type_code = $2`,
      [vehicleTypeCode, serviceTypeCode],
    );
    return rows.length > 0;
  }

  async insert(
    tx: Tx,
    input: {
      driverId: string;
      vehicleTypeCode: string;
      plateNumber: string;
      description: string | null;
    },
  ): Promise<Vehicle> {
    try {
      const { rows } = await tx.query<VehicleRow>(
        `insert into taketuk.vehicles (driver_id, vehicle_type_code, plate_number, description, status)
         values ($1, $2, $3, $4, 'pending_review')
         returning ${VEHICLE_COLUMNS}`,
        [input.driverId, input.vehicleTypeCode, input.plateNumber, input.description],
      );
      return toVehicle(required(rows[0], 'row'));
    } catch (error) {
      if (isUniqueViolation(error, 'vehicles_driver_plate_unique')) {
        throw new AppError(
          'VEHICLE_ALREADY_REGISTERED',
          'You have already registered this plate number.',
        );
      }
      throw error;
    }
  }

  async find(db: Queryable, vehicleId: string): Promise<Vehicle | null> {
    const { rows } = await db.query<VehicleRow>(
      `select ${VEHICLE_COLUMNS} from taketuk.vehicles where id = $1`,
      [vehicleId],
    );
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async lock(tx: Tx, vehicleId: string): Promise<Vehicle | null> {
    const { rows } = await tx.query<VehicleRow>(
      `select ${VEHICLE_COLUMNS} from taketuk.vehicles where id = $1 for update`,
      [vehicleId],
    );
    return rows[0] ? toVehicle(rows[0]) : null;
  }

  async listByDriver(db: Queryable, driverId: string): Promise<Vehicle[]> {
    const { rows } = await db.query<VehicleRow>(
      `select ${VEHICLE_COLUMNS} from taketuk.vehicles where driver_id = $1 order by created_at, id`,
      [driverId],
    );
    return rows.map(toVehicle);
  }

  async updateReview(
    tx: Tx,
    vehicleId: string,
    change: { status: VehicleStatus; reviewedBy: string; note: string | null },
  ): Promise<Vehicle> {
    const { rows } = await tx.query<VehicleRow>(
      `update taketuk.vehicles
          set status = $2, reviewed_by = $3, reviewed_at = now(), review_note = $4
        where id = $1
        returning ${VEHICLE_COLUMNS}`,
      [vehicleId, change.status, change.reviewedBy, change.note],
    );
    return toVehicle(required(rows[0], 'row'));
  }
}
