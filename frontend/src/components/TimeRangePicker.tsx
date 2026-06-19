export type RangeKey = '10m' | '1h' | '6h' | '1d' | '7d' | '30d' | '90d' | 'custom';
export type Range = { from: Date; to: Date };

export const PRESETS: { key: RangeKey; label: string; ms: number }[] = [
  { key: '10m', label: '10m', ms: 10 * 60_000 },
  { key: '1h',  label: '1h',  ms: 60 * 60_000 },
  { key: '6h',  label: '6h',  ms: 6 * 3600_000 },
  { key: '1d',  label: '24h', ms: 86400_000 },
  { key: '7d',  label: '7d',  ms: 7 * 86400_000 },
  { key: '30d', label: '30d', ms: 30 * 86400_000 },
  { key: '90d', label: '90d', ms: 90 * 86400_000 },
];

export function presetToRange(key: RangeKey): Range {
  const preset = PRESETS.find((p) => p.key === key);
  const now = new Date();
  return { from: new Date(now.getTime() - (preset?.ms ?? 86400_000)), to: now };
}

export function rangeLabel(key: RangeKey, from: Date, to: Date): string {
  if (key === 'custom') {
    const f = (d: Date) => d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    return `${f(from)} — ${f(to)}`;
  }
  const map: Record<string, string> = {
    '10m': 'Last 10 minutes', '1h': 'Last hour', '6h': 'Last 6 hours', '1d': 'Last 24 hours',
    '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days',
  };
  return map[key] ?? '';
}

type Props = {
  selected: RangeKey;
  customFrom?: string;
  customTo?: string;
  onChange: (key: RangeKey) => void;
  onCustomChange?: (from: string, to: string) => void;
};

export default function TimeRangePicker({ selected, customFrom, customTo, onChange, onCustomChange }: Props) {
  return (
    <div className="range">
      {PRESETS.map((p) => (
        <button key={p.key} className={`range-btn${selected === p.key ? ' active' : ''}`} onClick={() => onChange(p.key)}>
          {p.label}
        </button>
      ))}
      <button className={`range-btn${selected === 'custom' ? ' active' : ''}`} onClick={() => onChange('custom')}>
        Custom
      </button>

      {selected === 'custom' && onCustomChange && (
        <div className="range-custom">
          <input type="datetime-local" value={customFrom ?? ''} onChange={(e) => onCustomChange(e.target.value, customTo ?? '')} />
          <span style={{ color: 'var(--faint)' }}>→</span>
          <input type="datetime-local" value={customTo ?? ''} onChange={(e) => onCustomChange(customFrom ?? '', e.target.value)} />
        </div>
      )}
    </div>
  );
}
