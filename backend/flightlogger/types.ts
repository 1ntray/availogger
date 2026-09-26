export interface Instructor {
  id: string;
  firstName: string;
  lastName: string;
  callSign: string;
}

export interface AvailabilityPeriod {
  startsAt: string;
  endsAt: string;
  unavailable: boolean;
}

export type AvailabilityStatus = 'available' | 'unavailable' | 'undefined';

export interface AvailabilityRow extends Instructor {
  days: AvailabilityStatus[];
}

export interface AvailabilityResult {
  from: string;
  to: string;
  timeZone: 'Europe/Oslo';
  instructors: AvailabilityRow[];
}
