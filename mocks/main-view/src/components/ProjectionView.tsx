import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAllEvents, useProjection, useStore } from '../store';
import type { TimelineEvent, YearlyProjection } from '../types';

const fmtMoneyShort = (v: number): string => {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};

const fmtMoney = (v: number): string =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

interface ChartRow {
  age: number;
  baseline: number;
  best: number;
  worst: number;
  band: [number, number];
}

const CHART_LEFT_PAD = 70;
const CHART_RIGHT_PAD = 24;
const NODE_ROW_HEIGHT = 28;

function toRow(p: YearlyProjection, divisor: number): ChartRow {
  const baseline = p.total_baseline / divisor;
  const best = p.total_best / divisor;
  const worst = p.total_worst / divisor;
  return { age: p.age, baseline, best, worst, band: [worst, best] };
}

function eventColor(e: TimelineEvent, hovered: boolean, selected: boolean): string {
  if (hovered || selected) return '#f5b342';
  if (e.kind === 'recurring') return '#4ade80';
  if (e.auto_generated) return '#8a96a3';
  return '#3a82f6';
}

interface DragState {
  eventId: string;
  handle: 'start' | 'end' | 'whole';
  grabAtAge: number;
  initialStart: number;
  initialEnd?: number;
}

export function ProjectionView() {
  const projection = useProjection();
  const dollarMode = useStore((s) => s.dollarMode);
  const events = useAllEvents();
  const household = useStore((s) => s.household);
  const hoveredEventId = useStore((s) => s.hoveredEventId);
  const setHovered = useStore((s) => s.setHoveredEvent);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setEventAge = useStore((s) => s.setEventAge);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  useEffect(() => {
    const update = (): void => {
      if (containerRef.current) {
        setContainerRect(containerRef.current.getBoundingClientRect());
      }
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  const data: ChartRow[] = useMemo(
    () =>
      projection.map((p) =>
        toRow(p, dollarMode === 'real' ? p.cumulative_inflation_index : 1),
      ),
    [projection, dollarMode],
  );

  // The chart's X axis is the primary actor's age timeline; partner's
  // ages are rendered as separate annotations downstream when needed.
  const primary = household.actors.find((a) => a.id === household.primary_actor_id) ?? household.actors[0];
  const minAge = primary.current_age;
  const maxAge = household.horizon_age;
  const innerWidth = (containerRect?.width ?? 800) - CHART_LEFT_PAD - CHART_RIGHT_PAD;
  const ageToX = (age: number): number =>
    CHART_LEFT_PAD + ((age - minAge) / (maxAge - minAge)) * innerWidth;
  const xToAge = (x: number): number =>
    minAge + ((x - CHART_LEFT_PAD) / innerWidth) * (maxAge - minAge);

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent): void => {
      if (!containerRect) return;
      const x = e.clientX - containerRect.left;
      const age = Math.round(Math.max(minAge, Math.min(maxAge, xToAge(x))));
      const ev = events.find((x) => x.id === drag.eventId);
      if (!ev) return;
      const delta = age - drag.grabAtAge;
      if (drag.handle === 'start') {
        const newStart = Math.min(Math.max(minAge, age), ev.end_age ?? maxAge);
        setEventAge(ev.id, newStart);
      } else if (drag.handle === 'end') {
        const newEnd = Math.max(Math.min(maxAge, age), ev.trigger_age);
        setEventAge(ev.id, ev.trigger_age, newEnd);
      } else {
        const initialEnd = drag.initialEnd;
        const span = initialEnd !== undefined ? initialEnd - drag.initialStart : 0;
        let newStart = drag.initialStart + delta;
        let newEnd = initialEnd !== undefined ? initialEnd + delta : undefined;
        // Keep the whole event inside [minAge, maxAge].
        if (newStart < minAge) {
          newStart = minAge;
          if (newEnd !== undefined) newEnd = minAge + span;
        }
        if (newEnd !== undefined && newEnd > maxAge) {
          newEnd = maxAge;
          newStart = maxAge - span;
        } else if (newEnd === undefined && newStart > maxAge) {
          newStart = maxAge;
        }
        setEventAge(ev.id, newStart, newEnd);
      }
    };
    const onUp = (): void => setDrag(null);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, containerRect, events, minAge, maxAge, xToAge, setEventAge]);

  const startDrag = (
    eventId: string,
    handle: 'start' | 'end' | 'whole',
    e: ReactPointerEvent,
  ): void => {
    e.stopPropagation();
    e.preventDefault();
    if (!containerRect) return;
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    if (ev.auto_generated) return; // auto-events are read-only here
    const x = e.clientX - containerRect.left;
    setDrag({
      eventId,
      handle,
      grabAtAge: Math.round(xToAge(x)),
      initialStart: ev.trigger_age,
      initialEnd: ev.end_age,
    });
  };

  return (
    <div className="proj-view" ref={containerRef}>
      <div className="evt-node-row" style={{ height: NODE_ROW_HEIGHT }}>
        {events.map((e) => {
          const hovered = hoveredEventId === e.id;
          const selected = selection.kind === 'event' && selection.id === e.id;
          const color = eventColor(e, hovered, selected);
          const startX = ageToX(e.trigger_age);
          const isRange = e.end_age !== undefined && e.end_age !== e.trigger_age;
          const tooltip = `${e.name}${e.description ? ` — ${e.description}` : ''}`;
          if (isRange && e.end_age !== undefined) {
            const endX = ageToX(e.end_age);
            return (
              <div key={e.id}>
                <button
                  className={`evt-node range ${hovered ? 'hovered' : ''} ${selected ? 'selected' : ''}`}
                  style={{ left: startX, background: color, borderColor: color }}
                  onPointerDown={(ev) => startDrag(e.id, 'start', ev)}
                  onClick={() => select({ kind: 'event', id: e.id })}
                  onMouseEnter={() => setHovered(e.id)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${tooltip}\nstarts age ${e.trigger_age}`}
                />
                <button
                  className={`evt-node range ${hovered ? 'hovered' : ''} ${selected ? 'selected' : ''}`}
                  style={{ left: endX, background: color, borderColor: color }}
                  onPointerDown={(ev) => startDrag(e.id, 'end', ev)}
                  onClick={() => select({ kind: 'event', id: e.id })}
                  onMouseEnter={() => setHovered(e.id)}
                  onMouseLeave={() => setHovered(null)}
                  title={`${tooltip}\nends age ${e.end_age}`}
                />
              </div>
            );
          }
          return (
            <button
              key={e.id}
              className={`evt-node ${hovered ? 'hovered' : ''} ${selected ? 'selected' : ''}`}
              style={{ left: startX, background: color, borderColor: color }}
              onPointerDown={(ev) => startDrag(e.id, 'whole', ev)}
              onClick={() => select({ kind: 'event', id: e.id })}
              onMouseEnter={() => setHovered(e.id)}
              onMouseLeave={() => setHovered(null)}
              title={`${tooltip}\nage ${e.trigger_age}`}
            />
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart
          data={data}
          margin={{ top: 4, right: CHART_RIGHT_PAD, left: 12, bottom: 12 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#26303a" />
          <XAxis
            dataKey="age"
            tick={{ fill: '#9aa6b2', fontSize: 12 }}
            type="number"
            domain={[minAge, maxAge]}
            label={{
              value: 'Age',
              position: 'insideBottom',
              offset: -2,
              fill: '#9aa6b2',
              fontSize: 12,
            }}
          />
          <YAxis
            tick={{ fill: '#9aa6b2', fontSize: 12 }}
            tickFormatter={fmtMoneyShort}
            width={70}
          />
          <Tooltip
            contentStyle={{
              background: '#10161d',
              border: '1px solid #2a3441',
              borderRadius: 6,
              fontSize: 12,
            }}
            formatter={(value, name) => {
              const labels: Record<string, string> = {
                baseline: 'Baseline',
                best: 'Best',
                worst: 'Worst',
              };
              const v = typeof value === 'number' ? value : Number(value);
              const key = typeof name === 'string' ? name : String(name);
              return [fmtMoney(v), labels[key] ?? key];
            }}
            labelFormatter={(label) => `Age ${label}`}
          />
          <Area
            type="monotone"
            dataKey="band"
            stroke="none"
            fill="#3a82f6"
            fillOpacity={0.16}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="baseline"
            stroke="#3a82f6"
            strokeWidth={2.25}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="best"
            stroke="#3a82f6"
            strokeOpacity={0.4}
            strokeDasharray="4 3"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            type="monotone"
            dataKey="worst"
            stroke="#3a82f6"
            strokeOpacity={0.4}
            strokeDasharray="4 3"
            strokeWidth={1}
            dot={false}
            isAnimationActive={false}
          />
          {/* Translucent overlay spanning ranged events when selected/hovered. */}
          {events
            .filter((e) => e.end_age !== undefined && e.end_age !== e.trigger_age)
            .map((e) => {
              const hovered = hoveredEventId === e.id;
              const sel = selection.kind === 'event' && selection.id === e.id;
              if (!hovered && !sel) return null;
              return (
                <ReferenceArea
                  key={`${e.id}-area`}
                  x1={e.trigger_age}
                  x2={e.end_age}
                  fill="#f5b342"
                  fillOpacity={0.08}
                  stroke="none"
                />
              );
            })}
          {events.map((e) => {
            const hovered = hoveredEventId === e.id;
            const selected = selection.kind === 'event' && selection.id === e.id;
            const color = eventColor(e, hovered, selected);
            const isRange = e.end_age !== undefined && e.end_age !== e.trigger_age;
            return (
              <ReferenceLine
                key={e.id}
                x={e.trigger_age}
                stroke={color}
                strokeOpacity={hovered || selected ? 1 : 0.55}
                strokeWidth={hovered || selected ? 1.5 : 1}
                strokeDasharray={isRange ? '0' : '3 3'}
              />
            );
          })}
          {events
            .filter((e) => e.end_age !== undefined && e.end_age !== e.trigger_age)
            .map((e) => {
              const hovered = hoveredEventId === e.id;
              const selected = selection.kind === 'event' && selection.id === e.id;
              const color = eventColor(e, hovered, selected);
              if (!hovered && !selected) return null;
              return (
                <ReferenceLine
                  key={`${e.id}-end`}
                  x={e.end_age}
                  stroke={color}
                  strokeOpacity={1}
                  strokeWidth={1.5}
                />
              );
            })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
