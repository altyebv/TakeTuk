import { Injectable } from '@nestjs/common';
import type { Queryable } from '../../../infrastructure/database/database';
import { AppError } from '../../../shared/errors/app-error';
import type { Coordinates } from '../../../shared/schemas';
import { sqlPoint } from '../domain/geo';

export interface ServiceArea {
  readonly id: string;
  readonly code: string;
  readonly displayName: string;
  readonly timezone: string;
}

interface AreaRow {
  id: string;
  code: string;
  display_name: string;
  timezone: string;
}

const toArea = (row: AreaRow): ServiceArea => ({
  id: row.id,
  code: row.code,
  displayName: row.display_name,
  timezone: row.timezone,
});

@Injectable()
export class ServiceAreasService {
  /**
   * The active area that contains both points and offers the service (PRC-7: both pickup and
   * destination must be inside the same area).
   */
  async resolveTripArea(
    db: Queryable,
    pickup: Coordinates,
    destination: Coordinates,
    serviceTypeCode: string,
  ): Promise<ServiceArea> {
    const { rows } = await db.query<
      AreaRow & { covers_destination: boolean; service_enabled: boolean }
    >(
      `select a.id, a.code, a.display_name, a.timezone,
              extensions.st_covers(a.boundary, ${sqlPoint('$4', '$3')}) as covers_destination,
              coalesce(s.enabled, false) as service_enabled
         from taketuk.service_areas a
         left join taketuk.service_area_services s
           on s.service_area_id = a.id and s.service_type_code = $5
        where a.status = 'active'
          and extensions.st_covers(a.boundary, ${sqlPoint('$2', '$1')})
        order by a.code
        limit 1`,
      [pickup.lat, pickup.lng, destination.lat, destination.lng, serviceTypeCode],
    );
    const row = rows[0];
    if (!row) {
      throw new AppError(
        'OUTSIDE_SERVICE_AREA',
        'The pickup location is outside every active service area.',
      );
    }
    if (!row.covers_destination) {
      throw new AppError(
        'OUTSIDE_SERVICE_AREA',
        'The destination is outside the service area of the pickup.',
      );
    }
    if (!row.service_enabled) {
      throw new AppError(
        'SERVICE_NOT_AVAILABLE',
        `The service ${serviceTypeCode} is not offered in ${row.code}.`,
      );
    }
    return toArea(row);
  }

  async findActiveByCode(db: Queryable, code: string): Promise<ServiceArea | null> {
    const { rows } = await db.query<AreaRow>(
      `select id, code, display_name, timezone from taketuk.service_areas where code = $1 and status = 'active'`,
      [code],
    );
    return rows[0] ? toArea(rows[0]) : null;
  }
}
