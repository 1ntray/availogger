import { useCallback, useEffect, useRef, useState } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { PERMISSIONS } from '../../../shared/authorization';
import { TRANSPORT_LOCATIONS, type CarBooking, type CarsResponse, type RidesResponse, type TransportLocation, type UniversityCar } from '../../../shared/transport';
import { loadCars, loadRides, transportRequest } from '../features/transport/api';
import { CarBookingForm, LocationSelect, type TransportAction } from '../features/transport/CarBookingForm';
import { RideOfferForm } from '../features/transport/RideOfferForm';
import { osloTime } from '../features/transport/time';
import { cacheAgeLabel } from '../cache-age';
import '../features/transport/transport.css';

function CarLocation({ car, busy, act }: { car: UniversityCar; busy: boolean; act: TransportAction }) {
  const [editing, setEditing] = useState(false), [chosen, setChosen] = useState<TransportLocation | ''>('');
  return <>{!editing ? <button type="button" disabled={busy} onClick={() => { setChosen(car.reported?.location ?? ''); setEditing(true); }}>Change location</button> :
    <form className="transport-location-form" onSubmit={event => { event.preventDefault(); if (chosen) void act(`vehicles/${car.id}/location`, { location: chosen }, `${car.name} location updated.`).then(done => { if (done) setEditing(false); }); }}>
      <LocationSelect label={`${car.name} reported location`} value={chosen} onChange={setChosen} />
      <div className="transport-actions"><button disabled={busy || !chosen}>Save location</button><button type="button" disabled={busy} onClick={() => setEditing(false)}>Close</button></div>
    </form>}</>;
}
function TripConfirmation({ booking, name, busy, act }: { booking: CarBooking; name: string; busy: boolean; act: TransportAction }) {
  const [correcting, setCorrecting] = useState(false), [chosen, setChosen] = useState<TransportLocation | ''>('');
  return <li className="transport-row"><div><strong>{name} · {osloTime(booking.startsAt)}</strong><p>Is the car at {TRANSPORT_LOCATIONS[booking.destination]} after your trip?</p></div>
    {!correcting ? <div className="transport-actions"><button disabled={busy} onClick={() => void act(`bookings/${booking.id}/confirm`, { asPlanned: true }, 'Trip confirmed and location reported.')}>Yes, at {TRANSPORT_LOCATIONS[booking.destination]}</button>
      <button disabled={busy} onClick={() => setCorrecting(true)}>Another location</button></div> :
      <form className="transport-location-form" onSubmit={event => { event.preventDefault(); if (chosen) void act(`bookings/${booking.id}/confirm`, { asPlanned: false, location: chosen }, 'Trip confirmed and location corrected.'); }}>
        <LocationSelect label={`${name} actual location`} value={chosen} onChange={setChosen} />
        <div className="transport-actions"><button disabled={busy || !chosen}>Confirm location</button><button type="button" disabled={busy} onClick={() => setCorrecting(false)}>Back</button></div>
      </form>}
  </li>;
}
export function TransportPage() {
  const { user } = useCurrentUser();
  const canBook = user?.permissions.includes(PERMISSIONS.transportBookUniversityCars) ?? false;
  const canOffer = user?.permissions.includes(PERMISSIONS.transportOfferPrivateRide) ?? false;
  const [cars, setCars] = useState<CarsResponse | null>(null), [rides, setRides] = useState<RidesResponse | null>(null);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [bookingCar, setBookingCar] = useState(''), [offering, setOffering] = useState(false);
  const request = useRef<AbortController | null>(null), acting = useRef(false), mounted = useRef(true);
  const reload = useCallback(async () => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller;
    setLoading(true);
    try {
      const [carData, rideData] = await Promise.all([loadCars(controller.signal), loadRides(controller.signal)]);
      if (!controller.signal.aborted) { setCars(carData); setRides(rideData); setError(''); }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load Transport.');
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    mounted.current = true; void reload();
    const interval = window.setInterval(() => { if (!acting.current && !document.hidden) void reload(); }, 60000);
    return () => { mounted.current = false; request.current?.abort(); window.clearInterval(interval); };
  }, [reload]);
  const act: TransportAction = async (path, body, success) => {
    if (acting.current) return false;
    acting.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await transportRequest(path, body);
      if (mounted.current) { setMessage(success); await reload(); }
      return true;
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Transport could not save this change.'); return false; }
    finally { acting.current = false; if (mounted.current) setBusy(false); }
  };
  const carName = (id: string) => cars?.vehicles.find(car => car.id === id)?.name ?? 'Car';
  return <section className="transport" aria-busy={busy}><div className="transport-heading"><h1>Transport</h1><button type="button" disabled={loading || busy} onClick={() => { setMessage(''); void reload(); }}>Reload</button></div>
    <p className="transport-muted transport-timezone">Times shown in Europe/Oslo.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    {loading && !cars && <p role="status">Loading Transport…</p>}
    {cars && <>
      {!!cars.pendingConfirmations.length && <section className="transport-section" aria-label="Trips awaiting confirmation"><h2>Confirm your trips</h2><ul className="transport-list">
        {cars.pendingConfirmations.map(booking => <TripConfirmation key={booking.id} booking={booking} name={carName(booking.vehicleId)} busy={busy} act={act} />)}
      </ul></section>}
      <section className="transport-section" aria-labelledby="university-cars"><h2 id="university-cars">University cars</h2><div className="transport-cars">
        {cars.vehicles.map(car => <article key={car.id} className="transport-car"><h3>{car.name}</h3>
          <dl><div><dt>Reported</dt><dd>{car.reported ? <>{TRANSPORT_LOCATIONS[car.reported.location]}<small><time dateTime={car.reported.reportedAt} title={osloTime(car.reported.reportedAt)}>{cacheAgeLabel(car.reported.reportedAt, Date.parse(cars.now))}</time></small></> : 'Not reported yet'}</dd></div>
            <div><dt>Expected now</dt><dd>{car.expected.inUse ? <>In use · {TRANSPORT_LOCATIONS[car.expected.inUse.origin]} → {TRANSPORT_LOCATIONS[car.expected.inUse.destination]}<small>Expected arrival {osloTime(car.expected.inUse.endsAt)}</small></> : car.expected.location ? TRANSPORT_LOCATIONS[car.expected.location] : 'Unknown'}</dd></div>
            <div><dt>Next trip</dt><dd>{car.nextBooking ? <>{osloTime(car.nextBooking.startsAt)}<small>{TRANSPORT_LOCATIONS[car.nextBooking.origin]} → {TRANSPORT_LOCATIONS[car.nextBooking.destination]}</small></> : 'No upcoming booking'}</dd></div></dl>
          <div className="transport-actions">{canBook && <button type="button" disabled={busy} onClick={() => setBookingCar(car.id)}>Book {car.name}</button>}<CarLocation car={car} busy={busy} act={act} /></div>
        </article>)}
      </div>{bookingCar && canBook && <CarBookingForm key={bookingCar} vehicles={cars.vehicles} initialCar={bookingCar} busy={busy} act={act} close={() => setBookingCar('')} />}
      <h3 className="transport-subheading">Upcoming bookings</h3>
      {!cars.bookings.length ? <p className="transport-muted">No upcoming car bookings.</p> : <ul className="transport-list">{cars.bookings.map(booking => <li key={booking.id} className="transport-row"><div><strong>{carName(booking.vehicleId)} · {osloTime(booking.startsAt)}–{osloTime(booking.endsAt).split(', ').pop()}</strong>
        <p>{TRANSPORT_LOCATIONS[booking.origin]} → {TRANSPORT_LOCATIONS[booking.destination]}{booking.isMine ? ' · Your booking' : ''}</p></div>
        {booking.isMine && canBook && <button disabled={busy} onClick={() => void act(`bookings/${booking.id}/cancel`, {}, 'Booking cancelled.')}>Cancel booking</button>}</li>)}</ul>}
      </section>
    </>}
    {rides && <section className="transport-section" aria-labelledby="private-rides"><div className="transport-heading"><h2 id="private-rides">Private rides</h2>{canOffer && <button disabled={busy} onClick={() => setOffering(true)}>Offer a ride</button>}</div>
      {offering && canOffer && <RideOfferForm busy={busy} act={act} close={() => setOffering(false)} />}
      {!rides.rides.length ? <p className="transport-muted">No upcoming private rides.</p> : <ul className="transport-list">{rides.rides.map(ride => <li key={ride.id} className="transport-row"><div><strong>{ride.origin} → {ride.destination}</strong>
        <p>{osloTime(ride.departureAt)} · {ride.status === 'CANCELLED' ? 'Cancelled' : `${ride.remainingSeats} of ${ride.seatCount} passenger seats available`}{ride.isDriver ? ' · Your ride' : ride.isJoined ? ' · You have joined' : ''}</p>{ride.note && <p className="transport-muted">{ride.note}</p>}</div>
        <div className="transport-actions">{ride.status === 'OPEN' && !ride.isDriver && !ride.isJoined && <button disabled={busy || !ride.remainingSeats} onClick={() => void act(`rides/${ride.id}/join`, {}, 'You joined the ride.')}>{ride.remainingSeats ? 'Join ride' : 'Ride full'}</button>}
          {ride.isJoined && <button disabled={busy} onClick={() => void act(`rides/${ride.id}/leave`, {}, 'You left the ride.')}>Leave ride</button>}
          {ride.isDriver && canOffer && ride.status === 'OPEN' && <button disabled={busy} onClick={() => void act(`rides/${ride.id}/cancel`, {}, 'Ride cancelled.')}>Cancel ride</button>}</div></li>)}</ul>}
    </section>}
  </section>;
}
