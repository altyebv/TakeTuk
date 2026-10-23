import { Module } from '@nestjs/common';
import { DriversModule } from '../drivers';
import { FinanceModule } from '../finance';
import { FleetModule } from '../fleet';
import { PricingModule } from '../pricing';
import { AssignmentService } from './application/assignment.service';
import { DispatchService, DispatchWorker } from './application/dispatch.service';
import { DriverOffersService } from './application/driver-offers.service';
import { RideLifecycleService } from './application/ride-lifecycle.service';
import { RideRequestService } from './application/ride-request.service';
import { RideViews } from './application/ride-views';
import { TripService } from './application/trip.service';
import {
  AdminRidesController,
  DriverOffersController,
  DriverRidesController,
  PassengerRidesController,
} from './http/mobility.controllers';
import { AssignmentsRepository } from './infrastructure/assignments.repository';
import { DispatchCandidatesQuery } from './infrastructure/dispatch-candidates.query';
import { OffersRepository } from './infrastructure/offers.repository';
import { RidesRepository } from './infrastructure/rides.repository';

@Module({
  imports: [PricingModule, DriversModule, FleetModule, FinanceModule],
  controllers: [
    PassengerRidesController,
    DriverOffersController,
    DriverRidesController,
    AdminRidesController,
  ],
  providers: [
    RidesRepository,
    OffersRepository,
    AssignmentsRepository,
    DispatchCandidatesQuery,
    RideViews,
    RideLifecycleService,
    AssignmentService,
    DispatchService,
    DispatchWorker,
    RideRequestService,
    DriverOffersService,
    TripService,
  ],
  exports: [DispatchService],
})
export class MobilityModule {}
