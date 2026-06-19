import { useByUser } from '../hooks/useAnalytics';
import { useTimeRange } from '../hooks/useTimeRange';
import TimeRangePicker, { rangeLabel } from '../components/TimeRangePicker';
import { RateBar, Avatar, EmptyState } from '../components/ui';
import { IconUsers } from '../components/Icons';

const fmt = (n: number) => n.toLocaleString('en-IN');

export default function Team() {
  const { rangeKey, setRangeKey, customFrom, customTo, setCustom, from, to } = useTimeRange('7d');
  const { data: users, isLoading } = useByUser(from, to);

  const ranked = [...(users ?? [])].sort((a, b) => b.totalFills - a.totalFills);
  const totalFills = ranked.reduce((s, u) => s + u.totalFills, 0);

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14, marginBottom: 22 }}>
        <div>
          <div className="eyebrow">Booking team</div>
          <div style={{ color: 'var(--muted)', fontSize: 13.5, marginTop: 6 }}>
            {fmt(totalFills)} forms filled by {ranked.length} agent{ranked.length === 1 ? '' : 's'} · {rangeLabel(rangeKey, from, to)}
          </div>
        </div>
        <TimeRangePicker selected={rangeKey} customFrom={customFrom} customTo={customTo} onChange={setRangeKey} onCustomChange={setCustom} />
      </div>

      {isLoading ? (
        <div className="skel" style={{ height: 220, borderRadius: 12 }} />
      ) : !ranked.length ? (
        <EmptyState title="No activity in this range" message="Agent usage appears here as the team fills vendor forms with the extension." icon={<IconUsers size={22} />} />
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th className="rank">#</th><th>Agent</th><th>Team</th><th>Forms filled</th><th>Success rate</th></tr>
            </thead>
            <tbody>
              {ranked.map((u, i) => {
                const name = u.name ?? u.email.split('@')[0];
                return (
                  <tr key={u.userId}>
                    <td className="rank">{i + 1}</td>
                    <td>
                      <div className="user-cell">
                        <Avatar seed={u.email} label={name} />
                        <div>
                          <div className="cell-strong">{name}</div>
                          <div className="cell-url" style={{ maxWidth: 'none' }}>{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td style={{ color: 'var(--muted)' }}>{u.team ?? '—'}</td>
                    <td className="num">{fmt(u.totalFills)}</td>
                    <td style={{ maxWidth: 180 }}>{u.totalFills > 0 ? <RateBar value={u.successRate} /> : <span style={{ color: 'var(--faint)' }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
