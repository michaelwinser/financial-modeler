import { useState } from 'react';
import { useAllEvents, useStore } from '../store';
import type { ActionTemplate, TimelineEvent } from '../types';

const fmtMoney = (v: number): string =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

function summarize(e: TimelineEvent): string {
  const ageRange =
    e.end_age && e.end_age !== e.trigger_age
      ? `ages ${e.trigger_age}–${e.end_age}`
      : `age ${e.trigger_age}`;
  if (e.actions.length === 0) return `no actions yet, ${ageRange}`;
  if (e.actions[0].type === 'transfer') {
    const amt = e.parameters[e.actions[0].param_ref ?? ''];
    return `transfer ${amt ? fmtMoney(amt) : ''} → ${e.actions[0].target_account ?? '?'}, ${ageRange}`;
  }
  if (e.actions[0].type === 'liquidate') return `liquidate, ${ageRange}`;
  if (e.actions[0].type === 'reparent')
    return `reparent → ${e.actions[0].new_parent}, ${ageRange}`;
  if (e.actions[0].type === 'add_value') {
    const amt = e.parameters[e.actions[0].param_ref ?? ''];
    return `${amt !== undefined ? `${(amt * 100).toFixed(0)}%` : ''} shock to ${e.attached_account_ids.length} accounts, ${ageRange}`;
  }
  if (e.actions[0].type === 'end_account') return `end account, ${ageRange}`;
  if (e.actions[0].type === 'set_value') return `set ${e.actions[0].field ?? '?'}, ${ageRange}`;
  return ageRange;
}

const actionOptions: Array<{
  type: ActionTemplate['type'];
  label: string;
  description: string;
}> = [
  { type: 'liquidate', label: 'Liquidate', description: 'sell an asset, deposit proceeds to cash' },
  { type: 'transfer', label: 'Transfer', description: 'move money between accounts (e.g. Roth conversion)' },
  { type: 'add_value', label: 'Shock / adjust', description: 'apply a % shock or flat add to a balance' },
  { type: 'set_value', label: 'Set value', description: 'overwrite a field on an account' },
  { type: 'reparent', label: 'Reparent', description: 'change actor jurisdiction (e.g. state move)' },
  { type: 'end_account', label: 'End stream', description: 'stop an income/expense at this age' },
];

export function EventTimeline(): JSX.Element {
  const events = useAllEvents();
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const setHovered = useStore((s) => s.setHoveredEvent);
  const hoveredId = useStore((s) => s.hoveredEventId);
  const addEvent = useStore((s) => s.addEvent);
  const [pickerKind, setPickerKind] = useState<'one_shot' | 'recurring' | null>(null);

  const sorted = [...events].sort((a, b) => a.trigger_age - b.trigger_age);
  const isSel = (id: string): boolean =>
    selection.kind === 'event' && selection.id === id;

  const onPickAction = (type: ActionTemplate['type']): void => {
    if (!pickerKind) return;
    addEvent(pickerKind, type);
    setPickerKind(null);
  };

  return (
    <section className="evt-list">
      <div className="evt-list-head">
        <span>Timeline events ({events.length})</span>
        <div className="evt-add-controls">
          {pickerKind === null ? (
            <>
              <span className="muted small">click a row to inspect & edit</span>
              <button className="add-btn" onClick={() => setPickerKind('one_shot')}>
                + One-shot
              </button>
              <button className="add-btn" onClick={() => setPickerKind('recurring')}>
                + Recurring
              </button>
            </>
          ) : (
            <>
              <span className="muted small">pick an action for the new {pickerKind} event:</span>
              <button className="add-btn" onClick={() => setPickerKind(null)}>
                ×
              </button>
            </>
          )}
        </div>
      </div>
      {pickerKind && (
        <div className="action-picker">
          {actionOptions.map((opt) => (
            <button
              key={opt.type}
              className="action-option"
              onClick={() => onPickAction(opt.type)}
            >
              <span className="action-option-label">{opt.label}</span>
              <span className="action-option-desc">{opt.description}</span>
            </button>
          ))}
        </div>
      )}
      <div className="evt-rows">
        {sorted.map((e) => (
          <button
            key={e.id}
            className={`evt-row-summary ${isSel(e.id) ? 'on' : ''} ${hoveredId === e.id ? 'hovered' : ''}`}
            onClick={() => select({ kind: 'event', id: e.id })}
            onMouseEnter={() => setHovered(e.id)}
            onMouseLeave={() => setHovered(null)}
          >
            <span className={`evt-row-dot ${e.kind}`} />
            <span className="evt-row-age">
              {e.trigger_age}
              {e.end_age && e.end_age !== e.trigger_age ? `–${e.end_age}` : ''}
            </span>
            <span className="evt-row-name">
              {e.name}
              {e.auto_generated ? <span className="evt-auto"> ✱</span> : null}
            </span>
            <span className="evt-row-summ muted small">{summarize(e)}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
