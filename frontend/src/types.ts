export type AvailabilityStatus = 'available' | 'unavailable' | 'undefined';

export interface InstructorAvailability {
  id: string;
  firstName: string;
  lastName: string;
  callSign: string;
  days: AvailabilityStatus[];
}

export interface AvailabilityResponse {
  from: string;
  to: string;
  timeZone: 'Europe/Oslo';
  instructors: InstructorAvailability[];
}
