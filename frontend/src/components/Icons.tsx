/* Inline stroke icons — one consistent set, 24-grid, 1.6 stroke. */
type P = { size?: number };
const base = (size = 18) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
});

export const IconPulse = ({ size }: P) => (
  <svg {...base(size)}><path d="M3 12h4l2 6 4-14 2 8h6" /></svg>
);
export const IconGrid = ({ size }: P) => (
  <svg {...base(size)}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
);
export const IconShield = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M9 12l2 2 4-4" /></svg>
);
export const IconUsers = ({ size }: P) => (
  <svg {...base(size)}><circle cx="9" cy="8" r="3" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M16 4.5a3 3 0 0 1 0 6M21 20c0-2.5-1.5-4.7-3.7-5.6" /></svg>
);
export const IconBolt = ({ size }: P) => (
  <svg {...base(size)}><path d="M13 3L5 13h6l-1 8 8-10h-6z" /></svg>
);
export const IconCheck = ({ size }: P) => (
  <svg {...base(size)}><path d="M20 6L9 17l-5-5" /></svg>
);
export const IconAlert = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 3l9 16H3z" /><path d="M12 10v4M12 17.5v.5" /></svg>
);
export const IconClock = ({ size }: P) => (
  <svg {...base(size)}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></svg>
);
export const IconStore = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 9l1.2-4.5h13.6L20 9M4 9h16M4 9v10h16V9M9 19v-5h6v5" /></svg>
);
export const IconClose = ({ size }: P) => (
  <svg {...base(size)}><path d="M6 6l12 12M18 6L6 18" /></svg>
);
export const IconExternal = ({ size }: P) => (
  <svg {...base(size)}><path d="M14 5h5v5M19 5l-8 8M11 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-5" /></svg>
);
export const IconPlus = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 5v14M5 12h14" /></svg>
);
export const IconUpload = ({ size }: P) => (
  <svg {...base(size)}><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></svg>
);
export const IconTrash = ({ size }: P) => (
  <svg {...base(size)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3" /></svg>
);
