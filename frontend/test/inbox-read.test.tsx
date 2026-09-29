// @vitest-environment jsdom
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { MemoryRouter,Route,Routes } from 'react-router';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { AppShell } from '../src/app/AppShell';
import { InboxPage } from '../src/pages/ContactPages';

vi.mock('../src/app/CurrentUser',()=>({useCurrentUser:()=>({user:{subject:'student',email:'student@example.test',permissions:[],roles:[]},
  loading:false,error:'',retry:vi.fn()})}));
vi.mock('../src/app/permissions',()=>({usePermissions:()=>({hasPermission:()=>false})}));
const ids=['a'.repeat(32),'b'.repeat(32),'c'.repeat(32)];
const sources=['FLIGHT_CHANGE','CONTACT_MESSAGE','EXCHANGE'];
let root:Root,host:HTMLDivElement,read:Set<string>,api:ReturnType<typeof vi.fn>;
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);window.scrollTo=vi.fn();read=new Set();
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  api=vi.fn(async(path:string,init:RequestInit)=>{
    if(path==='/api/inbox')return Response.json({items:ids.map((id,index)=>({id,kind:'NOTICE',sourceType:sources[index],
      createdAt:'2026-09-29T08:00:00.000Z',readAt:read.has(id)?'2026-09-29T08:01:00.000Z':null,
      title:['New flight added','Webmaster reply','Exchange offer'][index],summary:null,
      target:{path:['/flights','/messages/one','/duty-ops'][index]},flight:null,changes:[]})),unreadCount:ids.length-read.size,nextCursor:null});
    if(path===`/api/inbox/${ids[0]}/read`&&init.method==='POST'){
      read.add(ids[0]);return Response.json({id:ids[0],readAt:'2026-09-29T08:01:00.000Z'});
    }
    throw new Error(path);
  });vi.stubGlobal('fetch',api);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
async function render(){await act(async()=>root.render(<MemoryRouter initialEntries={['/inbox']}><Routes><Route element={<AppShell/>}>
  <Route path="/inbox" element={<InboxPage/>}/><Route path="/flights" element={<p>Flights destination</p>}/>
  </Route></Routes></MemoryRouter>));}

it('leaves all three source kinds unread when merely visiting Inbox',async()=>{
  await render();expect(host.querySelectorAll('.inbox-list li.unread')).toHaveLength(3);
  expect(host.querySelector('.header-inbox-count')?.textContent).toBe('3');
  expect(api.mock.calls.filter(([path])=>path.endsWith('/read'))).toHaveLength(0);
});
it('marks only the selected item read and updates the header badge',async()=>{
  await render();await act(async()=>host.querySelector<HTMLButtonElement>('.inbox-list li button')!.click());
  expect(read).toEqual(new Set([ids[0]]));expect(host.querySelectorAll('.inbox-list li.unread')).toHaveLength(2);
  expect(host.querySelector('.header-inbox-count')?.textContent).toBe('2');
  expect(host.textContent).toContain('Webmaster reply');expect(host.textContent).toContain('Exchange offer');
});
it('awaits the empty read POST before navigating from Open',async()=>{
  let finish:(value:Response)=>void=()=>{};
  const original=api.getMockImplementation()!;
  api.mockImplementation((path:string,init:RequestInit)=>path.endsWith('/read')?new Promise<Response>(resolve=>{finish=resolve;}):original(path,init));
  await render();
  await act(async()=>host.querySelector<HTMLAnchorElement>('.inbox-list li a')!.click());
  expect(host.textContent).not.toContain('Flights destination');
  expect(api.mock.calls.find(([path])=>path.endsWith('/read'))?.[1]).toMatchObject({method:'POST',credentials:'same-origin'});
  await act(async()=>{read.add(ids[0]);finish(Response.json({id:ids[0],readAt:'2026-09-29T08:01:00.000Z'}));});
  expect(host.textContent).toContain('Flights destination');
  expect(host.querySelector('.header-inbox-count')?.textContent).toBe('2');
});
