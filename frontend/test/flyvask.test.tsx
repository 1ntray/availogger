// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { isFlyvaskData } from '../src/features/flyvask/api';
import type { FlyvaskData, FlyvaskShift } from '../src/features/flyvask/types';
import type { ExchangeRequest, ExchangeHistoryEntry } from '../../shared/flyvask-swaps';

vi.mock('../src/pwa/PwaProvider', () => ({ PwaProvider: ({ children }: { children: ReactNode }) => children }));
const now = Date.parse('2026-09-27T08:00:00.000Z');
const me = {userId:'me',firstName:'Simon',lastName:null,isCurrentUser:true};
const anna = {userId:'anna',firstName:'Anna',lastName:null,isCurrentUser:false};
const a: FlyvaskShift = {id:'a',startsAt:'2026-10-17T16:00:00.000Z',endsAt:'2026-10-17T18:00:00.000Z',status:'OPEN',classroomId:'602',classroomName:'Hangar UTSA',participantCount:14,
  participants:[me],flightlogger:{participants:[me],participantCount:14},assignmentsDiffer:false};
const b: FlyvaskShift = {...a,id:'b',startsAt:'2026-10-24T16:00:00.000Z',endsAt:'2026-10-24T18:00:00.000Z',participants:[anna],flightlogger:{participants:[anna],participantCount:14}};
const meta={lastSyncedAt:new Date(now).toISOString(),from:'2026-08-27T22:00:00.000Z',to:'2026-11-26T23:00:00.000Z',stale:false};
const initialData:FlyvaskData={from:'2026-08-28',to:'2026-11-26',timeZone:'Europe/Oslo',shifts:[a,b],sync:{stale:false,warning:null,discovery:meta,assignments:meta}};
const proposal={id:'proposal',proposer:{id:'anna',firstName:'Anna',lastName:null},offeredShift:b,status:'OPEN' as const,createdAt:new Date(now).toISOString(),eligible:true};
const request:ExchangeRequest={id:'request',type:'DIRECT_SWAP',status:'OPEN',requester:{id:'me',firstName:'Simon',lastName:null},requestedShift:a,acceptedBy:null,acceptedProposalId:null,acceptedAt:null,createdAt:new Date(now).toISOString(),eligible:true,proposals:[proposal]};
const entry:ExchangeHistoryEntry={id:'request',type:'DIRECT_SWAP',counterparty:proposal.proposer,givenShift:{...a,id:null},receivedShift:{...b,id:null},acceptedAt:new Date(now).toISOString()};
let root:Root,host:HTMLDivElement,permissions:string[],data:FlyvaskData,requests:ExchangeRequest[],locks:string[],entries:ExchangeHistoryEntry[];
let api:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.useFakeTimers({toFake:['Date']}); vi.setSystemTime(now); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true); window.scrollTo=vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype,'showModal',{configurable:true,value(){this.setAttribute('open','');}});
  permissions=['flyvask.view','flyvask.swap']; data=structuredClone(initialData); requests=[]; locks=[]; entries=[entry];
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api=vi.fn(async(path:string,init:RequestInit={})=>{
    if(path==='/api/me') return Response.json({email:'student@test',subject:'me',firstName:'Simon',lastName:null,onboardingComplete:true,hasFlightLoggerCredential:true,flightLoggerUserId:'fl-me',roles:['STUDENT'],permissions});
    if(init.method==='POST') return Response.json({id:'request'});
    if(path==='/api/flyvask') return Response.json(data);
    if(path.startsWith('/api/flyvask/swaps/history')) return Response.json({entries,nextCursor:null});
    if(path.startsWith('/api/flyvask/swaps')) return Response.json({currentUserId:'me',requests,lockedShiftIds:locks,nextCursor:null});
    throw new Error(`Unexpected endpoint ${path}`);
  }); vi.stubGlobal('fetch',api);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();vi.useRealTimers();});
async function render(path='/flyvask'){await act(async()=>root.render(<MemoryRouter initialEntries={[path]}><App/></MemoryRouter>));}
async function click(text:string,scope:ParentNode=host.querySelector('dialog')??host){const button=[...scope.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===text)!;expect(button).toBeDefined();expect(button.disabled).toBe(false);await act(async()=>button.click());}

describe('Flyvask navigation and schedule',()=>{
  it('hides navigation and rejects direct routes without view permission',async()=>{
    permissions=['flyvask.swap'];await render();expect(host.textContent).toContain('Access denied');
    expect(host.querySelector('aside a[href="/flyvask"]')).toBeNull();expect(api.mock.calls.map(([path])=>path)).toEqual(['/api/me']);
  });
  it('loads a real route and hides controls without swap permission',async()=>{
    permissions=['flyvask.view'];await render();expect(host.querySelector('h1')!.textContent).toBe('Flyvask');
    expect(host.querySelector('aside a[href="/flyvask"]')).not.toBeNull();expect(host.querySelector('nav[aria-label="Flyvask views"] a[aria-current="page"]')!.textContent).toBe('Overview');
    expect(host.textContent).toContain('My Flyvask');expect(host.textContent).not.toContain('Look for swap');expect(host.querySelector('.duty-exchanges')).toBeNull();expect(api.mock.calls.map(([path])=>path)).toEqual(['/api/me','/api/flyvask']);
  });
  it('shows only look-for-swap, publishes immediately with no type selector or give-away',async()=>{
    await render();await click('Look for swap');
    const post=api.mock.calls.find(([,init])=>init?.method==='POST')!;
    expect(post[0]).toBe('/api/flyvask/swaps');expect(JSON.parse(post[1].body)).toEqual({shiftId:'a',startsAt:a.startsAt,endsAt:a.endsAt});
    expect(host.textContent).not.toMatch(/Give away|Take shift|Exchange type/);expect(host.querySelector('[name="exchange-type"]')).toBeNull();
  });
  it('uses effective My Flyvask and source labels/counts without inferring masked identities',async()=>{
    data.shifts=[{...a,participants:[anna],assignmentsDiffer:true},{...b,participants:[me],assignmentsDiffer:true}];await render();
    const mine=host.querySelector('section[aria-labelledby="flyvask-mine"]')!; expect(mine.querySelector('time')!.getAttribute('datetime')).toBe(b.startsAt);
    expect(mine.textContent).toContain('StudentportalSimon · 13 others');expect(mine.textContent).toContain('FlightLoggerAnna · 13 others');expect(mine.querySelector('.sr-only')!.textContent).toBe('Your shift');
    expect(mine.textContent).toContain('Hangar UTSA');expect(mine.textContent).not.toContain('17 Oct');
  });
  it('does not enable past, cancelled, started or non-own shifts for exchange',async()=>{
    data.shifts=[{...a,status:'CANCELLED'},{...a,id:'started',startsAt:new Date(now).toISOString(),endsAt:'2026-09-27T12:00:00.000Z'},b];await render();
    expect(host.textContent).not.toContain('Look for swap');
  });
  it('shows compact unchanged source and useful stale/error states',async()=>{
    data.sync.stale=true;data.sync.warning='Refresh failed. Showing previously synchronized Flyvask data.';await render();
    expect(host.querySelectorAll('.duty-source-inline').length).toBeGreaterThan(0);expect(host.textContent).toContain(data.sync.warning);expect(host.querySelector('.duty-assignment-sources')).toBeNull();
  });
  it('rejects malformed source metadata rather than rendering a partial schedule',()=>{
    expect(isFlyvaskData(data)).toBe(true);expect(isFlyvaskData({...data,shifts:[{...a,classroomName:42}]})).toBe(false);expect(isFlyvaskData({...data,shifts:[{...a,flightlogger:undefined}]})).toBe(false);
  });
});

describe('Flyvask direct swap workspace',()=>{
  it('compares multiple offers, confirms both shifts and immediately reloads effective assignments',async()=>{
    requests=[{...request,proposals:[proposal,{...proposal,id:'other',proposer:{id:'erik',firstName:'Erik',lastName:null}}]}];locks=['a'];
    const original=api.getMockImplementation()!;
    api.mockImplementation(async(path:string,init:RequestInit={})=>{if(init.method==='POST'){requests=[];locks=[];data.shifts=[{...a,participants:[anna],assignmentsDiffer:true},{...b,participants:[me],assignmentsDiffer:true}];return Response.json({id:'request'});}return original(path,init);});
    await render();const choices=[...host.querySelectorAll<HTMLButtonElement>('.duty-exchanges button')].filter(b=>b.textContent==='Choose this swap');expect(choices).toHaveLength(2);await act(async()=>choices[0].click());
    const dialog=host.querySelector('dialog')!;expect(dialog.textContent).toContain('Your Flyvask');expect(dialog.textContent).toContain('Anna’s Flyvask');expect(dialog.textContent).toContain('Sat 17 Oct');expect(dialog.textContent).toContain('Sat 24 Oct');expect(dialog.textContent).toContain('FlightLogger is not updated automatically');
    await click('Confirm swap');expect(api.mock.calls.find(([,init])=>init?.method==='POST')![0]).toBe('/api/flyvask/swaps/request/proposals/proposal/accept');
    const mine=host.querySelector('section[aria-labelledby="flyvask-mine"]')!;expect(mine.querySelector('time')!.getAttribute('datetime')).toBe(b.startsAt);expect(mine.textContent).not.toContain('17 Oct');expect(mine.textContent).toContain('Look for swap');expect(host.querySelector('.duty-exchanges')!.textContent).not.toContain('Choose this swap');
  });
  it('offers only an eligible effective own shift, never source-only or locked memberships',async()=>{
    requests=[{...request,requester:proposal.proposer,requestedShift:b,proposals:[]}];
    data.shifts=[a,b,{...a,id:'locked'},{...a,id:'cancelled',status:'CANCELLED'},{...a,id:'source-only',participants:[anna],assignmentsDiffer:true}];locks=['locked'];
    await render();await click('Offer one of my Flyvask shifts');const select=host.querySelector<HTMLSelectElement>('select')!;expect([...select.options].map(o=>o.value)).toEqual(['','a']);
    await act(async()=>{select.value='a';select.dispatchEvent(new Event('change',{bubbles:true}));});await click('Offer shift');expect(JSON.parse(api.mock.calls.find(([,init])=>init?.method==='POST')![1].body).shiftId).toBe('a');
  });
  it('keeps stale own intent cancellable and excludes completed activity',async()=>{
    requests=[{...request,eligible:false,proposals:[]},{...request,id:'accepted',status:'ACCEPTED'},{...request,id:'cancelled',status:'CANCELLED'}];
    const original=api.getMockImplementation()!;api.mockImplementation(async(path:string,init:RequestInit={})=>{if(init.method==='POST'){requests=[];return Response.json({id:'request'});}return original(path,init);});
    await render();expect(host.querySelectorAll('.exchange-row')).toHaveLength(1);expect(host.textContent).toContain('No longer eligible');await click('Cancel request');await click('Cancel request');expect(host.querySelectorAll('.exchange-row')).toHaveLength(0);
  });
  it('allows withdrawal of own offer and displays safe mutation errors',async()=>{
    requests=[{...request,requester:proposal.proposer,requestedShift:b,proposals:[{...proposal,proposer:request.requester,offeredShift:a}]}];
    const original=api.getMockImplementation()!;api.mockImplementation(async(path:string,init:RequestInit={})=>init.method==='POST'?Response.json({error:'This swap changed. Reload Flyvask.'},{status:409}):original(path,init));
    await render();await click('Withdraw offer');await click('Withdraw offer');expect(host.querySelector('[role="alert"]')!.textContent).toContain('This swap changed');
    expect(api.mock.calls.find(([,init])=>init?.method==='POST')![0]).toContain('/withdraw');
  });
});

describe('Flyvask personal history',()=>{
  it('is bookmarkable, view-only, accepted-only and user oriented with stored semantic times',async()=>{
    permissions=['flyvask.view'];await render('/flyvask/swap-history');expect(host.querySelector('h1')!.textContent).toBe('Flyvask swap history');
    expect(host.querySelector('nav[aria-label="Flyvask views"] a[aria-current="page"]')!.textContent).toBe('Swap history');expect(host.textContent).toContain('Swapped with Anna');expect(host.textContent).toContain('You gave');expect(host.textContent).toContain('You received');
    expect([...host.querySelectorAll('.swap-history-shifts time')].map(t=>t.getAttribute('datetime'))).toEqual([a.startsAt,b.startsAt]);expect(host.textContent).toContain('FlightLogger is not updated automatically');
    expect(api.mock.calls.map(([path])=>path)).toEqual(['/api/me','/api/flyvask/swaps/history']);expect(host.querySelectorAll('.swap-history-shifts > div')).toHaveLength(2);
  });
  it('loads next keyset page and shows separate chain links with graceful name fallback',async()=>{
    let page=0; const original=api.getMockImplementation()!;
    api.mockImplementation(async(path:string,init:RequestInit={})=>path.startsWith('/api/flyvask/swaps/history')?Response.json(page++?{entries:[{...entry,id:'second',counterparty:{id:'bob',firstName:null,lastName:null},givenShift:b,receivedShift:a}],nextCursor:null}:{entries:[entry],nextCursor:'cursor|id'}):original(path,init));
    await render('/flyvask/swap-history');await click('Load more history');expect(host.querySelectorAll('.swap-history > li')).toHaveLength(2);expect(host.textContent).toContain('Swapped with Student');
    const call=api.mock.calls.find(([path])=>path.includes('?cursor='))!;expect(call[0]).toBe('/api/flyvask/swaps/history?cursor=cursor%7Cid');expect(call[1]).toMatchObject({cache:'no-store',credentials:'same-origin'});
  });
});
