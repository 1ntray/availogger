import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { navigation, visibleNavigation } from './navigation';
import { Icon } from './Icon';
import { useCurrentUser } from './CurrentUser';
import { usePermissions } from './permissions';

export function AppShell() {
  const { user, loading, error, retry } = useCurrentUser();
  const { hasPermission } = usePermissions();
  const visible = visibleNavigation(hasPermission);
  const mobile = visible.filter(item => navigation.slice(0, 3).some(first => first.path === item.path));
  const more = visible.filter(item => !mobile.includes(item));
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountControl = useRef<HTMLDivElement>(null);
  const accountButton = useRef<HTMLButtonElement>(null);
  const accountPanel = useRef<HTMLElement>(null);
  const content = useRef<HTMLElement>(null);
  const moreButton = useRef<HTMLButtonElement>(null);
  const morePanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setMoreOpen(false);
    setAccountOpen(false);
    window.scrollTo?.(0, 0);
    content.current?.focus({ preventScroll: true });
    document.title = `${navigation.find(item => item.path === pathname)?.label || 'Studentportal'} · Luftfartsfag Studentportal`;
  }, [pathname]);
  useEffect(() => {
    if (moreOpen) morePanel.current?.querySelector<HTMLAnchorElement>('a')?.focus();
  }, [moreOpen]);
  useEffect(() => {
    if (!accountOpen) return;
    accountPanel.current?.querySelector<HTMLAnchorElement>('a')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountControl.current?.contains(event.target)) setAccountOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setAccountOpen(false);
        accountButton.current?.focus();
      }
    };
    document.addEventListener('pointerdown', dismiss);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      document.removeEventListener('keydown', escape);
    };
  }, [accountOpen]);
  const closeMore = () => { setMoreOpen(false); moreButton.current?.focus(); };
  return <div className="portal-shell">
    <a className="skip-link" href="#portal-content">Skip to content</a>
    <header className="portal-header">
      <Link className="brand" to="/" aria-label="Luftfartsfag Studentportal home"><span className="brand-mark">LF</span><div><strong>Luftfartsfag</strong><span>Studentportal</span></div></Link>
      <div className="account-control" ref={accountControl} onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false);
      }}>
        <button className={`current-user ${pathname === '/settings' ? 'active' : ''}`} ref={accountButton} title={user?.email} aria-label={`Account: ${user?.email || 'Studentportal'}`} aria-expanded={accountOpen} aria-controls="account-navigation" onClick={() => { setMoreOpen(false); setAccountOpen(value => !value); }}>
          <Icon name="account" /><span className="account-identity">{user?.email || (loading ? 'Loading account…' : 'Account unavailable')}</span><span className="account-chevron" aria-hidden="true">⌄</span>
        </button>
        {accountOpen && <nav className="account-panel" id="account-navigation" aria-label="Account navigation" ref={accountPanel}>
          <NavLink to="/settings"><Icon name="settings" /><span>Settings</span></NavLink>
        </nav>}
      </div>
    </header>
    <aside className="sidebar"><nav aria-label="Main navigation">{visible.filter(item => item.path !== '/settings').map(item =>
      <NavLink key={item.path} to={item.path} end={item.path === '/'}><Icon name={item.icon} /><span>{item.label}</span></NavLink>
    )}</nav></aside>
    <main className="portal-content" id="portal-content" ref={content} tabIndex={-1}>
      {error && <div className="account-error" role="alert"><span>{error}</span><button onClick={retry}>Retry account</button></div>}
      <Outlet />
    </main>
    {moreOpen && <><button className="more-backdrop" aria-label="Close more navigation" onClick={closeMore} /><div className="more-panel" id="more-navigation" ref={morePanel} onKeyDown={event => { if (event.key === 'Escape') closeMore(); }}><div className="more-heading"><strong>More</strong><button onClick={closeMore} aria-label="Close more navigation">×</button></div><nav aria-label="More navigation">{more.map(item => <NavLink key={item.path} to={item.path}><Icon name={item.icon} />{item.label}</NavLink>)}</nav></div></>}
    <nav className="bottom-nav" aria-label="Mobile navigation" style={{ gridTemplateColumns: `repeat(${mobile.length + 1}, minmax(0, 1fr))` }}>{mobile.map(item => <NavLink key={item.path} to={item.path} end={item.path === '/'}><Icon name={item.icon} /><span>{item.label}</span></NavLink>)}<button ref={moreButton} className={moreOpen || more.some(item => item.path === pathname) ? 'active' : ''} onClick={() => setMoreOpen(value => !value)} aria-expanded={moreOpen} aria-controls="more-navigation"><Icon name="more" /><span>More</span></button></nav>
  </div>;
}
