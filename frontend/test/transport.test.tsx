// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransportPage } from '../src/pages/TransportPage';
import { isCarsResponse, isRidesResponse, loadCars, loadRides } from '../src/features/transport/api';
import { osloInput, osloInstants, osloTime } from '../src/features/transport/time';
import type { CarBooking, CarsResponse, PrivateRide, RidesResponse } from '../../shared/transport';
import type { PermissionKey } from '../../shared/authorization';

let permissions: PermissionKey[];
vi.mock('../src/app/CurrentUser', () => ({ useCurrentUser: () => ({ user: { permissions } }) }));
const NOW = '2026-09-27T08:00:00.000Z', START = '2026-09-27T09:00:00.000Z';
const trip: CarBooking = { id: 'trip', vehicleId: 'university-car-1', origin: 'ISTIND', destination: 'UTSA', startsAt: START, endsAt: '2026-09-27T09:10:00.000Z', status: 'BOOKED', confirmedAt: null, isMine: true };
const ride: PrivateRide = { id: 'ride', origin: 'Istind', destination: 'Airport', departureAt: START, seatCount: 2, remainingSeats: 1, note: 'Meet outside', status: 'OPEN', isDriver: false, isJoined: false };
let cars: CarsResponse, rides: RidesResponse, api: ReturnType<typeof vi.fn>, host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  permissions = ['transport.view', 'transport.book_university_cars'];
  cars = { now: NOW, timeZone: 'Europe/Oslo', vehicles: [1, 2].map(number => ({ id: `university-car-${number}`, name: `Car ${number}`, reported: null, expected: { at: NOW, location: null, inUse: null }, nextBooking: null })), bookings: [], pendingConfirmations: [] };
  rides = { now: NOW, timeZone: 'Europe/Oslo', rides: [] };
  api = vi.fn(async (path: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ ok: true });
    return Response.json(path.includes('/vehicles') ? cars : rides);
  }); vi.stubGlobal('fetch', api);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });
const render = async () => { await act(async () => root.render(<TransportPage />)); };
const button = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === name)!;
const click = async (name: string) => { await act(async () => button(name).click()); };
const field = (name: string): HTMLInputElement | HTMLSelectElement => {
  const label = [...host.querySelectorAll<HTMLLabelElement>('label')].find(element => element.childNodes[0]?.textContent === name)!;
  return label.control as HTMLInputElement | HTMLSelectElement;
};
async function change(name: string, value: string) {
  await act(async () => {
    const element = field(name);
    Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, 'value')!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  });
}
async function submit() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
const writes = () => api.mock.calls.filter(([, init]) => init?.method === 'POST');

describe('Oslo transport times', () => {
  it('converts Oslo wall clocks to UTC independently of the browser timezone', () => {
    expect(osloInstants('2026-09-27T11:00')).toEqual([START]);
    expect(osloInstants('2026-01-27T11:00')).toEqual(['2026-01-27T10:00:00.000Z']);
    expect(osloInput(START)).toBe('2026-09-27T11:00');
    expect(osloTime(START)).toContain('11:00');
    expect(osloInstants('2026-02-30T11:00')).toEqual([]);
  });
  it('rejects the spring gap and exposes both occurrences of the autumn repeated hour', () => {
    expect(osloInstants('2026-03-29T02:30')).toEqual([]);
    expect(osloInstants('2026-10-25T02:30')).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z']);
  });
});
describe('Transport response contracts', () => {
  it('requests same-origin no-store data and rejects unsafe shapes', async () => {
    const signal = new AbortController().signal;
    expect(await loadCars(signal)).toEqual(cars); expect(await loadRides(signal)).toEqual(rides);
    expect(api).toHaveBeenCalledWith('/api/transport/vehicles', expect.objectContaining({ signal, credentials: 'same-origin', cache: 'no-store' }));
    expect(isCarsResponse({ ...cars, vehicles: [{ ...cars.vehicles[0], reported: { location: 'Airport' } }] })).toBe(false);
    expect(isCarsResponse({ ...cars, bookings: [{ ...trip, endsAt: START }] })).toBe(false);
    expect(isRidesResponse({ ...rides, rides: [{ ...ride, remainingSeats: -1 }] })).toBe(false);
    expect(isRidesResponse({ ...rides, rides: [{ ...ride, remainingSeats: 3 }] })).toBe(false);
  });
  it('shows session, network and rejected mutation errors with a retry path', async () => {
    api.mockResolvedValue(Response.json({ error: 'Access authentication required' }, { status: 401 }));
    await render(); expect(host.querySelector('[role=alert]')?.textContent).toContain('session may have expired');
    api.mockRejectedValue(new TypeError('offline')); await click('Reload');
    expect(host.querySelector('[role=alert]')?.textContent).toContain('Check your connection');
  });
});
describe('university car flows', () => {
  it('shows both cars with unknown initial locations and preserves view-only location reporting', async () => {
    permissions = ['transport.view']; await render();
    expect(host.querySelectorAll('.transport-car')).toHaveLength(2);
    expect(host.textContent).toContain('Not reported yet'); expect(host.textContent).toContain('Unknown');
    expect(button('Book Car 1')).toBeUndefined(); expect(button('Offer a ride')).toBeUndefined();
    await click('Change location'); await change('Car 1 reported location', 'NAERINGSHAGEN'); await submit();
    expect(writes()[0][0]).toBe('/api/transport/vehicles/university-car-1/location');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ location: 'NAERINGSHAGEN' });
    expect(host.textContent).toContain('Car 1 location updated.');
  });
  it('defaults origin from the projected location, lets the user change it, and submits a mismatch without extra confirmation', async () => {
    cars.vehicles[0].expected.location = 'ISTIND'; await render(); await click('Book Car 1');
    expect(field('Origin').value).toBe('ISTIND');
    await change('Origin', 'NAERINGSHAGEN'); await change('Destination', 'UTSA');
    expect(host.textContent).toContain('is expected at Istind at departure');
    expect(host.querySelector('input[type=checkbox]')).toBeNull();
    await submit(); const [path, init] = writes()[0];
    expect(path).toBe('/api/transport/bookings');
    expect(JSON.parse(init.body)).toMatchObject({ vehicleId: 'university-car-1', origin: 'NAERINGSHAGEN', destination: 'UTSA' });
    expect(Object.keys(JSON.parse(init.body))).toEqual(['vehicleId', 'origin', 'destination', 'startsAt']);
    expect(host.textContent).toContain('Car booked.');
  });
  it('asks for an origin when unknown, enforces a different destination and refreshes the forecast when departure changes', async () => {
    await render(); await click('Book Car 1'); expect(field('Origin').value).toBe('');
    expect(button('Book car').disabled).toBe(true);
    await change('Origin', 'UTSA'); expect(field('Destination').querySelector<HTMLOptionElement>('option[value=UTSA]')!.disabled).toBe(true);
    await change('Departure (Europe/Oslo)', '2026-09-27T11:00');
    expect(api.mock.calls.some(([path]) => path === `/api/transport/vehicles?at=${encodeURIComponent(START)}`)).toBe(true);
  });
  it('shows a booking conflict inline and prevents duplicate submissions while waiting', async () => {
    await render(); await click('Book Car 1'); await change('Origin', 'ISTIND'); await change('Destination', 'UTSA');
    let resolve!: (response: Response) => void;
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, init: RequestInit) => init.method === 'POST' ? new Promise<Response>(done => { resolve = done; }) : original(path, init));
    await submit(); await submit(); expect(writes()).toHaveLength(1); expect(button('Book car').disabled).toBe(true);
    await act(async () => resolve(Response.json({ error: 'Another booking overlaps this time.' }, { status: 409 })));
    expect(host.querySelector('[role=alert]')?.textContent).toContain('overlaps'); expect(button('Book car').disabled).toBe(false);
  });
  it('offers the repeated-hour choice and disables nonexistent Oslo times', async () => {
    await render(); await click('Book Car 1');
    await change('Departure (Europe/Oslo)', '2026-03-29T02:30');
    expect(host.textContent).toContain('does not exist in Oslo'); expect(button('Book car').disabled).toBe(true);
    await change('Departure (Europe/Oslo)', '2026-10-25T02:30'); expect(field('Repeated hour').querySelectorAll('option')).toHaveLength(2);
    await change('Repeated hour', '1'); await change('Origin', 'ISTIND'); await change('Destination', 'UTSA'); await submit();
    expect(JSON.parse(writes()[0][1].body).startsAt).toBe('2026-10-25T01:30:00.000Z');
  });
  it('shows pending trips without hiding booking controls and supports both confirmation paths', async () => {
    cars.pendingConfirmations = [{ ...trip, startsAt: '2026-09-27T07:00:00.000Z', endsAt: '2026-09-27T07:10:00.000Z' }];
    await render(); expect(button('Book Car 1')).toBeDefined(); await click('Yes, at UTSA');
    expect(JSON.parse(writes()[0][1].body)).toEqual({ asPlanned: true });
    await click('Another location'); await change('Car 1 actual location', 'ISTIND'); await submit();
    expect(JSON.parse(writes()[1][1].body)).toEqual({ asPlanned: false, location: 'ISTIND' });
  });
  it('shows active trip context, reported time, schedule and cancellation only on own bookings', async () => {
    cars.vehicles[0].reported = { location: 'ISTIND', reportedAt: NOW };
    cars.vehicles[0].expected.inUse = { bookingId: 'active', origin: 'ISTIND', destination: 'UTSA', endsAt: START };
    cars.bookings = [trip, { ...trip, id: 'someone-else', vehicleId: 'university-car-2', isMine: false }];
    await render(); expect(host.textContent).toContain('In use'); expect(host.textContent).toContain('Expected arrival');
    expect([...host.querySelectorAll('button')].filter(element => element.textContent === 'Cancel booking')).toHaveLength(1);
    await click('Cancel booking'); expect(writes()[0][0]).toBe('/api/transport/bookings/trip/cancel');
  });
});
describe('private ride flows', () => {
  it('lets a viewer join and leave without offering permission and shows remaining passenger seats', async () => {
    permissions = ['transport.view']; rides.rides = [ride]; await render();
    expect(host.textContent).toContain('1 of 2 passenger seats available'); await click('Join ride');
    expect(writes()[0][0]).toBe('/api/transport/rides/ride/join');
    rides.rides[0] = { ...ride, isJoined: true }; await click('Reload'); await click('Leave ride');
    expect(writes()[1][0]).toBe('/api/transport/rides/ride/leave');
  });
  it('allows offering only with opt-in permission and sends passenger seats, note and UTC departure', async () => {
    permissions.push('transport.offer_private_ride'); await render(); await click('Offer a ride');
    await change('Origin', 'Istind'); await change('Destination', 'Airport'); await change('Passenger seats', '3');
    await change('Departure (Europe/Oslo)', '2026-09-27T11:00'); await change('Note (optional)', 'Meet outside'); await submit();
    expect(writes()[0][0]).toBe('/api/transport/rides'); expect(JSON.parse(writes()[0][1].body)).toEqual({ origin: 'Istind', destination: 'Airport', departureAt: START, seatCount: 3, note: 'Meet outside' });
  });
  it('disables full rides, omits cancelled join actions, and keeps driver cancellation separate', async () => {
    permissions.push('transport.offer_private_ride');
    rides.rides = [{ ...ride, remainingSeats: 0 }, { ...ride, id: 'cancelled', status: 'CANCELLED', isJoined: true }, { ...ride, id: 'own', isDriver: true }]; await render();
    expect(button('Ride full').disabled).toBe(true); expect(button('Join ride')).toBeUndefined();
    expect(button('Leave ride')).toBeDefined(); await click('Cancel ride'); expect(writes()[0][0]).toBe('/api/transport/rides/own/cancel');
  });
});
