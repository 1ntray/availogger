import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useCurrentUser } from '../app/CurrentUser';
import { usePermissions } from '../app/permissions';
import { loadAccessCatalogue, loadPortalUsers, loadUserAccess, saveUserAccess,
  type AccessCatalogue, type PortalUser } from '../features/authorization/admin-api';
import { PERMISSIONS, type PermissionOverrides, type RoleKey, type UserAccess } from '../../../shared/authorization';
import { displayName } from '../../../shared/display-name';
import '../features/authorization/admin.css';

const groups = [
  { title: 'Flights', prefix: ['flights.', 'fuel.'] },
  { title: 'Duty Ops', prefix: ['duty_ops.'] },
  { title: 'Flyvask', prefix: ['flyvask.'] },
  { title: 'Brakkevakt', prefix: ['brakkevakt.'] },
  { title: 'Administration', prefix: ['availability.', 'admin.'] },
];

export function AdminUsersPage() {
  const { refresh } = useCurrentUser();
  const { hasPermission } = usePermissions();
  const canManagePermissions = hasPermission(PERMISSIONS.adminManagePermissions);
  const [users, setUsers] = useState<PortalUser[]>([]);
  const [catalogue, setCatalogue] = useState<AccessCatalogue | null>(null);
  const [selected, setSelected] = useState('');
  const [access, setAccess] = useState<UserAccess | null>(null);
  const [roles, setRoles] = useState<RoleKey[]>([]);
  const [overrides, setOverrides] = useState<PermissionOverrides>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);
  const pendingSave = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError('');
    void Promise.all([loadPortalUsers(controller.signal), loadAccessCatalogue(controller.signal)])
      .then(([list, definitions]) => { if (!controller.signal.aborted) { setUsers(list.users); setCatalogue(definitions); } })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load users.'); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);
  useEffect(() => {
    const controller = new AbortController();
    setAccess(null); setStatus(''); setError('');
    if (selected) void loadUserAccess(selected, controller.signal).then(result => {
      if (!controller.signal.aborted) { setAccess(result); setRoles(result.roles); setOverrides(result.overrides); }
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not load access.'); });
    return () => controller.abort();
  }, [selected, reload]);
  useEffect(() => () => pendingSave.current?.abort(), []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!access || pendingSave.current) return;
    const controller = new AbortController();
    pendingSave.current = controller; setSaving(true); setStatus(''); setError('');
    try {
      const result = await saveUserAccess(access.user.id, { roles, overrides, revision: access.revision }, controller.signal);
      if (controller.signal.aborted) return;
      setAccess(result); setRoles(result.roles); setOverrides(result.overrides);
      setUsers(list => list.map(user => user.id === result.user.id ? { ...result.user, roles: result.roles, permissions: result.permissions } : user));
      setStatus('Access saved.');
      // Refresh permissions without unmounting the editor; self-demotion takes effect immediately.
      await refresh(true).catch(() => { setError('Access was saved, but your account could not be refreshed. Reload the page.'); });
    } catch (cause) {
      if (!controller.signal.aborted) {
        setRoles(access.roles); setOverrides(access.overrides);
        setError(cause instanceof Error ? cause.message : 'Could not save access.');
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false);
      pendingSave.current = null;
    }
  }
  return <section className="admin-users"><h1>Manage users</h1>
    {error && <p className="message error" role="alert">{error} <button type="button" disabled={saving} onClick={() => setReload(value => value + 1)}>Reload access</button></p>}
    {status && <p role="status">{status}</p>}
    {loading ? <p role="status">Loading portal users…</p> : catalogue && <div className="admin-columns">
      <section className="admin-user-list" aria-label="Portal users">
        <label htmlFor="user-search">Find user</label><input id="user-search" type="search" value={search} onChange={event => setSearch(event.target.value)} />
        <ul>{users.filter(user => `${displayName(user, user.email)} ${user.email}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim())).map(user => <li key={user.id}>
          <button type="button" aria-pressed={selected === user.id} disabled={saving} onClick={() => setSelected(user.id)}>
            <strong>{displayName(user, user.email)}</strong><span>{user.firstName || user.lastName ? <>{user.email}<br /></> : null}{user.roles.join(', ') || 'No role'} · {user.permissions.length} permissions</span>
          </button></li>)}</ul>
        {!users.length && <p>No portal users yet.</p>}
      </section>
      <section className="admin-editor" aria-label="User access">{!selected ? <p>Select a user to manage access.</p> : !access ? <p role="status">Loading access…</p> : <form onSubmit={save}>
        <h2>{displayName(access.user, access.user.email)}</h2><p className="small-note">{access.user.email}</p>
        <fieldset disabled={saving}><legend>Roles</legend>{catalogue.roles.map(role => <label className="admin-role" key={role.key}>
          <input type="checkbox" checked={roles.includes(role.key)} disabled={role.key === 'ADMIN' && !canManagePermissions}
            onChange={event => setRoles(value => event.target.checked ? [...value, role.key] : value.filter(key => key !== role.key))} />{role.name}
        </label>)}</fieldset>
        <fieldset disabled={saving}><legend>Feature access and capabilities</legend>
          {groups.map(group => <section className="admin-permission-group" key={group.title}><h3>{group.title}</h3>{catalogue.permissions.filter(permission => group.prefix.some(prefix => permission.key.startsWith(prefix))).map(permission => {
            const inherited = catalogue.roles.some(role => roles.includes(role.key) && role.permissions.includes(permission.key));
            const override = overrides[permission.key];
            const effective = override === 'ALLOW' || (override !== 'DENY' && inherited);
            const changed = roles.join(',') !== access.roles.join(',') || override !== access.overrides[permission.key];
            return <div className="admin-permission" key={permission.key}>
              <div><label htmlFor={`permission-${permission.key}`}>{permission.description}</label>
                <span className={`admin-effective ${effective ? 'is-allowed' : 'is-denied'}`}>{effective ? 'Allowed' : 'Denied'}</span>
                {changed && <small>Unsaved change</small>}</div>
              <select id={`permission-${permission.key}`} value={override || 'INHERIT'} disabled={permission.privileged && !canManagePermissions}
                onChange={event => setOverrides(value => {
                  const next = { ...value };
                  if (event.target.value === 'INHERIT') delete next[permission.key];
                  else next[permission.key] = event.target.value as 'ALLOW' | 'DENY';
                  return next;
                })}><option value="INHERIT">Role default</option><option value="ALLOW">Allow</option><option value="DENY">Deny</option></select>
            </div>;
          })}</section>)}
        </fieldset>
        {!canManagePermissions && <p className="small-note">Administrative and management capabilities require permission to manage permissions.</p>}
        <button className="primary-button" disabled={saving} type="submit">{saving ? 'Saving…' : 'Save access'}</button>
      </form>}</section>
    </div>}
  </section>;
}
