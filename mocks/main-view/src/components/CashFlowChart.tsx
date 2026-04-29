import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAllEvents, useProjection, useStore } from '../store';
import type { YearlyProjection } from '../types';

const fmtMoneyShort = (v: number): string => {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(v / 1_000).toFixed(0)}k`;
  return `$${v.toFixed(0)}`;
};
const fmtMoney = (v: number): string =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

// Distinct, readable palette for stack segments.
const incomePalette = ['#4ade80', '#22d3ee', '#86efac', '#67e8f9'];
const expensePalette = ['#f87171', '#fb923c', '#fca5a5'];
const COLOR_TAXES = '#dc2626';
const COLOR_FORCED_SALE = '#fb923c';
const COLOR_EVENT_LIQ = '#22d3ee';

interface Row {
  age: number;
  taxes: number;
  forced_sale: number;
  event_liq: number;
  [key: string]: number;
}

export function CashFlowChart(): JSX.Element {
  const projection = useProjection();
  const accounts = useStore((s) => s.accounts);
  const dollarMode = useStore((s) => s.dollarMode);
  const events = useAllEvents();
  const hoveredEventId = useStore((s) => s.hoveredEventId);
  const selection = useStore((s) => s.selection);

  // Income & expense source ids (stable order).
  const incomeIds = useMemo(
    () =>
      accounts
        .filter((a) => a.kind === 'income')
        .map((a) => a.id),
    [accounts],
  );
  const expenseIds = useMemo(
    () =>
      accounts
        .filter((a) => a.kind === 'expense')
        .map((a) => a.id),
    [accounts],
  );
  const nameById = useMemo(
    () => Object.fromEntries(accounts.map((a) => [a.id, a.name])),
    [accounts],
  );

  const data: Row[] = projection.map((p) => {
    const div = dollarMode === 'real' ? p.cumulative_inflation_index : 1;
    const row: Row = {
      age: p.age,
      taxes: -(p.taxes_paid / div),
      forced_sale: p.forced_sale_proceeds / div,
      event_liq: p.event_liquidation_proceeds / div,
    };
    for (const id of incomeIds)
      row[`in:${id}`] = (p.income_by_source[id] ?? 0) / div;
    for (const id of expenseIds)
      row[`out:${id}`] = -(p.expense_by_source[id] ?? 0) / div;
    return row;
  });

  return (
    <div className="cashflow-wrap">
      <div className="cashflow-head">
        <span className="cashflow-title">Cash flow per year</span>
        <span className="muted small">
          income above zero · expenses & taxes below
        </span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 24, left: 12, bottom: 12 }}
          stackOffset="sign"
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#26303a" />
          <XAxis
            dataKey="age"
            tick={{ fill: '#9aa6b2', fontSize: 12 }}
            type="number"
            domain={[
              data[0]?.age ?? 0,
              data[data.length - 1]?.age ?? 0,
            ]}
            allowDecimals={false}
          />
          <YAxis
            tick={{ fill: '#9aa6b2', fontSize: 12 }}
            tickFormatter={fmtMoneyShort}
            width={70}
          />
          <Tooltip
            cursor={{ fill: 'rgba(255,255,255,0.04)' }}
            allowEscapeViewBox={{ x: false, y: true }}
            wrapperStyle={{ zIndex: 100, pointerEvents: 'none' }}
            content={
              <CashFlowTooltip
                projection={projection}
                nameById={nameById}
                dollarMode={dollarMode}
              />
            }
          />
          {/* Income sources stack upward */}
          {incomeIds.map((id, idx) => (
            <Bar
              key={`in:${id}`}
              dataKey={`in:${id}`}
              stackId="cashflow"
              fill={incomePalette[idx % incomePalette.length]}
              isAnimationActive={false}
            />
          ))}
          <Bar
            dataKey="event_liq"
            stackId="cashflow"
            fill={COLOR_EVENT_LIQ}
            isAnimationActive={false}
          />
          <Bar
            dataKey="forced_sale"
            stackId="cashflow"
            fill={COLOR_FORCED_SALE}
            isAnimationActive={false}
          />
          {/* Expenses stack downward (negative values) */}
          {expenseIds.map((id, idx) => (
            <Bar
              key={`out:${id}`}
              dataKey={`out:${id}`}
              stackId="cashflow"
              fill={expensePalette[idx % expensePalette.length]}
              isAnimationActive={false}
            />
          ))}
          <Bar
            dataKey="taxes"
            stackId="cashflow"
            fill={COLOR_TAXES}
            isAnimationActive={false}
          />
          <ReferenceLine y={0} stroke="#26303a" />
          {events.map((e) => {
            const hovered = hoveredEventId === e.id;
            const sel = selection.kind === 'event' && selection.id === e.id;
            if (!hovered && !sel) return null;
            return (
              <ReferenceLine
                key={e.id}
                x={e.trigger_age}
                stroke="#f5b342"
                strokeWidth={1.25}
                strokeDasharray="3 3"
              />
            );
          })}
        </BarChart>
      </ResponsiveContainer>
      <Legend incomeIds={incomeIds} expenseIds={expenseIds} nameById={nameById} />
    </div>
  );
}

interface CashFlowTooltipProps {
  active?: boolean;
  label?: number;
  projection: YearlyProjection[];
  nameById: Record<string, string>;
  dollarMode: 'nominal' | 'real';
}

function CashFlowTooltip({
  active,
  label,
  projection,
  nameById,
  dollarMode,
}: CashFlowTooltipProps): JSX.Element | null {
  if (!active || label === undefined) return null;
  const p = projection.find((x) => x.age === label);
  if (!p) return null;
  const div = dollarMode === 'real' ? p.cumulative_inflation_index : 1;

  const incomeEntries = Object.entries(p.income_by_source).filter(
    ([, v]) => v > 0,
  );
  const expenseEntries = Object.entries(p.expense_by_source).filter(
    ([, v]) => v > 0,
  );
  const totalIncomeSources = incomeEntries.reduce((s, [, v]) => s + v, 0) / div;
  const eventLiq = p.event_liquidation_proceeds / div;
  const forcedSale = p.forced_sale_proceeds / div;
  const totalIn = totalIncomeSources + eventLiq + forcedSale;
  const totalOut =
    Object.values(p.expense_by_source).reduce((s, v) => s + v, 0) / div +
    p.taxes_paid / div;
  const net = totalIn - totalOut;

  return (
    <div className="cf-tooltip">
      <div className="cf-tt-head">
        <span>Age {p.age}</span>
        <span className={`cf-tt-net ${net >= 0 ? 'pos' : 'neg'}`}>
          Net {(net >= 0 ? '+' : '') + fmtMoney(net)}
        </span>
      </div>

      <div className="cf-tt-section">
        <div className="cf-tt-section-h">Income · {fmtMoney(totalIn)}</div>
        {incomeEntries.length === 0 && eventLiq === 0 && forcedSale === 0 && (
          <div className="cf-tt-row muted">— none —</div>
        )}
        {incomeEntries.map(([id, v]) => (
          <div key={id} className="cf-tt-row">
            <span>{nameById[id] ?? id}</span>
            <span>{fmtMoney(v / div)}</span>
          </div>
        ))}
        {eventLiq > 0 && (
          <div className="cf-tt-row">
            <span>Event liquidation</span>
            <span>{fmtMoney(eventLiq)}</span>
          </div>
        )}
        {forcedSale > 0 && (
          <div className="cf-tt-row">
            <span className="cf-warn">Forced sale</span>
            <span>{fmtMoney(forcedSale)}</span>
          </div>
        )}
      </div>

      <div className="cf-tt-section">
        <div className="cf-tt-section-h">Outflows · {fmtMoney(totalOut)}</div>
        {expenseEntries.length === 0 && p.taxes_paid === 0 && (
          <div className="cf-tt-row muted">— none —</div>
        )}
        {expenseEntries.map(([id, v]) => (
          <div key={id} className="cf-tt-row">
            <span>{nameById[id] ?? id}</span>
            <span>{fmtMoney(v / div)}</span>
          </div>
        ))}
        {p.taxes_paid > 0 && (
          <>
            <div className="cf-tt-row">
              <span>Taxes</span>
              <span>{fmtMoney(p.taxes_paid / div)}</span>
            </div>
            <div className="cf-tt-subrow">
              <span>· ordinary</span>
              <span>{fmtMoney(p.tax_ordinary / div)}</span>
            </div>
            <div className="cf-tt-subrow">
              <span>· LTCG</span>
              <span>{fmtMoney(p.tax_ltcg / div)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

interface LegendProps {
  incomeIds: string[];
  expenseIds: string[];
  nameById: Record<string, string>;
}

function Legend({ incomeIds, expenseIds, nameById }: LegendProps): JSX.Element {
  return (
    <div className="cashflow-legend">
      {incomeIds.map((id, idx) => (
        <span key={id} className="cf-legend-item">
          <span
            className="cf-swatch"
            style={{ background: incomePalette[idx % incomePalette.length] }}
          />
          {nameById[id] ?? id}
        </span>
      ))}
      <span className="cf-legend-item">
        <span className="cf-swatch" style={{ background: COLOR_EVENT_LIQ }} />
        Event liquidation
      </span>
      <span className="cf-legend-item">
        <span className="cf-swatch" style={{ background: COLOR_FORCED_SALE }} />
        Forced sale
      </span>
      <span className="cf-legend-sep" />
      {expenseIds.map((id, idx) => (
        <span key={id} className="cf-legend-item">
          <span
            className="cf-swatch"
            style={{ background: expensePalette[idx % expensePalette.length] }}
          />
          {nameById[id] ?? id}
        </span>
      ))}
      <span className="cf-legend-item">
        <span className="cf-swatch" style={{ background: COLOR_TAXES }} />
        Taxes
      </span>
    </div>
  );
}
