export const navigation = [
  { path: '/', label: 'Home', icon: 'home' },
  { path: '/duty-ops', label: 'Duty Ops', icon: 'duty' },
  { path: '/availability', label: 'Availability', icon: 'calendar' },
  { path: '/transport', label: 'Transport', icon: 'transport' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
] as const;
export type NavIcon = typeof navigation[number]['icon'] | 'more';
