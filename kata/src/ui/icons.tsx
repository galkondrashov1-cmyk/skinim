import type { SVGProps } from 'react';

/** Kata icon set: 16px grid, 1.5px strokes, square caps — drawn to match the mark. */
const paths = {
  chart: <path d="M3.5 2v12M2 5h3v6H2zM8 3.5v9M6.5 6h3v4h-3zM12.5 2v10M11 4h3v5h-3z" />,
  markets: <path d="M2 4h12M2 8h12M2 12h8" />,
  list: <path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" />,
  journal: <path d="M3.5 2h7l2.5 2.5V14h-9.5zM6 6.5h4.5M6 9h4.5M6 11.5h2.5" />,
  performance: <path d="M2 13.5h12M2.5 11l3.5-4 3 2.5L13.5 4M10.5 4h3v3" />,
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  chevronDown: <path d="M4 6l4 4 4-4" />,
  chevronUp: <path d="M4 10l4-4 4 4" />,
  chevronRight: <path d="M6 4l4 4-4 4" />,
  chevronLeft: <path d="M10 4l-4 4 4 4" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2L14 14" />
    </>
  ),
  star: <path d="M8 2l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.4 4.3 13.5l.8-4.2L2 6.4l4.2-.5z" />,
  trash: <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />,
  edit: <path d="M10.5 2.5l3 3L6 13H3v-3zM9 4l3 3" />,
  lock: (
    <>
      <rect x="3" y="7" width="10" height="7" />
      <path d="M5 7V5a3 3 0 016 0v2" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </>
  ),
  download: <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5M2.5 13.5h11" />,
  upload: <path d="M8 10V2M4.5 5.5L8 2l3.5 3.5M2.5 13.5h11" />,
  external: <path d="M9 2.5h4.5V7M13.5 2.5L7 9M11.5 9.5v4h-9v-9h4" />,
  target: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  shield: <path d="M8 1.5l5.5 2v4c0 3.2-2.3 5.6-5.5 7-3.2-1.4-5.5-3.8-5.5-7v-4z" />,
  trail: <path d="M2 12l4-4 3 2 5-6M11 4h3v3M2 14.5h12" />,
  layers: <path d="M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3" />,
  eye: (
    <>
      <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" />
      <circle cx="8" cy="8" r="2" />
    </>
  ),
  more: <path d="M3.5 8h.01M8 8h.01M12.5 8h.01" />,
  info: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M8 7.25v4M8 4.75h.01" />
    </>
  ),
  warning: <path d="M8 2L14.5 13.5h-13zM8 6.5v3.5M8 12h.01" />,
  refresh: <path d="M13 4.5V2M13 4.5h-2.5M13 4.5A5.5 5.5 0 102.6 7M3 11.5V14M3 11.5h2.5M3 11.5A5.5 5.5 0 0013.4 9" />,
  account: (
    <>
      <circle cx="8" cy="5.5" r="2.75" />
      <path d="M2.5 14c.6-2.8 2.8-4.25 5.5-4.25S12.9 11.2 13.5 14" />
    </>
  ),
  crosshair: <path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4" />,
  signal: <path d="M3 13v-2M6.33 13V9M9.66 13V6M13 13V3" />,
  offline: <path d="M3 13v-2M6.33 13V9M9.66 13V6M13 13V3M2 2l12 12" />,
  sim: <path d="M2 11l3-5 3 3 3-6 3 4M2 14h2M6 14h2M10 14h2M14 14h.01" />,
  flask: <path d="M6 2h4M6.5 2v4L3 13h10L9.5 6V2M4.6 10h6.8" />,
  arrowUp: <path d="M8 13V3M4 7l4-4 4 4" />,
  arrowDown: <path d="M8 3v10M4 9l4 4 4-4" />,
  install: <path d="M8 2v7.5M5 6.5l3 3 3-3M3 10.5V13.5h10V10.5" />,
  tag: <path d="M2 2h6l6 6-6 6-6-6zM5.5 5.5h.01" />,
  back: <path d="M13 8H3M7 4L3 8l4 4" />,
  fit: <path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" />,
  bell: <path d="M4 11V7a4 4 0 018 0v4l1.5 1.5h-11zM6.5 14h3" />,
  logout: <path d="M6 2.5H2.5v11H6M10.5 5l3 3-3 3M13.5 8H6" />,
  keyboard: (
    <>
      <rect x="1.5" y="4" width="13" height="8" />
      <path d="M4 7h.01M6.5 7h.01M9 7h.01M11.5 7h.01M5 9.5h6" />
    </>
  ),
} as const;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 16, ...rest }: { name: IconName; size?: number } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
