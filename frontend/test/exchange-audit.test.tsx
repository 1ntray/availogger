// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExchangeAuditPage } from '../src/pages/ExchangeAuditPage';

let host:HTMLDivElement,root:Root,fetcher:ReturnType<typeof vi.fn>;
const id='a1111111-1111-4111-8111-111111111111';
const source={id:'s1',startsAt:'2026-10-05T06:00:00.000Z',endsAt:'2026-10-05T11:00:00.000Z',status:'OPEN'};
const owner={id:'u1',firstName:'Simon',lastName:'Student'};
beforeEach(()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  fetcher=vi.fn(async(path:string)=>Response.json(path.includes(`/${id}`)?{
    id,domain:'DUTY_OPS',status:'COMPLETED',reason:null,owner,source,
    events:[{id:'e1',type:'INTENT_CREATED',reason:null,createdAt:'2026-09-28T18:31:00.000Z',actor:owner,snapshot:{source}},
      {id:'e2',type:'CANDIDATE_COMMITTED',reason:null,createdAt:'2026-09-28T18:35:00.000Z',actor:owner,
        snapshot:{creditDeltas:[{userId:'u1',amount:0}]}}],
    candidates:[{id:'c1',status:'COMPLETED',reason:null,created_at:'2026-09-28T18:32:00.000Z',completed_at:'2026-09-28T18:35:00.000Z',
      legs:[{user:owner,give:source,receive:null,consentSource:'GIVE_AWAY',consentedAt:'2026-09-28T18:32:00.000Z'}]}],credits:[]
  }:{cases:[{id,domain:'DUTY_OPS',status:'COMPLETED',reason:null,owner,source,candidateCount:1,
    createdAt:'2026-09-28T18:31:00.000Z'}]}));
  vi.stubGlobal('fetch',fetcher);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});
it('filters Exchange cases and presents a read-only chronological audit without private fields',async()=>{
  await act(async()=>root.render(<MemoryRouter><ExchangeAuditPage/></MemoryRouter>));
  expect(host.querySelector('h1')?.textContent).toBe('Exchange audit');
  expect(host.textContent).toContain('Simon Student');
  await act(async()=>host.querySelector<HTMLButtonElement>('.exchange-audit-cases button')!.click());
  expect([...host.querySelectorAll('.exchange-audit-timeline li strong')].map(node=>node.textContent))
    .toEqual(['Intent created','Candidate committed']);
  expect(host.querySelector('.exchange-audit-candidates')?.textContent).toContain('Simon Student');
  expect(host.querySelector('.exchange-audit-candidates')?.textContent).toContain('Consented via Give away');
  expect(host.innerHTML).not.toMatch(/access_subject|token|email/i);
  expect(fetcher.mock.calls.map(([path])=>path)).toEqual(['/api/admin/exchanges',`/api/admin/exchanges/${id}`]);
});
