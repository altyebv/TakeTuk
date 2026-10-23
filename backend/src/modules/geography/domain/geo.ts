import type { Coordinates } from '../../../shared/schemas';

const EARTH_RADIUS_METERS = 6_371_008.8;

/**
 * Great-circle (straight-line) distance. Used for input validation and by the development
 * routing fake only — never as a substitute for road distance in an authoritative fare (ADR-0009).
 */
export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Coordinates closer than this (≈1 m) are treated as the same place. */
export function isSamePlace(a: Coordinates, b: Coordinates): boolean {
  return haversineMeters(a, b) < 1;
}

/**
 * SQL for a PostGIS geography point from (lng, lat) placeholders. PostGIS is called with
 * schema-qualified names so queries do not depend on search_path (ADR-0005).
 */
export function sqlPoint(lngParam: string, latParam: string): string {
  return `extensions.st_setsrid(extensions.st_makepoint(${lngParam}, ${latParam}), 4326)::extensions.geography`;
}

/** SQL selecting lat/lng columns from a geography(Point) column. */
export function sqlLatLng(column: string, prefix: string): string {
  return `extensions.st_y(${column}::extensions.geometry) as ${prefix}_lat,
          extensions.st_x(${column}::extensions.geometry) as ${prefix}_lng`;
}
