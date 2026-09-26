import { Link } from 'react-router';
import { Icon } from '../app/Icon';
import { osloDate } from '../dates';

const modules = [
  { path: '/duty-ops', label: 'Duty Ops', icon: 'duty', description: 'Your schedule, swaps and operational tools.', status: 'Planned' },
  { path: '/availability', label: 'Instructor Availability', icon: 'calendar', description: 'Find recorded instructor availability for today and future months.', status: 'Available' },
  { path: '/transport', label: 'Transport', icon: 'transport', description: 'University car bookings and shared rides.', status: 'Planned' },
] as const;

export function HomePage() {
  const today = osloDate(new Date());
  const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Oslo' }).format(new Date());
  return <section className="home-page">
    <div className="home-heading"><div><p className="eyebrow">Student operations</p><h1>Welcome to Studentportal</h1><p className="subtitle">Your starting point for training and daily operations.</p></div><time className="today-date" dateTime={today}>{dateLabel}</time></div>
    <div className="overview-panel"><div className="panel-heading"><h2>Today</h2><span className="status-dot">Overview</span></div><div className="overview-empty"><Icon name="duty" /><div><strong>No scheduled portal items to show yet.</strong><p>Upcoming duties and operational updates will appear here as the portal grows.</p></div></div></div>
    <div className="section-heading"><h2>Quick access</h2><span>Your operational tools</span></div>
    <div className="module-grid">{modules.map(module => <Link className="module-card" to={module.path} key={module.path}><div className="card-top"><span className="module-icon"><Icon name={module.icon} /></span><span className={`module-status ${module.status === 'Available' ? 'ready' : ''}`}>{module.status}</span></div><h3>{module.label}</h3><p>{module.description}</p><span className="card-action">Open {module.label === 'Instructor Availability' ? 'availability' : module.label} <span aria-hidden="true">→</span></span></Link>)}</div>
    <p className="home-note">Instructor Availability is the first operational module. More tools will be added here as they become ready.</p>
  </section>;
}
