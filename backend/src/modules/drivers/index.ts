export { DriversModule } from './drivers.module';
export {
  DriverOperationsService,
  type OperationalDriver,
} from './application/driver-operations.service';
export {
  DOCUMENT_STORAGE,
  InMemoryDocumentStorage,
  SupabaseDocumentStorage,
  type DocumentStorage,
  type SignedUpload,
} from './infrastructure/document-storage';
export {
  DRIVER_STATUSES,
  driverStateMachine,
  driverDocumentStateMachine,
  verificationGaps,
  REQUIRED_DRIVER_DOCUMENTS,
  REQUIRED_VEHICLE_DOCUMENTS,
  type Driver,
  type DriverStatus,
  type DocumentType,
} from './domain/driver';
