import { useId } from 'react';
import { osloInstants, osloOffset } from './time';

export type Departure = { wall: string; occurrence: number };
export function departureInstant(value: Departure): string { return osloInstants(value.wall)[value.occurrence] ?? ''; }
export function DepartureField({ value, onChange }: { value: Departure; onChange: (value: Departure) => void }) {
  const id = useId(), instants = osloInstants(value.wall), invalid = !!value.wall && !instants.length;
  return <div className="transport-departure">
    <label htmlFor={id}>Departure (Europe/Oslo)</label>
    <input id={id} type="datetime-local" required value={value.wall} onChange={event => onChange({ wall: event.target.value, occurrence: 0 })}
      aria-invalid={invalid} aria-describedby={invalid ? `${id}-error` : undefined} />
    {invalid && <p id={`${id}-error`} role="alert">This time does not exist in Oslo. Choose another time.</p>}
    {instants.length > 1 && <label>Repeated hour
      <select value={value.occurrence} onChange={event => onChange({ ...value, occurrence: Number(event.target.value) })}>
        {instants.map((instant, index) => <option key={instant} value={index}>{index === 0 ? 'First' : 'Second'} occurrence ({osloOffset(instant)})</option>)}
      </select>
    </label>}
  </div>;
}
