// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { MemoryRouter,Route,Routes } from 'react-router';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { FlightsPage } from '../src/pages/FlightsPage';
import { DutyShiftPage } from '../src/pages/DutyShiftPage';
import { loadFlights } from '../src/features/flights/api';
import { flightSegments } from '../src/features/flights/presentation';
import { PERMISSIONS,type PermissionKey } from '../../shared/authorization';

let permissions:PermissionKey[]=[],host:HTMLDivElement,root:Root,api:ReturnType<typeof vi.fn>;
const refresh=vi.fn();
vi.mock('../src/app/CurrentUser',()=>({useCurrentUser:()=>({user:{permissions},refresh})}));
const future=new Date(Date.now()+2*3600_000).toISOString(),end=new Date(Date.now()+4*3600_000).toISOString();
const flightStart=new Date(Date.parse(future)+30*60_000).toISOString(),flightEnd=new Date(Date.parse(end)-30*60_000).toISOString();
const flight={id:'flight-1',bookingType:'SingleStudentBooking',startsAt:future,endsAt:end,flightStartsAt:flightStart,flightEndsAt:flightEnd,status:'OPEN',
  aircraft:{id:'aircraft-1',callSign:'LN-UPT',model:'Z242L',aircraftClass:'AIRPLANE'},departureAirport:{id:'2953',name:'Bardufoss'},
  arrivalAirport:{id:'1',name:'Tromsø'},instructor:'Richard Nilsen',plannedLessons:[{trainingId:'tr-1',trainingName:'4.2 Instrument approaches',lectureId:null,lectureName:null}],
  canOrder:true,profile:{id:'Z242L',name:'Zlin',presets:[{key:'FULL_MAINS',label:'Full mains'}]},request:null};
const flights={from:'2026-09-20',to:'2026-11-20',timeZone:'Europe/Oslo',sync:{lastSyncedAt:new Date().toISOString(),stale:false,warning:null},flights:[flight]};
const tasks={shift:{id:'shift-1',startsAt:new Date(Date.now()-3600_000).toISOString(),endsAt:end},tasks:[{id:'request-1',flightId:'flight-1',
  flightStartsAt:future,attentionFrom:new Date(Date.now()+3600_000).toISOString(),aircraft:flight.aircraft,pilot:'Pilot Test',requested:'Full mains',fuelBreakdown:null,status:'PENDING',
  earlierFlight:{endsAt:new Date(Date.now()+1800_000).toISOString(),timeSource:'booking',pilot:null}}]};
const duty = { from: '2026-09-20', to: '2026-11-20', timeZone: 'Europe/Oslo', shifts: [{ ...tasks.shift, status: 'OPEN', participantCount: 1,
  participants: [{ userId: 'me', firstName: 'Simon', lastName: null, isCurrentUser: true }],
  flightlogger: { participantCount: 1, participants: [{ userId: 'other', firstName: 'Anna', lastName: null, isCurrentUser: false }] }, assignmentsDiffer: true }],
  sync: { stale: false, warning: null, discovery: { lastSyncedAt: new Date().toISOString(), stale: false, from: future, to: end }, assignments: { lastSyncedAt: new Date().toISOString(), stale: false, from: future, to: end } } };
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);permissions=[PERMISSIONS.flightsView,PERMISSIONS.fuelRequest];
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api=vi.fn(async(path:string,init:RequestInit)=>path==='/api/flights'?Response.json(flights)
    :path==='/api/duty-ops'?Response.json(duty)
    :path.endsWith('/complete')?Response.json({status:'COMPLETED',completedAt:new Date().toISOString(),completedBy:'Duty Ops student'})
    :path.includes('/tasks')?Response.json(tasks):Response.json({id:'request-1',status:'PENDING'}));vi.stubGlobal('fetch',api);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function renderFlights(){await act(async()=>root.render(<MemoryRouter><FlightsPage /></MemoryRouter>));}
describe('flights and fuel UI',()=>{
  it('shows only meaningful Brief, Flight and End milestones',()=>{
    const segments=flightSegments(flight);
    expect(segments.brief).toEqual({start:future,end:null});
    expect(segments.flight).toEqual({start:flightStart,end:flightEnd});
    expect(segments.end).toEqual({start:end,end:null});
    expect(flightSegments({...flight,endsAt:flightEnd}).end).toBeNull();
    expect(flightSegments({...flight,endsAt:new Date(Date.parse(flightEnd)+30_000).toISOString()}).end).toBeNull();
  });
  it('loads only from the same-origin API and hides request controls without permission',async()=>{
    expect((await loadFlights(new AbortController().signal)).flights).toHaveLength(1);
    expect(api).toHaveBeenCalledWith('/api/flights',expect.objectContaining({credentials:'same-origin',cache:'no-store'}));
    permissions=[PERMISSIONS.flightsView];await renderFlights();
    expect(host.textContent).toContain('LN-UPT');expect(host.textContent).not.toContain('Request fuel');
  });
  it('prioritizes briefing and shows truthful flight segments without route or model',async()=>{
    await renderFlights();
    const row=host.querySelector('.flight-row')!;
    expect([...row.querySelectorAll('.flight-segment')].map(node=>node.textContent)).toEqual([
      expect.stringContaining('Brief'),expect.stringContaining('Flight'),expect.stringContaining('End')]);
    expect(row.querySelectorAll('.flight-segment')[0].querySelectorAll('time')).toHaveLength(1);
    expect(row.querySelectorAll('.flight-segment')[2].querySelectorAll('time')).toHaveLength(1);
    expect(row.querySelector('.flight-segment:first-child time')?.getAttribute('datetime')).toBe(future);
    expect(row.textContent).toContain('4.2 Instrument approaches');expect(row.textContent).toContain('Richard Nilsen');
    expect(row.textContent).toContain('LN-UPT');expect(row.textContent).not.toMatch(/Bardufoss|Tromsø|Z242L/);
  });
  it('offers Z242 presets and verifies custom total before submitting litres',async()=>{
    await renderFlights();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Request fuel')?.click());
    const choice=host.querySelector<HTMLSelectElement>('.fuel-form select')!;
    expect(host.textContent).toContain('Full mains');expect(host.textContent).toContain('Add quantity');
    await act(async()=>{choice.value='QUANTITY';choice.dispatchEvent(new Event('change',{bubbles:true}));});
    const input=host.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'150');input.dispatchEvent(new Event('input',{bubbles:true}));});
    expect(host.textContent).toContain('Aux total34 L');expect(host.textContent).toContain('Each aux tank17 L');
    expect(host.querySelector('.fuel-form label select')).toBe(choice);
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    const submission=api.mock.calls.find(([path,init])=>path.includes('/fuel')&&init.method==='POST');
    expect(JSON.parse(submission![1].body)).toEqual({kind:'QUANTITY',quantityValue:150,quantityUnit:'L'});
  });
  it('fixes C182 custom quantity to US gallons without a unit selector',async()=>{
    const c182={...flight,aircraft:{...flight.aircraft,callSign:'LN-TRB',model:'C182T'},profile:{id:'C182T',name:'Cessna 182T',presets:[{key:'TABS',label:'Tabs'}]}};
    api.mockImplementation(async(path:string,init:RequestInit)=>path==='/api/flights'?Response.json({...flights,flights:[c182]}):Response.json({id:'request',status:'PENDING'}));
    await renderFlights();await act(async()=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent==='Request fuel')?.click());
    const choice=host.querySelector<HTMLSelectElement>('.fuel-form select')!;
    await act(async()=>{choice.value='QUANTITY';choice.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(host.textContent).toContain('US gal');expect(host.querySelectorAll('.fuel-form select')).toHaveLength(1);
    const input=host.querySelector<HTMLInputElement>('input[type="number"]')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'18');input.dispatchEvent(new Event('input',{bubbles:true}));});
    await act(async()=>host.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    const submission=api.mock.calls.find(([path,init])=>path.includes('/fuel')&&init.method==='POST');
    expect(JSON.parse(submission![1].body)).toEqual({kind:'QUANTITY',quantityValue:18,quantityUnit:'US_GAL'});
  });
  it('shows the structured Z242 breakdown on a Duty Ops fuel task',async()=>{
    api.mockImplementation(async(path:string)=>path==='/api/duty-ops'?Response.json(duty):path.includes('/tasks')?Response.json({...tasks,tasks:[{...tasks.tasks[0],
      requested:'150 L',fuelBreakdown:{total:150,mains:116,auxTotal:34,eachAux:17,unit:'L'}}]}):Response.json(flights));
    await act(async()=>root.render(<MemoryRouter initialEntries={['/duty-ops/shifts/shift-1']}><Routes>
      <Route path="/duty-ops/shifts/:shiftId" element={<DutyShiftPage />} /></Routes></MemoryRouter>));
    expect(host.textContent).toContain('Aux total34 L');expect(host.textContent).toContain('Each aux17 L');
  });
  it('shows the two shift-task contexts and a single Complete action',async()=>{
    await act(async()=>root.render(<MemoryRouter initialEntries={['/duty-ops/shifts/shift-1']}><Routes>
      <Route path="/duty-ops/shifts/:shiftId" element={<DutyShiftPage />} /></Routes></MemoryRouter>));
    expect(host.textContent).toContain('Known earlier flight expected back');
    expect(host.textContent).toContain('booking end');
    expect(host.textContent).toContain('Simon');
    expect(host.querySelector('.attention-detail summary')?.textContent).toContain('Assignments differ from FlightLogger');
    expect(host.querySelectorAll('button').length).toBe(2); // Reload and Complete.
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Complete')!.click());
    expect(api.mock.calls.some(([path])=>path.endsWith('/complete'))).toBe(true);
  });
});
