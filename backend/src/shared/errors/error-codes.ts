/**
 * The stable, machine-readable error codes of the TAKE-TUK API (docs/api/API_CONVENTIONS.md §6).
 * Clients switch on `code`; titles are for humans and may change.
 */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'unprocessable'
  | 'payload_too_large'
  | 'rate_limited'
  | 'unavailable'
  | 'internal';

export const HTTP_STATUS_BY_KIND: Readonly<Record<ErrorKind, number>> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  unprocessable: 422,
  payload_too_large: 413,
  rate_limited: 429,
  unavailable: 503,
  internal: 500,
};

interface ErrorDefinition {
  readonly kind: ErrorKind;
  readonly title: string;
}

const define = <T extends Record<string, ErrorDefinition>>(definitions: T): T => definitions;

export const ERROR_CODES = define({
  VALIDATION_FAILED: { kind: 'validation', title: 'The request is invalid' },
  IDEMPOTENCY_KEY_REQUIRED: { kind: 'validation', title: 'An Idempotency-Key header is required' },

  AUTHENTICATION_REQUIRED: { kind: 'unauthenticated', title: 'Authentication is required' },
  INVALID_TOKEN: { kind: 'unauthenticated', title: 'The access token is invalid or expired' },

  REGISTRATION_REQUIRED: { kind: 'forbidden', title: 'Registration is required' },
  ACCOUNT_DISABLED: { kind: 'forbidden', title: 'The account is disabled' },
  PERMISSION_DENIED: { kind: 'forbidden', title: 'You do not have permission for this operation' },
  DRIVER_NOT_APPROVED: { kind: 'forbidden', title: 'The driver is not approved' },
  SELF_REVIEW_FORBIDDEN: {
    kind: 'forbidden',
    title: 'Reviewing your own submission is not allowed',
  },

  NOT_FOUND: { kind: 'not_found', title: 'The resource was not found' },
  RIDE_NOT_FOUND: { kind: 'not_found', title: 'Ride not found' },
  OFFER_NOT_FOUND: { kind: 'not_found', title: 'Offer not found' },
  QUOTE_NOT_FOUND: { kind: 'not_found', title: 'Quote not found' },
  DRIVER_NOT_FOUND: { kind: 'not_found', title: 'Driver not found' },
  VEHICLE_NOT_FOUND: { kind: 'not_found', title: 'Vehicle not found' },
  DOCUMENT_NOT_FOUND: { kind: 'not_found', title: 'Document not found' },
  POLICY_NOT_FOUND: { kind: 'not_found', title: 'Policy not found' },
  SERVICE_AREA_NOT_FOUND: { kind: 'not_found', title: 'Service area not found' },
  PAYMENT_NOT_FOUND: { kind: 'not_found', title: 'Payment record not found' },
  USER_NOT_FOUND: { kind: 'not_found', title: 'User not found' },

  INVALID_STATE_TRANSITION: {
    kind: 'conflict',
    title: 'The operation is not allowed in the current state',
  },
  ALREADY_REGISTERED: { kind: 'conflict', title: 'Already registered with different details' },
  PROFILE_NOT_EDITABLE: {
    kind: 'conflict',
    title: 'The profile cannot be edited in its current state',
  },
  QUOTE_EXPIRED: { kind: 'conflict', title: 'The quote has expired' },
  QUOTE_ALREADY_USED: { kind: 'conflict', title: 'The quote has already been used' },
  RIDE_ALREADY_OPEN: { kind: 'conflict', title: 'You already have an open ride' },
  RIDE_NO_LONGER_AVAILABLE: { kind: 'conflict', title: 'The ride is no longer available' },
  OFFER_NOT_OPEN: { kind: 'conflict', title: 'The offer is no longer open' },
  OFFER_EXPIRED: { kind: 'conflict', title: 'The offer has expired' },
  DRIVER_BUSY: { kind: 'conflict', title: 'The driver already has an active job' },
  DRIVER_NOT_AVAILABLE: { kind: 'conflict', title: 'The driver is no longer available' },
  PAYMENT_ALREADY_REPORTED: {
    kind: 'conflict',
    title: 'The payment has already been reported differently',
  },
  DOCUMENT_NOT_UPLOADED: {
    kind: 'conflict',
    title: 'The document has not been uploaded to storage',
  },
  CONCURRENT_UPDATE: { kind: 'conflict', title: 'The resource was modified concurrently; retry' },

  FARE_BELOW_MINIMUM: { kind: 'unprocessable', title: 'The fare is below the minimum fare' },
  COUNTEROFFER_NOT_ABOVE_PROPOSAL: {
    kind: 'unprocessable',
    title: "The counteroffer must be higher than the passenger's proposal",
  },
  CURRENCY_MISMATCH: {
    kind: 'unprocessable',
    title: 'The currency does not match the applicable policy',
  },
  OUTSIDE_SERVICE_AREA: {
    kind: 'unprocessable',
    title: 'The location is outside the service area',
  },
  SERVICE_NOT_AVAILABLE: {
    kind: 'unprocessable',
    title: 'The service is not available in this area',
  },
  PICKUP_EQUALS_DESTINATION: { kind: 'unprocessable', title: 'Pickup and destination must differ' },
  NO_ROUTE_FOUND: { kind: 'unprocessable', title: 'No route was found between the locations' },
  IDEMPOTENCY_KEY_REUSED: {
    kind: 'unprocessable',
    title: 'The Idempotency-Key was already used with a different request',
  },
  VERIFICATION_REQUIREMENTS_NOT_MET: {
    kind: 'unprocessable',
    title: 'Verification requirements are not met',
  },
  VEHICLE_NOT_ELIGIBLE: { kind: 'unprocessable', title: 'The vehicle is not eligible' },

  PAYLOAD_TOO_LARGE: { kind: 'payload_too_large', title: 'The request body is too large' },

  RATE_LIMITED: { kind: 'rate_limited', title: 'Too many requests' },

  AUTHENTICATION_UNAVAILABLE: {
    kind: 'unavailable',
    title: 'Token verification is temporarily unavailable',
  },
  ROUTING_UNAVAILABLE: {
    kind: 'unavailable',
    title: 'Route estimation is temporarily unavailable',
  },
  STORAGE_UNAVAILABLE: { kind: 'unavailable', title: 'File storage is temporarily unavailable' },
  PRICING_NOT_CONFIGURED: {
    kind: 'unavailable',
    title: 'Pricing is not configured for this service',
  },
  DATABASE_UNAVAILABLE: { kind: 'unavailable', title: 'The database is temporarily unavailable' },

  INTERNAL_ERROR: { kind: 'internal', title: 'An unexpected error occurred' },
});

export type ErrorCode = keyof typeof ERROR_CODES;
