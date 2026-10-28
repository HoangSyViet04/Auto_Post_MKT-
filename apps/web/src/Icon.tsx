export type IconName = 'phone' | 'accounts' | 'groups' | 'send' | 'profile' | 'history' | 'sales' | 'search' | 'clock' | 'check' | 'star' | 'refresh' | 'sliders' | 'chevron' | 'menu' | 'image' | 'save' | 'edit';
const paths: Record<IconName, string> = {
  phone: 'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm2 3h4m-3 14h2',
  accounts: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.87a4 4 0 0 1 0 7.75',
  groups: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.87a4 4 0 0 1 0 7.75',
  send: 'm22 2-7 20-4-9-9-4 20-7Zm0 0L11 13',
  profile: 'M20 21v-2a6 6 0 0 0-6-6h-4a6 6 0 0 0-6 6v2m8-12a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  history: 'M3 12a9 9 0 1 0 2.7-6.4L3 8m0-5v5h5m4-1v5l3 2',
  sales: 'M3 3h2l3 12h10l3-9H6m4 15h.01M18 21h.01',
  search: 'm21 21-5-5m-5 2a7 7 0 1 0 0-14 7 7 0 0 0 0 14',
  clock: 'M12 8v4l3 2m6-2a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  check: 'm5 12 4 4L19 6',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z',
  refresh: 'M20 7v5h-5m-11 5v-5h5m10-4a8 8 0 0 0-13-3L4 8m16 8-2 3A8 8 0 0 1 5 16',
  sliders: 'M4 7h8m4 0h4M4 17h2m4 0h10M12 4v6M6 14v6',
  chevron: 'm9 5 7 7-7 7',
  menu: 'M4 6h16M4 12h16M4 18h16',
  image: 'M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm-1 14 5-5 4 4 4-6 5 7M8 8h.01',
  save: 'M4 3h13l4 4v14H3V3h1Zm3 0v6h10V3M7 21v-8h10v8',
  edit: 'm16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5',
};

export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`icon ${className}`} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
