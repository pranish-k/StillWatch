/** Inline SVG icons (16 px grid, stroke based). Decorative unless labeled. */

const PATHS = {
  terminal: 'M2.5 3.5h11v9h-11z M5 6.5l2 1.5-2 1.5 M8.5 10h2.5',
  file: 'M4 1.5h5l3 3v10H4z M9 1.5v3h3',
  edit: 'M10.5 2.5l3 3-7.5 7.5H3v-3z M9 4l3 3',
  search: 'M7 2.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9z M10.3 10.3l3.2 3.2',
  globe:
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M1.5 8h13 M8 1.5c-2 2.2-2 10.8 0 13 M8 1.5c2 2.2 2 10.8 0 13',
  agent: 'M4 5.5h8v7H4z M8 2.5v3 M6.5 8.5v1 M9.5 8.5v1 M2.5 8.5v2 M13.5 8.5v2',
  prompt: 'M2.5 3h11v7.5H7l-3 2.5v-2.5H2.5z',
  flag: 'M3.5 14V2.5 M3.5 3h8l-1.5 3 1.5 3h-8',
  alert: 'M8 2l6.5 11.5h-13z M8 6.5v3 M8 11.5v.5',
  lock: 'M4 7h8v6.5H4z M5.5 7V5a2.5 2.5 0 0 1 5 0v2',
  plug: 'M6 1.5v3 M10 1.5v3 M4 4.5h8v3a4 4 0 0 1-8 0z M8 11.5v3',
  gear: 'M8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z M8 1.5v2 M8 12.5v2 M1.5 8h2 M12.5 8h2 M3.4 3.4l1.4 1.4 M11.2 11.2l1.4 1.4 M3.4 12.6l1.4-1.4 M11.2 4.8l1.4-1.4',
  folder: 'M1.5 4h4.5l1.5 1.5h7v7.5h-13z',
  list: 'M5.5 4h8 M5.5 8h8 M5.5 12h8 M2.5 4h.5 M2.5 8h.5 M2.5 12h.5',
  compress: 'M5.5 1.5v4h-4 M10.5 1.5v4h4 M5.5 14.5v-4h-4 M10.5 14.5v-4h4',
  chip: 'M4.5 4.5h7v7h-7z M6.5 1.5v3 M9.5 1.5v3 M6.5 11.5v3 M9.5 11.5v3 M1.5 6.5h3 M1.5 9.5h3 M11.5 6.5h3 M11.5 9.5h3',
  bell: 'M4 11V7a4 4 0 0 1 8 0v4l1.5 1.5h-11z M6.5 14h3',
  question:
    'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.6.3-.8.7-.8 1.3 M8 11.5v.5',
  play: 'M4.5 2.5l9 5.5-9 5.5z',
  stop: 'M3.5 3.5h9v9h-9z',
  check: 'M3 8.5l3 3 7-7',
  x: 'M4 4l8 8 M12 4l-8 8',
  copy: 'M5.5 5.5h8v8h-8z M10.5 5.5v-3h-8v8h3',
  download: 'M8 2v8.5 M4.5 7l3.5 3.5L11.5 7 M2.5 13.5h11',
  refresh: 'M13 3v3.5H9.5 M12.7 6.5A5 5 0 1 0 13 9.5',
  trash: 'M2.5 4h11 M6 4V2.5h4V4 M4 4l.7 10h6.6L12 4',
  chevron: 'M6 3.5l4.5 4.5L6 12.5',
  sun: 'M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z M8 1v1.5 M8 13.5V15 M1 8h1.5 M13.5 8H15 M3 3l1 1 M12 12l1 1 M3 13l1-1 M12 4l1-1',
  moon: 'M13.5 10A6 6 0 0 1 6 2.5a6 6 0 1 0 7.5 7.5z',
  monitor: 'M1.5 2.5h13v9h-13z M5.5 14.5h5 M8 11.5v3',
  arrowLeft: 'M13 8H3 M7 4L3 8l4 4',
  link: 'M6.5 9.5l3-3 M7 4.5l1.5-1.5a2.5 2.5 0 0 1 3.5 3.5L10.5 8 M9 11.5L7.5 13A2.5 2.5 0 0 1 4 9.5L5.5 8',
  key: 'M5.5 7.5a3 3 0 1 0 0 .1z M8.5 8h6 M12.5 8v2.5 M10.5 8v2',
  layers: 'M8 2l6.5 3.5L8 9 1.5 5.5z M1.5 8.5L8 12l6.5-3.5 M1.5 11.5L8 15l6.5-3.5',
  clock: 'M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z M8 4.5V8l2.5 1.5',
  gap: 'M1.5 8h3 M6.5 8h3 M11.5 8h3',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 16,
  label,
  className,
}: {
  name: IconName;
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <svg
      className={className === undefined ? 'icon' : `icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={label === undefined ? undefined : 'img'}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
