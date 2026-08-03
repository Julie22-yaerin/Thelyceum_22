type LogoIconProps = {
  className?: string;
};

/**
 * Two gate posts either side of a hot-path line: the Dual-Gate mark.
 * Built from primitives, not a traced path — it's meant to redraw cleanly
 * at any size, from favicon to hero lockup.
 */
export default function LogoIcon({ className }: LogoIconProps) {
  return (
    <svg
      viewBox="0 0 256 256"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="20" y="20" width="56" height="216" rx="20" fill="currentColor" />
      <rect x="180" y="20" width="56" height="216" rx="20" fill="currentColor" />
      <rect x="96" y="118" width="64" height="20" rx="10" fill="currentColor" />
    </svg>
  );
}
