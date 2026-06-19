import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useByVendor, useVendors } from '../hooks/useAnalytics';
import { useTimeRange } from '../hooks/useTimeRange';
import TimeRangePicker, { rangeLabel } from '../components/TimeRangePicker';
import { StatusBadge, RateBar, EmptyState } from '../components/ui';
import { IconStore, IconClose, IconExternal } from '../components/Icons';

const fmt = (n: number) => n.toLocaleString('en-IN');

export default function Vendors() {
  const { rangeKey, setRangeKey, customFrom, customTo, setCustom, from, to } = useTimeRange('7d');
  const { data: stats, isLoading } = useByVendor(from, to);
  const { data: vendors } = useVendors();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const selectedVendor = vendors?.find((v) => v.id === selected);
  const latestScript = selectedVendor?.scripts[0];

  async function saveScript() {
    if (!latestScript) return;
    setSaving(true);
    await fetch(`/api/scripts/${latestScript.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: editing }),
    });
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['vendors'] }),
      qc.invalidateQueries({ queryKey: ['by-vendor'] }),
      qc.invalidateQueries({ queryKey: ['script-health'] }),
    ]);
    setSaving(false);
    setSelected(null);
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 22 }}>
        <div>
          <div className="eyebrow">Vendor scripts</div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>Fill volume and reliability per vendor · {rangeLabel(rangeKey, from, to)}</div>
        </div>
        <TimeRangePicker selected={rangeKey} customFrom={customFrom} customTo={customTo} onChange={setRangeKey} onCustomChange={setCustom} />
      </div>

      {isLoading ? (
        <div className="skel" style={{ height: 220, borderRadius: 12 }} />
      ) : !stats?.length ? (
        <EmptyState title="No vendors yet" message="Vendors appear here once the extension fetches a script for a form URL." icon={<IconStore size={22} />} />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Form URL</th>
                <th>Fills</th>
                <th>Success rate</th>
                <th>Script</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {stats.map((v) => (
                <tr key={v.vendorId}>
                  <td className="cell-strong">{v.vendorName}</td>
                  <td><span className="cell-url">{v.vendorUrl.replace(/^https?:\/\//, '')}</span></td>
                  <td className="num">{fmt(v.totalFills)}</td>
                  <td>{v.totalFills > 0 ? <RateBar value={v.successRate} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <StatusBadge status={v.latestScriptStatus} />
                      {v.latestScriptVersion != null && <span className="num" style={{ fontSize: 11.5, color: 'var(--faint)' }}>v{v.latestScriptVersion}</span>}
                    </div>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-ghost" onClick={() => { setSelected(v.vendorId); setEditing(vendors?.find((x) => x.id === v.vendorId)?.scripts[0]?.content ?? ''); }}>
                      Edit script
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && latestScript && (
        <div className="overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <IconExternal size={18} />
              <div style={{ flex: 1 }}>
                <div className="cell-strong">{selectedVendor?.name}</div>
                <div className="incident-meta">Script v{latestScript.version}</div>
              </div>
              <StatusBadge status={latestScript.status} />
              <button className="btn btn-ghost" style={{ padding: 7 }} onClick={() => setSelected(null)}><IconClose size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="eyebrow" style={{ marginBottom: 8 }}>Autofill script source</div>
              <textarea className="code" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} />
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveScript} disabled={saving}>{saving ? 'Saving…' : 'Save new version'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
