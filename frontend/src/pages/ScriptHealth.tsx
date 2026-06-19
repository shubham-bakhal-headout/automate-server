import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client';
import { useScriptHealth, type ScriptHealth as Script } from '../hooks/useAnalytics';
import { StatusBadge, EmptyState } from '../components/ui';
import { IconShield, IconCheck } from '../components/Icons';

type Field = { key: string; ok: boolean; error?: string };

export default function ScriptHealth() {
  const { data: scripts, isLoading } = useScriptHealth();
  const qc = useQueryClient();

  async function markActive(scriptId: string) {
    await apiRequest(`/api/scripts/${scriptId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'ACTIVE' }),
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['script-health'] }),
      qc.invalidateQueries({ queryKey: ['summary'] }),
      qc.invalidateQueries({ queryKey: ['vendors'] }),
    ]);
  }

  if (isLoading) return <div className="skel" style={{ height: 200, borderRadius: 12 }} />;

  const failing = (scripts ?? []).filter((s) => s.status === 'FAILING');
  const healthy = (scripts ?? []).filter((s) => s.status === 'ACTIVE');

  return (
    <>
      <div className="eyebrow">Reliability</div>
      <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6, marginBottom: 22 }}>
        A script is flagged when the extension can’t find a field it expects — usually because the vendor changed their form.
      </div>

      {failing.length === 0 && (
        <div className="card hero" style={{ '--hero-glow': 'rgba(15,169,104,0.12)' } as React.CSSProperties}>
          <div className="hero-icon"><IconCheck size={26} /></div>
          <div className="hero-body">
            <div className="hero-title">No failing scripts</div>
            <div className="hero-desc">Every active script is matching its vendor form. You’re all clear.</div>
          </div>
        </div>
      )}

      {failing.length > 0 && (
        <>
          <div className="section-head"><h2 style={{ color: 'var(--bad)' }}>Needs attention</h2><span className="count">{failing.length} failing</span></div>
          <div className="grid">{failing.map((s) => <Incident key={s.scriptId} s={s} onResolve={markActive} />)}</div>
        </>
      )}

      {healthy.length > 0 && (
        <>
          <div className="section-head"><h2>Healthy scripts</h2><span className="count">{healthy.length} active</span></div>
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>Vendor</th><th>Version</th><th>Status</th><th>Total fills</th></tr></thead>
              <tbody>
                {healthy.map((s) => (
                  <tr key={s.scriptId}>
                    <td className="cell-strong">{s.vendor.name}</td>
                    <td className="num">v{s.version}</td>
                    <td><StatusBadge status={s.status} /></td>
                    <td className="num">{s.totalEvents.toLocaleString('en-IN')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {failing.length === 0 && healthy.length === 0 && (
        <EmptyState title="No scripts yet" message="Scripts show up here once a vendor has an autofill script registered." icon={<IconShield size={22} />} />
      )}
    </>
  );
}

function Incident({ s, onResolve }: { s: Script; onResolve: (id: string) => void }) {
  return (
    <div className="card incident">
      <div className="incident-head">
        <div style={{ flex: 1 }}>
          <div className="incident-title">{s.vendor.name}</div>
          <div className="incident-meta">{s.vendor.url.replace(/^https?:\/\//, '')} · v{s.version} · {s.totalEvents} fills</div>
        </div>
        <StatusBadge status={s.status} />
        <button className="btn btn-ok" onClick={() => onResolve(s.scriptId)}>Mark resolved</button>
      </div>
      <div className="incident-body">
        <div className="eyebrow" style={{ padding: '12px 0 4px' }}>Recent failures</div>
        {s.recentFailures.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13, padding: '6px 0' }}>No recent failure detail.</div>}
        {s.recentFailures.map((f) => {
          const badFields = (Array.isArray(f.fieldResults) ? (f.fieldResults as Field[]) : []).filter((r) => !r.ok);
          return (
            <div className="fail-row" key={f.id}>
              <span className="fail-time">{new Date(f.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                {badFields.length > 0
                  ? badFields.map((r) => <span key={r.key} className="fail-field" title={r.error}>{r.key}</span>)
                  : <span style={{ color: 'var(--muted)' }}>{f.error ?? f.status}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
