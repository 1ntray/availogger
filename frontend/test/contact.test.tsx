// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter,Route,Routes } from 'react-router';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { ContactDetailPage } from '../src/pages/ContactPages';

let host:HTMLDivElement,root:ReturnType<typeof createRoot>;
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);host=document.createElement('div');document.body.append(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

it('renders contact text and page context without interpreting markup or making a link',async()=>{
  const payload='<script>window.hacked=true</script>';
  vi.stubGlobal('fetch',vi.fn(async()=>Response.json({thread:{id:'a'.repeat(32),channelId:'webmaster',category:'BUG',title:`Bug: ${payload}`,
    currentPath:'/feedback',status:'OPEN',createdAt:'2026-09-28T12:00:00.000Z',updatedAt:'2026-09-28T12:00:00.000Z',resolvedAt:null,
    author:{id:'student',firstName:null,lastName:null,email:'student@example.test'}},
    messages:[{id:'message',body:payload,createdAt:'2026-09-28T12:00:00.000Z',author:{id:'student',firstName:null,lastName:null}}],hasMore:false})));
  await act(async()=>root.render(<MemoryRouter initialEntries={[`/messages/${'a'.repeat(32)}`]}><Routes><Route path="/messages/:threadId" element={<ContactDetailPage/>}/></Routes></MemoryRouter>));
  expect(host.textContent).toContain(payload);
  expect(host.querySelector('script')).toBeNull();
  expect(host.querySelector('.contact-context a')).toBeNull();
});
