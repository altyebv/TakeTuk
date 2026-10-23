import { Injectable } from '@nestjs/common';
import type { DispatchSettings } from '../../../config/app-config';
import type { Queryable } from '../../../infrastructure/database/database';

export interface DispatchCandidate {
  readonly driverId: string;
  readonly vehicleId: string;
  readonly distanceToPickupMeters: number;
}

/**
 * Candidate selection for one ride (DOMAIN_MODEL §7, ADR-0012), in a single SQL statement.
 *
 * Documented module-boundary exception (ADR-0001): this read-only query joins tables owned by
 * the drivers and fleet modules (drivers, vehicles, driver_locations, compatibility). It never
 * writes them. Nearby-driver discovery uses PostGIS on our own positions — never the routing API.
 */
@Injectable()
export class DispatchCandidatesQuery {
  async find(
    db: Queryable,
    rideId: string,
    settings: DispatchSettings,
  ): Promise<DispatchCandidate[]> {
    const { rows } = await db.query<{ driver_id: string; vehicle_id: string; distance_m: number }>(
      `select d.user_id as driver_id,
              d.active_vehicle_id as vehicle_id,
              round(extensions.st_distance(l.location, r.pickup))::integer as distance_m
         from taketuk.rides r
         join taketuk.drivers d
           on d.service_area_id = r.service_area_id
         join taketuk.vehicles v
           on v.id = d.active_vehicle_id and v.driver_id = d.user_id
         join taketuk.vehicle_types vt
           on vt.code = v.vehicle_type_code and vt.active
         join taketuk.service_vehicle_compatibility c
           on c.vehicle_type_code = v.vehicle_type_code and c.service_type_code = r.service_type_code
         join taketuk.driver_locations l
           on l.driver_id = d.user_id
        where r.id = $1
          and d.status = 'approved'
          and d.availability = 'online'
          and v.status = 'approved'
          and d.user_id <> r.passenger_id
          and l.received_at > now() - make_interval(secs => $2)
          and extensions.st_dwithin(l.location, r.pickup, $3)
          and not exists (select 1 from taketuk.ride_assignments a
                           where a.driver_id = d.user_id and a.status = 'active')
          and not exists (select 1 from taketuk.ride_offers o
                           where o.driver_id = d.user_id and o.status in ('pending', 'countered')
                             and o.expires_at > now())
          and not exists (select 1 from taketuk.ride_offers o2
                           where o2.ride_id = r.id and o2.driver_id = d.user_id)
        order by extensions.st_distance(l.location, r.pickup), d.user_id
        limit $4`,
      [rideId, settings.locationMaxAgeSeconds, settings.radiusMeters, settings.batchSize],
    );
    return rows.map((r) => ({
      driverId: r.driver_id,
      vehicleId: r.vehicle_id,
      distanceToPickupMeters: r.distance_m,
    }));
  }
}
