export const TRANSPORT_LOCATIONS = { ISTIND: 'Istind', UTSA: 'UTSA', NAERINGSHAGEN: 'Næringshagen' } as const;
export type TransportLocation = keyof typeof TRANSPORT_LOCATIONS;
export const CAR_TRIP_MINUTES = 10;
export const MAX_PASSENGER_SEATS = 8;
export function isTransportLocation(value: unknown): value is TransportLocation {
  return typeof value === 'string' && Object.hasOwn(TRANSPORT_LOCATIONS, value);
}
export interface CarBooking {
  id: string; vehicleId: string; origin: TransportLocation; destination: TransportLocation;
  startsAt: string; endsAt: string; status: 'BOOKED' | 'CANCELLED'; confirmedAt: string | null; isMine: boolean;
}
export interface ExpectedCarLocation {
  at: string; location: TransportLocation | null;
  inUse: { bookingId: string; origin: TransportLocation; destination: TransportLocation; endsAt: string } | null;
}
export interface UniversityCar {
  id: string; name: string;
  reported: { location: TransportLocation; reportedAt: string } | null;
  expected: ExpectedCarLocation;
  nextBooking: CarBooking | null;
}
export interface CarsResponse {
  now: string; timeZone: 'Europe/Oslo'; vehicles: UniversityCar[];
  bookings: CarBooking[]; pendingConfirmations: CarBooking[];
}
export interface PrivateRide {
  id: string; origin: string; destination: string; departureAt: string; seatCount: number; remainingSeats: number;
  note: string | null; status: 'OPEN' | 'CANCELLED'; isDriver: boolean; isJoined: boolean;
}
export interface RidesResponse { now: string; timeZone: 'Europe/Oslo'; rides: PrivateRide[] }
