import type { NavIcon } from './navigation';

const paths: Record<NavIcon, string> = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  duty: 'M8 5H5v16h14V5h-3M9 3h6v4H9zM8 12h8M8 16h5',
  calendar: 'M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M9 14h2M13 14h2M9 17h2',
  transport: 'M4 15V9l2-5h12l2 5v6M4 9h16M4 15h16M6 15v4M18 15v4M7 12h2M15 12h2',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  more: 'M5 11h2v2H5zM11 11h2v2h-2zM17 11h2v2h-2z',
};

export function Icon({ name }: { name: NavIcon }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
