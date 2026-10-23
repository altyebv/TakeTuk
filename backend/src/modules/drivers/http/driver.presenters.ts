import { z } from 'zod';
import { isoDate } from '../../../shared/schemas';
import { VEHICLE_STATUSES, type Vehicle } from '../../fleet';
import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_TYPES,
  DRIVER_STATUSES,
  type Driver,
  type DriverDocument,
} from '../domain/driver';

export const DriverProfileSchema = z.object({
  userId: z.uuid(),
  serviceAreaCode: z.string(),
  status: z.enum(DRIVER_STATUSES),
  fullLegalName: z.string(),
  drivingLicenseNumber: z.string(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  reviewNote: z.string().nullable(),
  availability: z.enum(['offline', 'online']),
  activeVehicleId: z.uuid().nullable(),
  createdAt: z.string(),
});
export type DriverProfileResponse = z.infer<typeof DriverProfileSchema>;

export const VehicleSchema = z.object({
  id: z.uuid(),
  driverId: z.uuid(),
  vehicleTypeCode: z.string(),
  plateNumber: z.string(),
  description: z.string().nullable(),
  status: z.enum(VEHICLE_STATUSES),
  reviewNote: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type VehicleResponse = z.infer<typeof VehicleSchema>;

export const DriverDocumentSchema = z.object({
  id: z.uuid(),
  documentType: z.enum(DOCUMENT_TYPES),
  vehicleId: z.uuid().nullable(),
  contentType: z.enum(DOCUMENT_CONTENT_TYPES),
  status: z.enum(['upload_pending', 'uploaded', 'superseded']),
  createdAt: z.string(),
  uploadedAt: z.string().nullable(),
});
export type DriverDocumentResponse = z.infer<typeof DriverDocumentSchema>;

export const presentDriver = (driver: Driver): DriverProfileResponse => ({
  userId: driver.userId,
  serviceAreaCode: driver.serviceAreaCode,
  status: driver.status,
  fullLegalName: driver.fullLegalName,
  drivingLicenseNumber: driver.drivingLicenseNumber,
  submittedAt: isoDate(driver.submittedAt),
  reviewedAt: isoDate(driver.reviewedAt),
  reviewNote: driver.reviewNote,
  availability: driver.availability,
  activeVehicleId: driver.activeVehicleId,
  createdAt: driver.createdAt.toISOString(),
});

export const presentVehicle = (vehicle: Vehicle): VehicleResponse => ({
  id: vehicle.id,
  driverId: vehicle.driverId,
  vehicleTypeCode: vehicle.vehicleTypeCode,
  plateNumber: vehicle.plateNumber,
  description: vehicle.description,
  status: vehicle.status,
  reviewNote: vehicle.reviewNote,
  reviewedAt: isoDate(vehicle.reviewedAt),
  createdAt: vehicle.createdAt.toISOString(),
});

/** Storage paths and buckets are never exposed to clients. */
export const presentDocument = (document: DriverDocument): DriverDocumentResponse => ({
  id: document.id,
  documentType: document.documentType,
  vehicleId: document.vehicleId,
  contentType: document.contentType,
  status: document.status,
  createdAt: document.createdAt.toISOString(),
  uploadedAt: isoDate(document.uploadedAt),
});
