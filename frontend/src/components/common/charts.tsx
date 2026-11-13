/**
 * Chart wrappers (Recharts) with one shared look: brand colours, muted gridlines, themed tooltips.
 */
import type { ReactNode } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export const CHART_COLORS = ['#7C3AED', '#0EA5E9', '#10B981', '#F59E0B', '#F43F5E', '#6366F1', '#14B8A6'];

const axis = { stroke: 'rgb(var(--muted))', fontSize: 12, tickLine: false, axisLine: false } as const;
const grid = <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />;

function TooltipBox({ active, payload, label, format }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-surface px-3 py-2 text-xs shadow-lift">
      {label && <div className="mb-1 font-semibold">{label}</div>}
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
          <span className="text-muted">{p.name}:</span>
          <span className="font-semibold">{format ? format(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function AreaTrend({ data, x, series, height = 240, format }: { data: any[]; x: string; series: { key: string; name: string; color?: string }[]; height?: number; format?: (v: number) => ReactNode }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color ?? CHART_COLORS[i]} stopOpacity={0.3} />
              <stop offset="100%" stopColor={s.color ?? CHART_COLORS[i]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        {grid}
        <XAxis dataKey={x} {...axis} minTickGap={24} />
        <YAxis {...axis} allowDecimals={false} tickFormatter={format as any} width={56} />
        <Tooltip content={<TooltipBox format={format} />} cursor={{ stroke: 'rgb(var(--border))' }} />
        {series.map((s, i) => (
          <Area key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? CHART_COLORS[i]} strokeWidth={2.2} fill={`url(#g-${s.key})`} />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function Bars({ data, x, series, height = 240, format, layout = 'horizontal' }: { data: any[]; x: string; series: { key: string; name: string; color?: string }[]; height?: number; format?: (v: number) => ReactNode; layout?: 'horizontal' | 'vertical' }) {
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={vertical ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 8, left: vertical ? 8 : -18, bottom: 0 }}>
        {vertical ? <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" horizontal={false} /> : grid}
        {vertical ? <XAxis type="number" {...axis} tickFormatter={format as any} /> : <XAxis dataKey={x} {...axis} minTickGap={8} />}
        {vertical ? <YAxis type="category" dataKey={x} {...axis} width={140} /> : <YAxis {...axis} tickFormatter={format as any} width={56} />}
        <Tooltip content={<TooltipBox format={format} />} cursor={{ fill: 'rgb(var(--surface-2))' }} />
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color ?? CHART_COLORS[i]} radius={vertical ? [0, 6, 6, 0] : [6, 6, 0, 0]} maxBarSize={36} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LineTrend({ data, x, series, height = 220, domain }: { data: any[]; x: string; series: { key: string; name: string; color?: string }[]; height?: number; domain?: [number, number] }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        {grid}
        <XAxis dataKey={x} {...axis} minTickGap={16} />
        <YAxis {...axis} domain={domain} width={48} />
        <Tooltip content={<TooltipBox />} />
        {series.map((s, i) => <Line key={s.key} type="monotone" dataKey={s.key} name={s.name} stroke={s.color ?? CHART_COLORS[i]} strokeWidth={2.4} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
      </LineChart>
    </ResponsiveContainer>
  );
}

export function Donut({ data, nameKey, valueKey, height = 220 }: { data: any[]; nameKey: string; valueKey: string; height?: number }) {
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="w-full sm:w-1/2" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={valueKey} nameKey={nameKey} innerRadius="60%" outerRadius="90%" paddingAngle={2} strokeWidth={0}>
              {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
            </Pie>
            <Tooltip content={<TooltipBox />} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="w-full space-y-2 text-sm sm:w-1/2">
        {data.map((d, i) => (
          <li key={d[nameKey]} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 truncate"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />{d[nameKey]}</span>
            <span className="font-semibold">{d[valueKey]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** GitHub-style activity heatmap for the last N days. */
export function ActivityHeatmap({ days }: { days: { day: string; minutes: number }[] }) {
  const map = new Map(days.map((d) => [d.day, d.minutes]));
  const cells = Array.from({ length: 84 }, (_, i) => {
    const d = new Date(Date.now() - (83 - i) * 86400000).toISOString().slice(0, 10);
    return { d, m: map.get(d) ?? 0 };
  });
  const level = (m: number) => (m === 0 ? 'bg-surface-2' : m < 15 ? 'bg-brand-200 dark:bg-brand-900' : m < 35 ? 'bg-brand-400 dark:bg-brand-700' : m < 60 ? 'bg-brand-600 dark:bg-brand-500' : 'bg-brand-800 dark:bg-brand-300');
  return (
    <div>
      <div className="overflow-x-auto scrollbar-thin">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1">
          {cells.map((c) => <div key={c.d} title={`${c.d}: ${c.m} min`} className={`h-3.5 w-3.5 rounded-[3px] ${level(c.m)}`} />)}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end gap-1 text-[11px] text-muted">
        Less {[0, 10, 30, 50, 80].map((m) => <span key={m} className={`h-2.5 w-2.5 rounded-[3px] ${level(m)}`} />)} More
      </div>
    </div>
  );
}
