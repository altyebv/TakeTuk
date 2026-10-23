import { Module } from '@nestjs/common';
import { FleetService } from './application/fleet.service';
import { FleetController } from './http/fleet.controller';
import { VehiclesRepository } from './infrastructure/vehicles.repository';

@Module({
  controllers: [FleetController],
  providers: [VehiclesRepository, FleetService],
  exports: [FleetService],
})
export class FleetModule {}
