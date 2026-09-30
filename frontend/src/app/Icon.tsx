import type { NavIcon } from './navigation';

type IconName = NavIcon | 'account' | 'arrow-right' | 'reload' | 'bell';

const paths: Record<IconName, string> = {
  home: 'M3 10 12 3l9 7M5 9v12h5v-7h4v7h5V9',
  duty: 'M8 5H5v16h14V5h-3M9 3h6v4H9zM8 12h8M8 16h5',
  flights: 'M2 13l8-2 4-8 2 1-2 8 7 2v2l-8-1-5 5-2-1 3-6-7 2z',
  wash: 'M12 3c-2 3-7 8-7 12a7 7 0 0 0 14 0c0-4-5-9-7-12zM9 15a3 3 0 0 0 3 3',
  calendar: 'M5 5h14v16H5zM8 3v4M16 3v4M5 10h14M9 14h2M13 14h2M9 17h2',
  settings: 'M9.5 2h5l.5 3 1.5.9 2.9-1 2.5 4.3-2.4 2V13l2.4 2-2.5 4.3-2.9-1-1.5.9-.5 3h-5l-.5-3-1.5-.9-2.9 1-2.5-4.3 2.4-2v-1.8l-2.4-2 2.5-4.3 2.9 1L9 5z M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  account: 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0M4 21v-2a8 8 0 0 1 16 0v2',
  'arrow-right': 'M5 12h14M14 7l5 5-5 5',
  reload: 'M20 7v5h-5M20 12a8 8 0 1 0-2 5M20 7l-2-2',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 8-3 9h18c0-1-3-2-3-9M10 21h4',
};

export function Icon({ name }: { name: IconName }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
