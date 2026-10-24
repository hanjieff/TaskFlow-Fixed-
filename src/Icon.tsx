import type { CSSProperties } from 'react'

const paths = {
  grid: <>
    <rect x="3" y="3" width="7" height="7" rx="1.5" />
    <rect x="14" y="3" width="7" height="7" rx="1.5" />
    <rect x="3" y="14" width="7" height="7" rx="1.5" />
    <rect x="14" y="14" width="7" height="7" rx="1.5" />
  </>,
  tasks: <>
    <rect x="4" y="3" width="16" height="18" rx="3" />
    <path d="m8 9 1 1 2-2m-3 7 1 1 2-2m3-5h3m-3 6h3" />
  </>,
  folder: <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  page: <>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
    <path d="M14 3v6h6M8 13h8m-8 4h5" />
  </>,
  calendar: <>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 11h18m-13 5h2m4 0h2" />
  </>,
  search: <>
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="m16 16 5 5" />
  </>,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 5-7 7 7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  clock: <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>,
  star: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
  settings: <>
    <path d="m9 3-.6 3-2.5 1.4-2.9-1-3 5 2.3 2v2.8l-2.3 2 3 5 2.9-1L8.4 23l.6 3h6l.6-3 2.5-1.4 2.9 1 3-5-2.3-2v-2.8l2.3-2-3-5-2.9 1L15.6 6 15 3Z" transform="translate(2 0) scale(.83)" />
    <circle cx="12" cy="12" r="3" />
  </>,
  logout: <>
    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4m7-14 5 5-5 5m-9-5h14" />
  </>,
  sun: <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
  </>,
  moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />,
  more: <>
    <circle cx="5" cy="12" r="1" />
    <circle cx="12" cy="12" r="1" />
    <circle cx="19" cy="12" r="1" />
  </>,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  trash: <>
    <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
  </>,
  edit: <>
    <path d="m16 3 5 5L9 20l-6 1 1-6Zm-1 1 5 5" />
  </>,
  board: <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16m6-16v16M5.5 8h1m5 0h1m5 0h1m-13 4h1m5 0h1" />
  </>,
  table: <>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M3 14h18M9 4v16" />
  </>,
  filter: <path d="M3 5h18M6 12h12m-8 7h4" />,
  download: <>
    <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
  </>,
  lock: <>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2" />
  </>,
  leaf: <>
    <path d="M20 3C6 3 3 8 5 15s13 7 15-12ZM5 19 16 8" />
  </>,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  flag: <>
    <path d="M5 21V3m0 1c5-4 9 4 14 0v10c-5 4-9-4-14 0" />
  </>,
} as const
export type IconName = keyof typeof paths
export default function Icon({ name, size = 20, style, className = '' }: { name: IconName; size?: number; style?: CSSProperties; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>{paths[name]}</svg>
}
