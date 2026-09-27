import { useEffect, useRef, useState, type FormEvent } from 'react';
import { TRANSPORT_LOCATIONS, type TransportLocation, type UniversityCar } from '../../../../shared/transport';
import { DepartureField, departureInstant, type Departure } from './DepartureField';
import { loadCars } from './api';
import { nextDeparture, osloTime } from './time';

export function LocationSelect({ label, value, onChange, exclude }: { label: string; value: string; onChange: (value: TransportLocation) => void; exclude?: string }) {
  return <label>{label}<select value={value} required onChange={event => onChange(event.target.value as TransportLocation)}>
    <option value="" disabled>Choose location</option>
    {Object.entries(TRANSPORT_LOCATIONS).map(([key, name]) => <option key={key} value={key} disabled={key === exclude}>{name}</option>)}
  </select></label>;
}
export type TransportAction = (path: string, body: Record<string, unknown>, success: string) => Promise<boolean>;
export function CarBookingForm({ vehicles, initialCar, busy, act, close }: { vehicles: UniversityCar[]; initialCar: string; busy: boolean; act: TransportAction; close: () => void }) {
  const [vehicleId, setVehicleId] = useState(initialCar);
  const [departure, setDeparture] = useState<Departure>(nextDeparture);
  const [origin, setOrigin] = useState<TransportLocation | ''>('');
  const [destination, setDestination] = useState<TransportLocation | ''>('');
  const [expected, setExpected] = useState<TransportLocation | null>(null);
  const [forecastError, setForecastError] = useState('');
  const manualOrigin = useRef(false), startsAt = departureInstant(departure);
  useEffect(() => {
    manualOrigin.current = false;
    setOrigin(''); setExpected(null); setForecastError('');
    if (!startsAt) return;
    const controller = new AbortController();
    void loadCars(controller.signal, startsAt).then(data => {
      if (controller.signal.aborted) return;
      const forecast = data.vehicles.find(car => car.id === vehicleId)?.expected.location ?? null;
      setExpected(forecast);
      if (!manualOrigin.current) setOrigin(forecast ?? '');
    }).catch(error => { if (!controller.signal.aborted) setForecastError(error instanceof Error ? error.message : 'Expected location is unavailable.'); });
    return () => controller.abort();
  }, [vehicleId, startsAt]);
  useEffect(() => { if (origin === destination) setDestination(''); }, [origin, destination]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!startsAt || !origin || !destination || busy) return;
    if (await act('bookings', { vehicleId, origin, destination, startsAt }, 'Car booked.')) close();
  }
  return <form className="transport-form" onSubmit={event => void submit(event)}>
    <h3>Book a university car</h3>
    <div className="transport-fields">
      <label>Car<select value={vehicleId} onChange={event => setVehicleId(event.target.value)}>{vehicles.map(car => <option key={car.id} value={car.id}>{car.name}</option>)}</select></label>
      <DepartureField value={departure} onChange={setDeparture} />
      <LocationSelect label="Origin" value={origin} onChange={value => { manualOrigin.current = true; setOrigin(value); }} />
      <LocationSelect label="Destination" value={destination} onChange={setDestination} exclude={origin} />
    </div>
    <p className="transport-muted">Trip duration: 10 minutes{startsAt ? ` · Arrival ${osloTime(new Date(Date.parse(startsAt) + 600000).toISOString())}` : ''}</p>
    {expected && origin && origin !== expected && <p className="transport-muted">{vehicles.find(car => car.id === vehicleId)?.name} is expected at {TRANSPORT_LOCATIONS[expected]} at departure. You can still book this trip.</p>}
    {!expected && !forecastError && startsAt && <p className="transport-muted">Expected origin is unknown. Choose where your trip will start.</p>}
    {forecastError && <p className="transport-muted">{forecastError} You can choose the origin yourself.</p>}
    <div className="transport-actions"><button type="submit" disabled={busy || !startsAt || !origin || !destination}>Book car</button><button type="button" onClick={close} disabled={busy}>Close</button></div>
  </form>;
}
