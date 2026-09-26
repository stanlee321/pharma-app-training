/**
 * Minimal inline-SVG icon set standing in for the SF Symbols the iOS screens use.
 * Decorative by default (aria-hidden); pass `title` to make one meaningful.
 */
const PATHS = {
  // cross.case.fill — medical case
  crossCase:
    'M9 3h6a2 2 0 0 1 2 2v1h2.5A2.5 2.5 0 0 1 22 8.5v10a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 18.5v-10A2.5 2.5 0 0 1 4.5 6H7V5a2 2 0 0 1 2-2Zm0 2v1h6V5H9Zm2 5v2.5H8.5v3H11V18h2v-2.5h2.5v-3H13V10h-2Z',
  tray: 'M4 4h16l2 9v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-6l2-9Zm1.6 2-1.5 7H8.5a3.5 3.5 0 0 0 7 0h4.4l-1.5-7H5.6ZM4 15v3h16v-3h-3.2a5.5 5.5 0 0 1-9.6 0H4Z',
  plus: 'M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4Z',
  minus: 'M4 11h16v2H4v-2Z',
  chevronLeft: 'M15.7 4.3 17.1 5.7 10.8 12l6.3 6.3-1.4 1.4L8 12l7.7-7.7Z',
  chevronRight: 'M8.3 4.3 16 12l-7.7 7.7-1.4-1.4 6.3-6.3-6.3-6.3 1.4-1.4Z',
  checkCircle:
    'M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20Zm4.3 6.3L10.5 14l-2.8-2.8-1.4 1.4 4.2 4.2 7.2-7.1-1.4-1.4Z',
  check: 'M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z',
  trash:
    'M9 3h6l1 2h4v2H4V5h4l1-2Zm-3 6h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Zm4 2v8h1.5v-8H10Zm2.5 0v8H14v-8h-1.5Z',
  warning: 'M12 2 1 21h22L12 2Zm-1 7h2v6h-2V9Zm0 8h2v2h-2v-2Z',
  person:
    'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5Zm2 0v14h14V5H5Zm4 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm-3 8c0-1.7 1.3-3 3-3s3 1.3 3 3v1H6v-1Zm8-7h4v1.5h-4V9Zm0 3h4v1.5h-4V12Z',
  clipboard:
    'M9 2h6a1 1 0 0 1 1 1v1h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V3a1 1 0 0 1 1-1Zm1 2v2h4V4h-4ZM6 6v14h12V6h-2v2H8V6H6Zm2 5h8v1.5H8V11Zm0 3h8v1.5H8V14Zm0 3h5v1.5H8V17Z',
  waveform: 'M2 11h4l2-5 4 12 3-9 2 2h5v2h-6l-.8-.8L12 21 8 9l-.7 1.7-.3.3H2v-2Z',
  chart: 'M3 3h2v16h16v2H3V3Zm4 12 4-5 3 3 5-7 1.6 1.2L14.3 16l-3-3L8.6 16.2 7 15Z',
  pills:
    'M8.5 3A5.5 5.5 0 0 1 14 8.5v7a5.5 5.5 0 0 1-11 0v-7A5.5 5.5 0 0 1 8.5 3Zm0 2A3.5 3.5 0 0 0 5 8.5V11h7V8.5A3.5 3.5 0 0 0 8.5 5ZM18 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-2.4 2.4 4.9 3.3a2 2 0 0 0-4.9-3.3Z',
  drop: 'M12 2s7 7.6 7 12.5A7 7 0 0 1 5 14.5C5 9.6 12 2 12 2Zm0 3.1C9.9 7.6 7 11.6 7 14.5a5 5 0 0 0 10 0c0-2.9-2.9-6.9-5-9.4Z',
  bed: 'M2 5h2v8h7V8h7a4 4 0 0 1 4 4v7h-2v-2H4v2H2V5Zm11 5v3h7v-1a2 2 0 0 0-2-2h-5ZM7.5 8a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z',
  family:
    'M7 3a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Zm10 0a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5ZM4 10h6v6H8.5v5h-3v-5H4v-6Zm10 0h6v6h-1.5v5h-3v-5H14v-6Zm-2 4a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z',
  doc: 'M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm0 2v16h12V9h-5V4H6Zm2 8h8v1.5H8V12Zm0 3h8v1.5H8V15Zm0 3h5v1.5H8V18Z',
  // lock.fill — read-only / derived
  lock: 'M12 2a5 5 0 0 1 5 5v3h1a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h1V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v3h6V7a3 3 0 0 0-3-3Z',
  // syringe — bolus
  syringe:
    'M17.3 1.3 22.7 6.7 21.3 8.1 19.9 6.7 18.5 8.1 20.6 10.2 19.2 11.6 18.5 10.9 10 19.4 6.8 19.4 3.4 22.8 1.2 20.6 4.6 17.2V14l8.5-8.5-.7-.7 1.4-1.4 2.1 2.1 1.4-1.4-1.4-1.4 1.4-1.4ZM14.5 6.9 6.6 14.8V17.4h2.6l7.9-7.9-2.6-2.6Z',
  // sparkles — recommendation
  sparkles:
    'M10 2l1.8 5.2L17 9l-5.2 1.8L10 16l-1.8-5.2L3 9l5.2-1.8L10 2Zm8 10 .9 2.1L21 15l-2.1.9L18 18l-.9-2.1L15 15l2.1-.9L18 12Zm-3 6 .6 1.4L17 20l-1.4.6L15 22l-.6-1.4L13 20l1.4-.6L15 18Z',
  // square.and.arrow.down — download
  download: 'M11 3h2v9.2l3.3-3.3 1.4 1.4L12 16l-5.7-5.7 1.4-1.4 3.3 3.3V3ZM4 15h2v4h12v-4h2v6H4v-6Z',
  hammer: 'M13 3h5l3 3-2 2-2-2h-1l-8.3 8.3-2.8-2.8L13 3Zm-7.7 12.1 2.8 2.8-3 3L2.3 18l3-2.9Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 22,
  title,
  className,
}: {
  name: IconName;
  size?: number;
  title?: string;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}
      <path fillRule="evenodd" d={PATHS[name]} />
    </svg>
  );
}
