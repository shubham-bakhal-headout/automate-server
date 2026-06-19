import { useSummary } from '../hooks/useAnalytics';
import { useTimeRange } from '../hooks/useTimeRange';
import TimeRangePicker, { rangeLabel } from '../components/TimeRangePicker';
import { KpiSkeleton } from '../components/ui';
import { IconCheck, IconAlert, IconUsers, IconClock, IconStore, IconBolt } from '../components/Icons';

const fmt = (n: number) => n.toLocaleString('en-IN');
const fmtDur = (ms: number | null) => (ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}` : `${ms}`);
const durUnit = (ms: number | null) => (ms == null ? '' : ms >= 1000 ? 's' : 'ms');

export default function Overview() {
  const { rangeKey, setRangeKey, customFrom, customTo, setCustom, from, to } = useTimeRange('7d');
  const { data, isLoading } = useSummary(from, to);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 22 }}>
        <div>
          <div className="eyebrow">Autofill activity</div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>{rangeLabel(rangeKey, from, to)}</div>
        </div>
        <TimeRangePicker selected={rangeKey} customFrom={customFrom} customTo={customTo} onChange={setRangeKey} onCustomChange={setCustom} />
      </div>

      {isLoading || !data ? (
        <>
          <div className="skel" style={{ height: 116, borderRadius: 18, marginBottom: 24 }} />
          <div className="grid cols-auto">{[0, 1, 2, 3].map((i) => <KpiSkeleton key={i} />)}</div>
        </>
      ) : (
        <>
          <HealthHero failing={data.failingScripts} successRate={data.successRate} hasData={data.totalFills > 0} />

          <div className="grid cols-auto" style={{ marginTop: 24 }}>
            <Kpi label="Forms filled" icon={<IconBolt size={13} />} value={fmt(data.totalFills)} accent="var(--accent)"
                 sub={`${fmt(data.successFills)} clean · ${fmt(data.partialFills)} partial · ${fmt(data.failureFills)} failed`} />
            <Kpi label="Active agents" icon={<IconUsers size={13} />} value={fmt(data.activeUsers)} accent="#8A87F0"
                 sub="booking team members" />
            <Kpi label="Avg fill time" icon={<IconClock size={13} />} value={fmtDur(data.avgDurationMs)} unit={durUnit(data.avgDurationMs)} accent="var(--warn)"
                 sub="per submission" />
            <Kpi label="Vendors" icon={<IconStore size={13} />} value={fmt(data.vendorCount)} accent="#0E7C86"
                 sub={data.failingScripts > 0 ? `${data.failingScripts} script need fixing` : 'all scripts healthy'} />
          </div>

          <div className="section-head"><h2>Fill outcomes</h2><span className="count">{fmt(data.totalFills)} total</span></div>
          <Outcomes total={data.totalFills} ok={data.successFills} partial={data.partialFills} bad={data.failureFills} rate={data.successRate} />
        </>
      )}
    </>
  );
}

function HealthHero({ failing, successRate, hasData }: { failing: number; successRate: number; hasData: boolean }) {
  const healthy = failing === 0;
  const style = healthy
    ? { '--hero-glow': 'rgba(15,169,104,0.12)', '--hero-icon-bg': 'var(--ok-weak)', '--hero-icon-fg': 'var(--ok)' }
    : { '--hero-glow': 'rgba(229,72,77,0.12)', '--hero-icon-bg': 'var(--bad-weak)', '--hero-icon-fg': 'var(--bad)' };
  return (
    <div className="hero" style={style as React.CSSProperties}>
      <div className="hero-icon">{healthy ? <IconCheck size={28} /> : <IconAlert size={28} />}</div>
      <div className="hero-body">
        <div className="eyebrow">System status</div>
        <div className="hero-title" style={{ marginTop: 6 }}>
          {healthy ? 'All autofill scripts are healthy' : `${failing} script${failing > 1 ? 's' : ''} need attention`}
        </div>
        <div className="hero-desc">
          {healthy
            ? 'Every vendor script is matching its form fields. No action needed.'
            : 'A vendor changed their form — affected scripts can’t find some fields. Review them on Script Health.'}
        </div>
      </div>
      <div className="hero-stat">
        <div className="big" style={{ color: hasData ? (successRate >= 90 ? 'var(--ok)' : successRate >= 60 ? 'var(--warn)' : 'var(--bad)') : 'var(--faint)' }}>
          {hasData ? `${successRate}%` : '—'}
        </div>
        <div className="lbl">Success rate</div>
      </div>
    </div>
  );
}

function Kpi({ label, value, unit, sub, icon, accent }: { label: string; value: string; unit?: string; sub: string; icon: React.ReactNode; accent: string }) {
  return (
    <div className="card kpi">
      <div className="kpi-accent" style={{ background: accent }} />
      <div className="eyebrow"><span style={{ color: accent, display: 'inline-flex' }}>{icon}</span>{label}</div>
      <div className="kpi-val">{value}{unit && <span className="unit">{unit}</span>}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

function Outcomes({ total, ok, partial, bad, rate }: { total: number; ok: number; partial: number; bad: number; rate: number }) {
  if (total === 0) {
    return <div className="card card-pad" style={{ color: 'var(--muted)', fontSize: 13.5 }}>No fills recorded in this range yet.</div>;
  }
  const pct = (n: number) => (total ? (n / total) * 100 : 0);
  return (
    <div className="card card-pad">
      <div className="meter">
        <span style={{ width: `${pct(ok)}%`, background: 'var(--ok)' }} />
        <span style={{ width: `${pct(partial)}%`, background: 'var(--warn)' }} />
        <span style={{ width: `${pct(bad)}%`, background: 'var(--bad)' }} />
      </div>
      <div className="meter-legend">
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--ok)' }} />Clean fills <b>{fmt(ok)}</b></span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--warn)' }} />Partial <b>{fmt(partial)}</b></span>
        <span className="legend-item"><span className="legend-dot" style={{ background: 'var(--bad)' }} />Failed <b>{fmt(bad)}</b></span>
        <span className="legend-item" style={{ marginLeft: 'auto' }}>Overall success <b style={{ color: 'var(--ok)' }}>{rate}%</b></span>
      </div>
    </div>
  );
}
