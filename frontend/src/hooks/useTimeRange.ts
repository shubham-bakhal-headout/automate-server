import { useState, useMemo } from 'react';
import { type RangeKey, presetToRange } from '../components/TimeRangePicker';

function toLocalDatetimeValue(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function useTimeRange(defaultKey: RangeKey = '7d') {
  const [rangeKey, setRangeKey] = useState<RangeKey>(defaultKey);
  const [customFrom, setCustomFrom] = useState(() => toLocalDatetimeValue(new Date(Date.now() - 86400_000)));
  const [customTo, setCustomTo] = useState(() => toLocalDatetimeValue(new Date()));

  const { from, to } = useMemo(() => {
    if (rangeKey === 'custom') {
      return {
        from: customFrom ? new Date(customFrom) : new Date(Date.now() - 86400_000),
        to: customTo ? new Date(customTo) : new Date(),
      };
    }
    return presetToRange(rangeKey);
  }, [rangeKey, customFrom, customTo]);

  return {
    rangeKey, setRangeKey,
    customFrom, customTo,
    setCustom: (f: string, t: string) => { setCustomFrom(f); setCustomTo(t); },
    from, to,
  };
}
