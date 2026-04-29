import { useProjection, useStore } from '../store';
import type { YearlyProjection } from '../types';

const fmtMoney = (v: number): string =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

export function SummaryStrip() {
  const projection = useProjection();
  const dollarMode = useStore((s) => s.dollarMode);
  const actor = useStore((s) => s.actor);

  const start = projection[0];
  const end = projection[projection.length - 1];
  const div = (p: YearlyProjection): number =>
    dollarMode === 'real' ? p.cumulative_inflation_index : 1;

  const startNet = start.total_baseline / div(start);
  const endNet = end.total_baseline / div(end);
  const endBest = end.total_best / div(end);
  const endWorst = end.total_worst / div(end);
  const lifetimeTaxes = projection.reduce((s, p) => s + p.taxes_paid / div(p), 0);
  const everZero = projection.find((p) => p.total_worst <= 0);
  const lowAge = projection.reduce(
    (acc, p) => (p.total_baseline < acc.balance ? { age: p.age, balance: p.total_baseline } : acc),
    { age: start.age, balance: start.total_baseline },
  );

  return (
    <div className="summary-strip">
      <div className="stat">
        <div className="stat-label">Today's net worth</div>
        <div className="stat-value">{fmtMoney(startNet)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Net worth at age {actor.horizon_age}</div>
        <div className="stat-value">{fmtMoney(endNet)}</div>
        <div className="stat-sub">
          {fmtMoney(endWorst)} – {fmtMoney(endBest)}
        </div>
      </div>
      <div className="stat">
        <div className="stat-label">Lifetime taxes</div>
        <div className="stat-value">{fmtMoney(lifetimeTaxes)}</div>
      </div>
      <div className="stat">
        <div className="stat-label">Worst-case ruin</div>
        <div className="stat-value">{everZero ? `Age ${everZero.age}` : '—'}</div>
        <div className="stat-sub">
          {everZero
            ? 'Worst case runs out'
            : `Trough ${fmtMoney(lowAge.balance / 1)} at ${lowAge.age}`}
        </div>
      </div>
    </div>
  );
}
