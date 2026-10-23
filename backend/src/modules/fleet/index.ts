export { FleetModule } from './fleet.module';
export { FleetService, type RegisterVehicleInput } from './application/fleet.service';
export {
  VEHICLE_STATUSES,
  normalisePlate,
  vehicleStateMachine,
  type Vehicle,
  type VehicleStatus,
  type VehicleTypeInfo,
} from './domain/vehicle';
