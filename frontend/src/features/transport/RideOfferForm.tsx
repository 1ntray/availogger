import { useState, type FormEvent } from 'react';
import { DepartureField, departureInstant, type Departure } from './DepartureField';
import { nextDeparture } from './time';
import type { TransportAction } from './CarBookingForm';

export function RideOfferForm({ busy, act, close }: { busy: boolean; act: TransportAction; close: () => void }) {
  const [origin, setOrigin] = useState(''), [destination, setDestination] = useState('');
  const [departure, setDeparture] = useState<Departure>(nextDeparture);
  const [seats, setSeats] = useState(1), [note, setNote] = useState('');
  const departureAt = departureInstant(departure);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!departureAt || busy) return;
    if (await act('rides', { origin, destination, departureAt, seatCount: seats, note: note || null }, 'Private ride offered.')) close();
  }
  return <form className="transport-form" onSubmit={event => void submit(event)}><h3>Offer a private ride</h3>
    <div className="transport-fields">
      <label>Origin<input required maxLength={80} value={origin} onChange={event => setOrigin(event.target.value)} /></label>
      <label>Destination<input required maxLength={80} value={destination} onChange={event => setDestination(event.target.value)} /></label>
      <DepartureField value={departure} onChange={setDeparture} />
      <label>Passenger seats<input required type="number" min={1} max={8} step={1} value={seats} onChange={event => setSeats(Number(event.target.value))} /></label>
    </div>
    <label>Note (optional)<input maxLength={280} value={note} onChange={event => setNote(event.target.value)} /></label>
    <div className="transport-actions"><button type="submit" disabled={busy || !departureAt}>Offer ride</button><button type="button" disabled={busy} onClick={close}>Close</button></div>
  </form>;
}
