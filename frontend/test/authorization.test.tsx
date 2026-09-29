// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { permissionDefinitions, type PermissionKey } from '../../shared/authorization';

vi.mock('../src/pwa/PwaProvider', () => ({ PwaProvider: ({ children }: { children: ReactNode }) => children,
  usePwa: () => ({ canInstall: false, installed: false, installing: false, needsUpdate: false, error: '', install: vi.fn(), update: vi.fn() }) }));
const baseline: PermissionKey[] = ['duty_ops.view'];
const catalogue = { permissions: permissionDefinitions, roles: [
  { key: 'ADMIN', name: 'Administrator', permissions: permissionDefinitions.map(permission => permission.key) },
  { key: 'STUDENT', name: 'Student', permissions: baseline },
] };
const student = { id: 'student-id', email: 'student@example.test', firstName: 'Student', lastName: 'Example', roles: ['STUDENT'], permissions: baseline };
const access = { user: { id: student.id, email: student.email, firstName: student.firstName, lastName: student.lastName }, roles: student.roles, permissions: baseline,
  inheritedPermissions: baseline, overrides: {}, revision: 1 };
let currentPermissions: PermissionKey[];
let api: ReturnType<typeof vi.fn>;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); window.scrollTo = vi.fn();
  currentPermissions = permissionDefinitions.map(permission => permission.key);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  api = vi.fn(async (path: string) => {
    if (path === '/api/me') return Response.json({ email: 'owner@example.test', subject: 'verified-subject', firstName: 'Portal', lastName: 'Owner',
      onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-owner',
      roles: ['ADMIN', 'STUDENT'], permissions: currentPermissions });
    if (path === '/api/admin/users') return Response.json({ users: [student] });
    if (path === '/api/admin/permissions') return Response.json(catalogue);
    return Response.json(access);
  });
  vi.stubGlobal('fetch', api);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render(path = '/admin/users') { await act(async () => root.render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)); }
async function selectUser() {
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes(student.email))!.click());
}
async function changePermission(value: string) {
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[id="permission-availability.view"]')!;
    select.value = value; select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function save() { await act(async () => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

describe('admin access editor', () => {
  it('shows FlightLogger names first and searches first, last, full name and email', async () => {
    await render();
    const listed = host.querySelector('.admin-user-list button')!;
    expect(listed.querySelector('strong')?.textContent).toBe('Student Example');
    expect(listed.querySelector('span')?.textContent).toContain(student.email);
    const input = host.querySelector<HTMLInputElement>('#user-search')!;
    for (const term of ['Student', 'Example', 'student example', 'student@example.test']) {
      await act(async () => { input.value = term; input.dispatchEvent(new Event('input', { bubbles: true })); });
      expect(host.querySelectorAll('.admin-user-list li')).toHaveLength(1);
    }
    await selectUser();
    expect(host.querySelector('.admin-editor h2')?.textContent).toBe('Student Example');
    expect(host.querySelector('.admin-editor .small-note')?.textContent).toBe(student.email);
  });
  it('allows the personal history route with view permission but no swap permission', async () => {
    currentPermissions = baseline;
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (path: string) => path === '/api/duty-ops/swaps/history' ? Response.json({ entries: [], nextCursor: null }) : original(path));
    await render('/duty-ops/swap-history');
    expect(host.querySelector('h1')!.textContent).toBe('My activity');
    expect(host.textContent).toContain('No accepted activity yet');
    expect(api.mock.calls.map(([path]) => path).filter(path => path !== '/api/inbox')).toEqual(['/api/me', '/api/duty-ops/swaps/history']);
  });
  it('loads real user access, distinguishes inherited/explicit permissions, and refreshes on a successful save', async () => {
    await render(); await selectUser();
    expect(host.textContent).toContain('Allowed');
    expect(host.textContent).toContain('Duty Ops');
    await changePermission('ALLOW');
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (path: string, init: RequestInit) => init.method === 'PUT'
      ? Response.json({ ...access, overrides: { 'availability.view': 'ALLOW' }, permissions: [...baseline, 'availability.view'], revision: 2 })
      : original(path, init));
    await save();
    expect(host.textContent).toContain('Access saved.');
    expect(host.textContent).toContain('Allowed');
    const [path, init] = api.mock.calls.find(([, options]) => options?.method === 'PUT')!;
    expect(path).toBe('/api/admin/users/student-id/access');
    expect(init).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(JSON.parse(init.body)).toEqual({ roles: ['STUDENT'], overrides: { 'availability.view': 'ALLOW' }, revision: 1 });
    expect(api.mock.calls.filter(([path]) => path === '/api/me')).toHaveLength(2);
  });
  it('disables privileged controls for manage_users alone', async () => {
    currentPermissions = [...baseline, 'admin.manage_users'];
    await render(); await selectUser();
    expect(host.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled).toBe(true);
    for (const key of ['admin.manage_users', 'admin.manage_permissions', 'duty_ops.manage_schedule', 'brakkevakt.manage_schedule']) {
      expect(host.querySelector<HTMLSelectElement>(`[id="permission-${key}"]`)!.disabled).toBe(true);
    }
    expect(host.querySelector<HTMLSelectElement>('[id="permission-availability.view"]')!.disabled).toBe(false);
  });
  it('blocks duplicate saves and restores saved access after server rejection', async () => {
    await render(); await selectUser(); await changePermission('ALLOW');
    let resolve!: (value: Response) => void;
    const original = api.getMockImplementation()!;
    api.mockImplementation((path: string, init: RequestInit) => init.method === 'PUT'
      ? new Promise<Response>(done => { resolve = done; }) : original(path, init));
    await save(); await save();
    expect(api.mock.calls.filter(([, init]) => init?.method === 'PUT')).toHaveLength(1);
    expect([...host.querySelectorAll('button')].find(button => button.textContent === 'Saving…')!.disabled).toBe(true);
    await act(async () => resolve(Response.json({ error: 'This update would remove the final administrator.' }, { status: 409 })));
    expect(host.querySelector('[role=alert]')!.textContent).toContain('final administrator');
    expect(host.querySelector<HTMLSelectElement>('[id="permission-availability.view"]')!.value).toBe('INHERIT');
    expect(host.textContent).not.toContain('Access saved.');
  });
  it('hides Admin navigation and guards the route for a student', async () => {
    currentPermissions = baseline;
    await render();
    expect(host.querySelector('h1')!.textContent).toBe('Access denied');
    expect(host.querySelector('a[href="/admin/users"]')).toBeNull();
    expect(api.mock.calls.map(([path]) => path).filter(path => path !== '/api/inbox')).toEqual(['/api/me']);
  });
});
