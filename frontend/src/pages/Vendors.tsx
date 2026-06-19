import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '../api/client';
import { useByVendor, useVendors } from '../hooks/useAnalytics';
import { useTimeRange } from '../hooks/useTimeRange';
import TimeRangePicker, { rangeLabel } from '../components/TimeRangePicker';
import { StatusBadge, RateBar, EmptyState } from '../components/ui';
import { IconStore, IconClose, IconExternal, IconPlus } from '../components/Icons';

const fmt = (n: number) => n.toLocaleString('en-IN');
const emptyVendorForm = { name: '', url: '', content: '' };

export default function Vendors() {
  const { rangeKey, setRangeKey, customFrom, customTo, setCustom, from, to } = useTimeRange('7d');
  const { data: stats, isLoading } = useByVendor(from, to);
  const { data: vendors } = useVendors();
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState('');
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [vendorForm, setVendorForm] = useState(emptyVendorForm);
  const qc = useQueryClient();

  const selectedVendor = vendors?.find((v) => v.id === selected);
  const latestScript = selectedVendor?.scripts[0];

  async function saveScript() {
    if (!latestScript) return;
    setSaving(true);
    await apiRequest(`/api/scripts/${latestScript.id}`, {
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

  async function createVendor() {
    const name = vendorForm.name.trim();
    const url = vendorForm.url.trim();
    const content = vendorForm.content.trim();
    if (!name || !url || !content) {
      setCreateError('Name, form URL, and script content are required.');
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      setCreateError('Enter a valid absolute form URL.');
      return;
    }
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      setCreateError('Form URL must start with http:// or https://.');
      return;
    }

    setCreating(true);
    setCreateError(null);
    try {
      const vendorRes = await apiRequest('/api/vendors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url }),
      });
      const vendorJson = await vendorRes.json() as { data: { id: string } };
      await apiRequest(`/api/vendors/${vendorJson.data.id}/scripts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['vendors'] }),
        qc.invalidateQueries({ queryKey: ['by-vendor'] }),
        qc.invalidateQueries({ queryKey: ['script-health'] }),
        qc.invalidateQueries({ queryKey: ['summary'] }),
      ]);
      setVendorForm(emptyVendorForm);
      setAdding(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Could not add vendor.');
    } finally {
      setCreating(false);
    }
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 22 }}>
        <div>
          <div className="eyebrow">Vendor scripts</div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>Fill volume and reliability per vendor · {rangeLabel(rangeKey, from, to)}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={() => { setCreateError(null); setAdding(true); }}>
            <IconPlus size={16} /> Add vendor
          </button>
          <TimeRangePicker selected={rangeKey} customFrom={customFrom} customTo={customTo} onChange={setRangeKey} onCustomChange={setCustom} />
        </div>
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

      {adding && (
        <div className="overlay" onClick={() => !creating && setAdding(false)}>
          <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <IconStore size={18} />
              <div style={{ flex: 1 }}>
                <div className="cell-strong">Add vendor</div>
                <div className="incident-meta">Create a vendor row and its first active script</div>
              </div>
              <button className="btn btn-ghost" style={{ padding: 7 }} onClick={() => setAdding(false)} disabled={creating}><IconClose size={16} /></button>
            </div>
            <div className="modal-body">
              <div className="form-grid">
                <label className="field">
                  <span>Name</span>
                  <input
                    value={vendorForm.name}
                    onChange={(e) => setVendorForm((form) => ({ ...form, name: e.target.value }))}
                    placeholder="Vendor display name"
                    autoFocus
                  />
                </label>
                <label className="field">
                  <span>Form URL</span>
                  <input
                    value={vendorForm.url}
                    onChange={(e) => setVendorForm((form) => ({ ...form, url: e.target.value }))}
                    placeholder="https://vendor.example.com/booking-form"
                    type="url"
                  />
                </label>
                <label className="field">
                  <span>Autofill script</span>
                  <textarea
                    className="code code-compact"
                    value={vendorForm.content}
                    onChange={(e) => setVendorForm((form) => ({ ...form, content: e.target.value }))}
                    placeholder="window.HeadoutAutomation = { ... };"
                    spellCheck={false}
                  />
                </label>
              </div>
              {createError && <div className="form-error">{createError}</div>}
            </div>
            <div className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setAdding(false)} disabled={creating}>Cancel</button>
              <button className="btn btn-primary" onClick={createVendor} disabled={creating}>{creating ? 'Adding…' : 'Add vendor'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
