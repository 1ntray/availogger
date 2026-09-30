import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { navigation, visibleNavigation } from './navigation';
import { Icon } from './Icon';
import { Avatar } from './ui';
import { useCurrentUser } from './CurrentUser';
import { usePermissions } from './permissions';
import { displayName } from '../../../shared/display-name';
import { PERMISSIONS } from '../../../shared/authorization';
import { contactApi } from '../features/contact/api';

export function AppShell() {
  const { user, loading, error, retry } = useCurrentUser();
  const { hasPermission } = usePermissions();
  const visible = visibleNavigation(hasPermission);
  const canAdmin = [PERMISSIONS.adminManageUsers, PERMISSIONS.availabilityView, PERMISSIONS.dutyOpsManageSchedule,
    PERMISSIONS.adminExchangeAudit, PERMISSIONS.contactWebmasterManage].some(hasPermission);
  const { pathname } = useLocation();
  const [accountOpen, setAccountOpen] = useState(false);
  const [unreadCount,setUnreadCount]=useState(0);
  const content = useRef<HTMLElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if(!user)return;
    let active=true;
    const refresh=()=>{void contactApi.inbox().then(data=>{if(active)setUnreadCount(data.unreadCount);}).catch(()=>{});};
    refresh();
    const timer=window.setInterval(()=>{if(document.visibilityState==='visible')refresh();},60000);
    window.addEventListener('portal-inbox-changed',refresh);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('portal-inbox-changed',refresh);};
  },[user?.subject]);
  useEffect(() => {
    setAccountOpen(false);
    window.scrollTo?.(0, 0);
    content.current?.focus({ preventScroll: true });
    document.title = `${navigation.find(item => item.path === pathname)?.label ||
      (pathname.startsWith('/duty-ops/shifts/') ? 'Duty Ops shift' : pathname.endsWith('/exchanges') ? 'Exchanges' :
        pathname.startsWith('/admin') ? 'Administration' : pathname.startsWith('/activity') ? 'My activity' :
          pathname.startsWith('/messages') ? 'Messages' : pathname === '/inbox' ? 'Inbox' :
            pathname === '/feedback' ? 'Send feedback' : 'Studentportal')} · Luftfartsfag Studentportal`;
  }, [pathname]);
  useEffect(() => {
    if (!accountOpen) return;
    accountPanel.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const outside = (event: PointerEvent) => {
      if (!accountPanel.current?.contains(event.target as Node) && !accountButton.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setAccountOpen(false); accountButton.current?.focus(); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [accountOpen]);
  return <div className="portal-shell">
    <a className="skip-link" href="#portal-content">Skip to content</a>
    <header className="portal-header">
      <Link className="brand" to="/" aria-label="Luftfartsfag Studentportal home"><span className="brand-mark">LF</span><div><strong>Luftfartsfag</strong><span>Studentportal</span></div></Link>
      <div className="header-actions"><Link className="header-inbox" to="/inbox" aria-label={`Inbox${unreadCount?`, ${unreadCount} unread`:''}`} title="Inbox"><Icon name="bell"/>{unreadCount>0&&<span className="header-inbox-count">{unreadCount>99?'99+':unreadCount}</span>}</Link><div className="account-control">
        <button ref={accountButton} type="button" className="current-user" aria-expanded={accountOpen} aria-controls="account-menu" onClick={() => setAccountOpen(value => !value)}
          aria-label={user ? `Account menu, ${displayName(user)}` : 'Account menu'}>
          <Avatar user={user} size={34} /><Icon name="account" /><span className="account-identity"><strong>{user ? displayName(user) : loading ? 'Loading account…' : 'Account unavailable'}</strong></span><span aria-hidden="true">⌄</span>
        </button>
        {accountOpen && <div className="account-menu" id="account-menu" ref={accountPanel}>
          {user?.email && <p className="account-menu-email">{user.email}</p>}
          <NavLink to="/activity">My activity</NavLink>
          <NavLink to="/inbox">Inbox{unreadCount>0?` (${unreadCount})`:''}</NavLink>
          <NavLink to="/messages">Messages</NavLink>
          <NavLink to="/feedback" state={{from:pathname}}>Send feedback</NavLink>
          <NavLink to="/settings">Settings</NavLink>
          {canAdmin && <NavLink to="/admin">Administration</NavLink>}
        </div>}
      </div></div>
    </header>
    <aside className="sidebar"><nav aria-label="Main navigation">{visible.map(item =>
      <NavLink key={item.path} to={item.path} end={item.path === '/'}><Icon name={item.icon} /><span>{item.label}</span></NavLink>
    )}</nav></aside>
    <main className="portal-content" id="portal-content" ref={content} tabIndex={-1}>
      {error && <div className="account-error" role="alert"><span>{error}</span><button onClick={retry}>Retry account</button></div>}
      <Outlet />
    </main>
    <nav className="bottom-nav" aria-label="Mobile navigation" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>{visible.map(item => <NavLink key={item.path} to={item.path} end={item.path === '/'}><Icon name={item.icon} /><span>{item.label}</span></NavLink>)}</nav>
  </div>;
}
