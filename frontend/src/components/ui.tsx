/* Small shared presentational primitives. */
import { IconCheck } from './Icons';

/** Status pill for script status (ACTIVE / FAILING / DISABLED). */
export function StatusBadge({ status }: { status: string | null }) {
  const s = (status ?? 'UNKNOWN').toUpperCase();
  const cls = s === 'ACTIVE' ? 'ok' : s === 'FAILING' ? 'failing' : 'disabled';
  const label = s === 'ACTIVE' ? 'Healthy' : s === 'FAILING' ? 'Failing' : s === 'DISABLED' ? 'Disabled' : s;
  return (
    <span className={`pill ${cls}`}><span className="pdot" />{label}</span>
  );
}

/** Inline success-rate bar used in tables. */
export function RateBar({ value }: { value: number }) {
  const color = value >= 90 ? 'var(--ok)' : value >= 60 ? 'var(--warn)' : 'var(--bad)';
  return (
    <div className="rate">
      <div className="rate-track"><div className="rate-fill" style={{ width: `${value}%`, background: color }} /></div>
      <span className="rate-val" style={{ color }}>{value}%</span>
    </div>
  );
}

/** Deterministic avatar from a name/email. */
const AV_COLORS = ['#5B57E6', '#0FA968', '#C77700', '#E5484D', '#0E7C86', '#8A87F0'];
export function Avatar({ seed, label }: { seed: string; label: string }) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const bg = AV_COLORS[h % AV_COLORS.length];
  const initials = label.split(/[\s.@]+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  return <div className="avatar" style={{ background: bg }}>{initials || '·'}</div>;
}

export function EmptyState({ title, message, icon }: { title: string; message: string; icon?: React.ReactNode }) {
  return (
    <div className="card empty">
      <div className="empty-icon">{icon ?? <IconCheck size={22} />}</div>
      <h3>{title}</h3>
      <p>{message}</p>
    </div>
  );
}

export function KpiSkeleton() {
  return (
    <div className="card kpi">
      <div className="skel" style={{ width: 80, height: 11 }} />
      <div className="skel" style={{ width: 110, height: 34, marginTop: 16 }} />
      <div className="skel" style={{ width: 90, height: 12, marginTop: 12 }} />
    </div>
  );
}
