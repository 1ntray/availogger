// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { MemoryRouter,Route,Routes } from 'react-router';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { FlightsPage } from '../src/pages/FlightsPage';
import { DutyShiftPage } from '../src/pages/DutyShiftPage';
import { loadFlights } from '../src/features/flights/api';
import { PERMISSIONS,type PermissionKey } from '../../shared/authorization';

let permissions:PermissionKey[]=[],host:HTMLDivElement,root:Root,api:ReturnType<typeof vi.fn>;
const refresh=vi.fn();
vi.mock('../src/app/CurrentUser',()=>({useCurrentUser:()=>({user:{permissions},refresh})}));
const future=new Date(Date.now()+2*3600_000).toISOString(),end=new Date(Date.now()+3*3600_000).toISOString();
const flight={id:'flight-1',bookingType:'SingleStudentBooking',startsAt:future,endsAt:end,flightStartsAt:future,flightEndsAt:end,status:'OPEN',
  aircraft:{id:'aircraft-1',callSign:'LN-UPT',model:'Z242L',aircraftClass:'AIRPLANE'},departureAirport:{id:'2953',name:'Bardufoss'},
  arrivalAirport:{id:'1',name:'Tromsø'},instructor:null,canOrder:true,profile:{id:'Z242L',name:'Zlin',presets:[{key:'FULL_MAINS',label:'Full mains'}]},request:null};
const flights={from:'2026-09-20',to:'2026-11-20',timeZone:'Europe/Oslo',sync:{lastSyncedAt:new Date().toISOString(),stale:false,warning:null},flights:[flight]};
const tasks={shift:{id:'shift-1',startsAt:new Date(Date.now()-3600_000).toISOString(),endsAt:end},tasks:[{id:'request-1',flightId:'flight-1',
  flightStartsAt:future,attentionFrom:new Date(Date.now()+3600_000).toISOString(),aircraft:flight.aircraft,pilot:'Pilot Test',requested:'Full mains',status:'PENDING',
  earlierFlight:{endsAt:new Date(Date.now()+1800_000).toISOString(),timeSource:'booking',pilot:null}}]};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);permissions=[PERMISSIONS.flightsView,PERMISSIONS.fuelRequest];
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api=vi.fn(async(path:string,init:RequestInit)=>path==='/api/flights'?Response.json(flights)
    :path.endsWith('/complete')?Response.json({status:'COMPLETED',completedAt:new Date().toISOString(),completedBy:'Duty Ops student'})
    :path.includes('/tasks')?Response.json(tasks):Response.json({id:'request-1',status:'PENDING'}));vi.stubGlobal('fetch',api);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function renderFlights(){await act(async()=>root.render(<MemoryRouter><FlightsPage /></MemoryRouter>));}
describe('flights and fuel UI',()=>{
  it('loads only from the same-origin API and hides request controls without permission',async()=>{
    expect((await loadFlights(new AbortController().signal)).flights).toHaveLength(1);
    expect(api).toHaveBeenCalledWith('/api/flights',expect.objectContaining({credentials:'same-origin',cache:'no-store'}));
    permissions=[PERMISSIONS.flightsView];await renderFlights();
    expect(host.textContent).toContain('LN-UPT');expect(host.textContent).not.toContain('Request fuel');
  });
  it('offers aircraft presets and explicit quantity and submits a strict fuel choice',async()=>{
    await renderFlights();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Request fuel')?.click());
    const choice=host.querySelector<HTMLSelectElement>('.fuel-form select')!;
    expect(host.textContent).toContain('Full mains');expect(host.textContent).toContain('Add quantity');
    await act(async()=>{choice.value='QUANTITY';choice.dispatchEvent(new Event('change',{bubbles:true}));});
    const input=host.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async()=>{input.value='40';input.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(host.textContent).toContain('US gal');
  });
  it('shows the two shift-task contexts and a single Complete action',async()=>{
    await act(async()=>root.render(<MemoryRouter initialEntries={['/duty-ops/shifts/shift-1']}><Routes>
      <Route path="/duty-ops/shifts/:shiftId" element={<DutyShiftPage />} /></Routes></MemoryRouter>));
    expect(host.textContent).toContain('Known earlier flight expected back');
    expect(host.textContent).toContain('booking end');
    expect(host.querySelectorAll('button').length).toBe(2); // Reload and Complete.
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Complete')!.click());
    expect(api.mock.calls.some(([path])=>path.endsWith('/complete'))).toBe(true);
  });
});
