// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App';
import { permissionDefinitions, type PermissionKey } from '../../shared/authorization';

vi.mock('../src/pwa/PwaProvider', () => ({ PwaProvider: ({ children }: { children: ReactNode }) => children,
  usePwa: () => ({ canInstall: false, installed: false, installing: false, needsUpdate: false, error: '', install: vi.fn(), update: vi.fn() }) }));
const baseline: PermissionKey[] = ['duty_ops.view', 'transport.view'];
const catalogue = { permissions: permissionDefinitions, roles: [
  { key: 'ADMIN', name: 'Administrator', permissions: permissionDefinitions.map(permission => permission.key) },
  { key: 'STUDENT', name: 'Student', permissions: baseline },
] };
const student = { id: 'student-id', email: 'student@example.test', roles: ['STUDENT'], permissions: baseline };
const access = { user: { id: student.id, email: student.email }, roles: student.roles, permissions: baseline,
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
    if (path === '/api/me') return Response.json({ email: 'owner@example.test', subject: 'verified-subject',
      onboardingComplete: true, hasFlightLoggerCredential: true, flightLoggerUserId: 'fl-owner',
      roles: ['ADMIN', 'STUDENT'], permissions: currentPermissions });
    if (path === '/api/admin/users') return Response.json({ users: [student] });
    if (path === '/api/admin/permissions') return Response.json(catalogue);
    return Response.json(access);
  });
  vi.stubGlobal('fetch', api);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function render() { await act(async () => root.render(<MemoryRouter initialEntries={['/admin/users']}><App /></MemoryRouter>)); }
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
  it('loads real user access, distinguishes inherited/explicit permissions, and refreshes on a successful save', async () => {
    await render(); await selectUser();
    expect(host.textContent).toContain('Inherited from role');
    await changePermission('ALLOW');
    const original = api.getMockImplementation()!;
    api.mockImplementation(async (path: string, init: RequestInit) => init.method === 'PUT'
      ? Response.json({ ...access, overrides: { 'availability.view': 'ALLOW' }, permissions: [...baseline, 'availability.view'], revision: 2 })
      : original(path, init));
    await save();
    expect(host.textContent).toContain('Access saved.');
    expect(host.textContent).toContain('Explicitly allowed');
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
    for (const key of ['admin.manage_users', 'admin.manage_permissions', 'duty_ops.manage_schedule', 'transport.manage_university_cars']) {
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
    expect(api.mock.calls.map(([path]) => path)).toEqual(['/api/me']);
  });
});
