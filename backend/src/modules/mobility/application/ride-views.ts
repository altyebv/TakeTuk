import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Queryable } from '../../../infrastructure/database/database';
import { isoDate, MoneyResponseSchema, type Money } from '../../../shared/schemas';
import { FinanceService, presentPayment, RidePaymentSchema } from '../../finance';
import { FleetService } from '../../fleet';
import { IdentityService } from '../../identity';
import { OFFER_STATUSES, type RideOffer } from '../domain/offer';
import { CONTACT_VISIBLE_STATUSES, RIDE_STATUSES, type Ride } from '../domain/ride';
import { AssignmentsRepository } from '../infrastructure/assignments.repository';
import { OffersRepository } from '../infrastructure/offers.repository';

/*
 * API representations of rides and offers. Each audience sees only what it needs:
 * - contact numbers only while an assignment is active (IDN-2);
 * - drivers never see other drivers' offers; passengers see counteroffers, not driver phones.
 */

const PlaceSchema = z.object({ lat: z.number(), lng: z.number(), label: z.string().nullable() });
const RouteSchema = z.object({
  distanceMeters: z.number().int(),
  durationSeconds: z.number().int().nullable(),
  provider: z.string(),
});
const CancellationSchema = z
  .object({
    cancelledByRole: z.enum(['passenger', 'driver', 'admin', 'system']),
    reason: z.string().nullable(),
    statusBeforeCancellation: z.enum(RIDE_STATUSES),
  })
  .nullable();
const VehicleSummarySchema = z.object({
  vehicleTypeCode: z.string(),
  plateNumber: z.string(),
  description: z.string().nullable(),
});

const Timeline = {
  createdAt: z.string(),
  searchExpiresAt: z.string(),
  assignedAt: z.string().nullable(),
  driverArrivedAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  expiredAt: z.string().nullable(),
};

export const CounterofferSchema = z.object({
  offerId: z.uuid(),
  status: z.enum(OFFER_STATUSES),
  amount: MoneyResponseSchema,
  expiresAt: z.string(),
  driverDisplayName: z.string(),
  vehicleTypeCode: z.string(),
  distanceToPickupMeters: z.number().int(),
});

export const PassengerRideSchema = z.object({
  id: z.uuid(),
  status: z.enum(RIDE_STATUSES),
  serviceTypeCode: z.string(),
  pickup: PlaceSchema,
  destination: PlaceSchema,
  route: RouteSchema,
  minimumFare: MoneyResponseSchema,
  proposedFare: MoneyResponseSchema,
  agreedFare: MoneyResponseSchema.nullable(),
  farePolicy: z.object({ id: z.uuid(), version: z.number().int() }),
  ...Timeline,
  cancellation: CancellationSchema,
  negotiation: z.object({
    driversNotified: z.number().int(),
    counteroffers: z.array(CounterofferSchema),
  }),
  driver: z
    .object({
      displayName: z.string(),
      phoneE164: z.string().nullable(),
      vehicle: VehicleSummarySchema.nullable(),
    })
    .nullable(),
  payment: RidePaymentSchema.nullable(),
});
export type PassengerRideView = z.infer<typeof PassengerRideSchema>;

export const DriverOfferSchema = z.object({
  offerId: z.uuid(),
  rideId: z.uuid(),
  status: z.enum(OFFER_STATUSES),
  expiresAt: z.string(),
  dispatchRound: z.number().int(),
  distanceToPickupMeters: z.number().int(),
  offeredFare: MoneyResponseSchema,
  minimumFare: MoneyResponseSchema,
  counterFare: MoneyResponseSchema.nullable(),
  pickup: PlaceSchema,
  destination: PlaceSchema,
  route: RouteSchema,
  passenger: z.object({ displayName: z.string() }),
});
export type DriverOfferView = z.infer<typeof DriverOfferSchema>;

export const DriverRideSchema = z.object({
  id: z.uuid(),
  status: z.enum(RIDE_STATUSES),
  serviceTypeCode: z.string(),
  pickup: PlaceSchema,
  destination: PlaceSchema,
  route: RouteSchema,
  minimumFare: MoneyResponseSchema,
  agreedFare: MoneyResponseSchema.nullable(),
  ...Timeline,
  cancellation: CancellationSchema,
  passenger: z.object({ displayName: z.string(), phoneE164: z.string().nullable() }),
  payment: RidePaymentSchema.nullable(),
});
export type DriverRideView = z.infer<typeof DriverRideSchema>;

export const AdminRideSchema = PassengerRideSchema.extend({
  passengerId: z.uuid(),
  assignedDriverId: z.uuid().nullable(),
  dispatchRound: z.number().int(),
  offers: z.array(
    z.object({
      offerId: z.uuid(),
      driverId: z.uuid(),
      vehicleId: z.uuid(),
      dispatchRound: z.number().int(),
      status: z.enum(OFFER_STATUSES),
      distanceToPickupMeters: z.number().int(),
      offeredFare: MoneyResponseSchema,
      counterFare: MoneyResponseSchema.nullable(),
      createdAt: z.string(),
      closedAt: z.string().nullable(),
    }),
  ),
  agreement: z
    .object({
      id: z.uuid(),
      basis: z.enum([
        'driver_accepted_passenger_proposal',
        'passenger_accepted_driver_counteroffer',
      ]),
      agreedFare: MoneyResponseSchema,
      minimumFare: MoneyResponseSchema,
      passengerProposedFare: MoneyResponseSchema,
      driverCounterFare: MoneyResponseSchema.nullable(),
      farePolicy: z.object({ id: z.uuid(), version: z.number().int() }),
      routeDistanceMeters: z.number().int(),
      routeProvider: z.string(),
      agreedAt: z.string(),
    })
    .nullable(),
  assignment: z
    .object({
      id: z.uuid(),
      status: z.enum(['active', 'completed', 'cancelled']),
      commissionPolicy: z.object({ id: z.uuid(), version: z.number().int() }),
      commissionRateBasisPoints: z.number().int(),
    })
    .nullable(),
});
export type AdminRideView = z.infer<typeof AdminRideSchema>;

const money = (amountMinor: number, currency: string): Money => ({ amountMinor, currency });

function timeline(ride: Ride) {
  return {
    createdAt: ride.createdAt.toISOString(),
    searchExpiresAt: ride.searchExpiresAt.toISOString(),
    assignedAt: isoDate(ride.assignedAt),
    driverArrivedAt: isoDate(ride.driverArrivedAt),
    startedAt: isoDate(ride.startedAt),
    completedAt: isoDate(ride.completedAt),
    cancelledAt: isoDate(ride.cancelledAt),
    expiredAt: isoDate(ride.expiredAt),
  };
}

function cancellation(ride: Ride): z.infer<typeof CancellationSchema> {
  if (ride.status !== 'cancelled' || !ride.cancelledByRole || !ride.statusBeforeCancellation)
    return null;
  return {
    cancelledByRole: ride.cancelledByRole,
    reason: ride.cancellationReason,
    statusBeforeCancellation: ride.statusBeforeCancellation,
  };
}

const place = (point: { lat: number; lng: number }, label: string | null) => ({ ...point, label });
const route = (ride: Ride) => ({
  distanceMeters: ride.routeDistanceMeters,
  durationSeconds: ride.routeDurationSeconds,
  provider: ride.routeProvider,
});

@Injectable()
export class RideViews {
  constructor(
    private readonly offers: OffersRepository,
    private readonly assignments: AssignmentsRepository,
    private readonly identity: IdentityService,
    private readonly fleet: FleetService,
    private readonly finance: FinanceService,
  ) {}

  async passengerView(db: Queryable, ride: Ride): Promise<PassengerRideView> {
    const offers = await this.offers.listForRide(db, ride.id);
    const counteroffers = offers.filter((o) => o.counterFareMinor !== null);
    const driverIds = [
      ...new Set([
        ...counteroffers.map((o) => o.driverId),
        ...(ride.assignedDriverId ? [ride.assignedDriverId] : []),
      ]),
    ];
    const vehicleIds = [
      ...new Set([
        ...counteroffers.map((o) => o.vehicleId),
        ...(ride.assignedVehicleId ? [ride.assignedVehicleId] : []),
      ]),
    ];
    const [contacts, vehicles, payment] = await Promise.all([
      this.identity.contacts(db, driverIds),
      Promise.all(vehicleIds.map((id) => this.fleet.findVehicle(db, id))),
      this.finance.findPaymentForRide(db, ride.id),
    ]);
    const vehicleById = new Map(vehicles.filter((v) => v !== null).map((v) => [v.id, v]));

    const assignedContact = ride.assignedDriverId ? contacts.get(ride.assignedDriverId) : undefined;
    const assignedVehicle = ride.assignedVehicleId
      ? vehicleById.get(ride.assignedVehicleId)
      : undefined;
    const showPhone = CONTACT_VISIBLE_STATUSES.includes(ride.status);

    return {
      id: ride.id,
      status: ride.status,
      serviceTypeCode: ride.serviceTypeCode,
      pickup: place(ride.pickup, ride.pickupLabel),
      destination: place(ride.destination, ride.destinationLabel),
      route: route(ride),
      minimumFare: money(ride.minimumFareMinor, ride.currency),
      proposedFare: money(ride.proposedFareMinor, ride.currency),
      agreedFare: ride.agreedFareMinor === null ? null : money(ride.agreedFareMinor, ride.currency),
      farePolicy: { id: ride.farePolicyId, version: ride.farePolicyVersion },
      ...timeline(ride),
      cancellation: cancellation(ride),
      negotiation: {
        driversNotified: offers.length,
        counteroffers: counteroffers.map((o) => ({
          offerId: o.id,
          status: o.status,
          amount: money(o.counterFareMinor ?? 0, o.currency),
          expiresAt: o.expiresAt.toISOString(),
          driverDisplayName: contacts.get(o.driverId)?.displayName ?? 'Driver',
          vehicleTypeCode: vehicleById.get(o.vehicleId)?.vehicleTypeCode ?? 'unknown',
          distanceToPickupMeters: o.distanceToPickupMeters,
        })),
      },
      driver:
        ride.assignedDriverId && assignedContact
          ? {
              displayName: assignedContact.displayName,
              phoneE164: showPhone ? assignedContact.phoneE164 : null,
              vehicle: assignedVehicle
                ? {
                    vehicleTypeCode: assignedVehicle.vehicleTypeCode,
                    plateNumber: assignedVehicle.plateNumber,
                    description: assignedVehicle.description,
                  }
                : null,
            }
          : null,
      payment: payment ? presentPayment(payment) : null,
    };
  }

  async driverOfferView(db: Queryable, offer: RideOffer, ride: Ride): Promise<DriverOfferView> {
    const contacts = await this.identity.contacts(db, [ride.passengerId]);
    return {
      offerId: offer.id,
      rideId: ride.id,
      status: offer.status,
      expiresAt: offer.expiresAt.toISOString(),
      dispatchRound: offer.dispatchRound,
      distanceToPickupMeters: offer.distanceToPickupMeters,
      offeredFare: money(offer.offeredFareMinor, offer.currency),
      minimumFare: money(offer.minimumFareMinor, offer.currency),
      counterFare:
        offer.counterFareMinor === null ? null : money(offer.counterFareMinor, offer.currency),
      pickup: place(ride.pickup, ride.pickupLabel),
      destination: place(ride.destination, ride.destinationLabel),
      route: route(ride),
      passenger: { displayName: contacts.get(ride.passengerId)?.displayName ?? 'Passenger' },
    };
  }

  async driverRideView(db: Queryable, ride: Ride): Promise<DriverRideView> {
    const [contacts, payment] = await Promise.all([
      this.identity.contacts(db, [ride.passengerId]),
      this.finance.findPaymentForRide(db, ride.id),
    ]);
    const passenger = contacts.get(ride.passengerId);
    return {
      id: ride.id,
      status: ride.status,
      serviceTypeCode: ride.serviceTypeCode,
      pickup: place(ride.pickup, ride.pickupLabel),
      destination: place(ride.destination, ride.destinationLabel),
      route: route(ride),
      minimumFare: money(ride.minimumFareMinor, ride.currency),
      agreedFare: ride.agreedFareMinor === null ? null : money(ride.agreedFareMinor, ride.currency),
      ...timeline(ride),
      cancellation: cancellation(ride),
      passenger: {
        displayName: passenger?.displayName ?? 'Passenger',
        phoneE164: CONTACT_VISIBLE_STATUSES.includes(ride.status)
          ? (passenger?.phoneE164 ?? null)
          : null,
      },
      payment: payment ? presentPayment(payment) : null,
    };
  }

  async adminView(db: Queryable, ride: Ride): Promise<AdminRideView> {
    const [base, offers, agreement, assignment] = await Promise.all([
      this.passengerView(db, ride),
      this.offers.listForRide(db, ride.id),
      this.assignments.findAgreementForRide(db, ride.id),
      this.assignments.findAssignmentForRide(db, ride.id),
    ]);
    return {
      ...base,
      passengerId: ride.passengerId,
      assignedDriverId: ride.assignedDriverId,
      dispatchRound: ride.dispatchRound,
      offers: offers.map((o) => ({
        offerId: o.id,
        driverId: o.driverId,
        vehicleId: o.vehicleId,
        dispatchRound: o.dispatchRound,
        status: o.status,
        distanceToPickupMeters: o.distanceToPickupMeters,
        offeredFare: money(o.offeredFareMinor, o.currency),
        counterFare: o.counterFareMinor === null ? null : money(o.counterFareMinor, o.currency),
        createdAt: o.createdAt.toISOString(),
        closedAt: isoDate(o.closedAt),
      })),
      agreement: agreement
        ? {
            id: agreement.id,
            basis: agreement.basis,
            agreedFare: money(agreement.agreedFareMinor, agreement.currency),
            minimumFare: money(agreement.minimumFareMinor, agreement.currency),
            passengerProposedFare: money(agreement.passengerProposedFareMinor, agreement.currency),
            driverCounterFare:
              agreement.driverCounterFareMinor === null
                ? null
                : money(agreement.driverCounterFareMinor, agreement.currency),
            farePolicy: { id: agreement.farePolicyId, version: agreement.farePolicyVersion },
            routeDistanceMeters: agreement.routeDistanceMeters,
            routeProvider: agreement.routeProvider,
            agreedAt: agreement.agreedAt.toISOString(),
          }
        : null,
      assignment: assignment
        ? {
            id: assignment.id,
            status: assignment.status,
            commissionPolicy: {
              id: assignment.commissionPolicyId,
              version: assignment.commissionPolicyVersion,
            },
            commissionRateBasisPoints: assignment.commissionRateBasisPoints,
          }
        : null,
    };
  }
}
