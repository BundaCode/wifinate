import { bucketLabel, num, rupiah } from '@/lib/format';

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { name?: string; value?: number; color?: string; dataKey?: string; payload?: Record<string, unknown> }[];
  labelFormatter?: (l: string | number) => string;
}

/** Tooltip grafik yang rapi & mengikuti tema terang/gelap. */
export function ChartTooltip({ active, payload, label, labelFormatter }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload ?? {};
  return (
    <div className="rounded-xl border bg-[var(--surface)] px-3.5 py-2.5 text-sm shadow-xl">
      <p className="mb-1 font-semibold">{labelFormatter ? labelFormatter(label ?? '') : typeof label === 'string' ? bucketLabel(label) : label}</p>
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-muted">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold text-[var(--text)]">{p.dataKey === 'count' ? num(p.value ?? 0) : rupiah(p.value ?? 0)}</span>
        </p>
      ))}
      {'count' in row && payload[0].dataKey !== 'count' && (
        <p className="mt-0.5 text-xs text-muted">{num(Number(row.count))} voucher</p>
      )}
    </div>
  );
}
