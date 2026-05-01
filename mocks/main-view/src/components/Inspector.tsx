import type { ReactNode } from 'react';
import { useAllEvents, useStore } from '../store';
import type {
  AccountNode,
  AccountType,
  ActionTemplate,
  FieldValue,
  FilingStatus,
  TimelineEvent,
} from '../types';
import { resolveSubjectToRmd, resolveTaxTreatment } from '../tax';

const ACCOUNT_TYPE_OPTIONS: Array<{ value: AccountType; label: string }> = [
  { value: 'taxable_brokerage', label: 'Taxable brokerage' },
  { value: 'traditional_401k', label: 'Traditional 401(k) / IRA' },
  { value: 'roth_account', label: 'Roth (IRA / 401k)' },
  { value: 'municipal_bond', label: 'Municipal bond' },
  { value: 'cash', label: 'Cash' },
  { value: 'pension', label: 'Pension (use kind=income)' },
  { value: 'primary_residence', label: 'Primary residence' },
  { value: 'investment_property', label: 'Investment property' },
];

const fmtPct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const fmtMoney = (v: number): string =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

function isExplicit(field: FieldValue): boolean {
  return field !== undefined;
}
function fieldToNumber(field: FieldValue): number | undefined {
  if (field === undefined) return undefined;
  if (typeof field === 'number') return field;
  return field.value;
}

interface NumericFieldProps {
  label: string;
  field: FieldValue;
  inheritedValue: number | undefined;
  format: 'pct' | 'dollars' | 'integer';
  min: number;
  max: number;
  step: number;
  onChange: (next: FieldValue) => void;
}

function NumericField({
  label,
  field,
  inheritedValue,
  format,
  min,
  max,
  step,
  onChange,
}: NumericFieldProps) {
  const explicit = isExplicit(field);
  const fmt =
    format === 'pct'
      ? fmtPct
      : format === 'dollars'
        ? fmtMoney
        : (v: number): string => v.toString();
  const display = explicit
    ? typeof field === 'number'
      ? fmt(field as number)
      : (field as { mode: 'absolute' | 'delta'; value: number }).mode === 'absolute'
        ? fmt((field as { value: number }).value)
        : `inherited ${inheritedValue !== undefined ? fmt(inheritedValue) : '—'} ${(field as { value: number }).value >= 0 ? '+' : ''}${fmt((field as { value: number }).value)}`
    : `inherited ${inheritedValue !== undefined ? fmt(inheritedValue) : '—'}`;
  const value = fieldToNumber(field) ?? inheritedValue ?? 0;
  // Percentages stored as 0–1 floats but displayed as % — for the number
  // input, expose them as percentage values so users type "7" instead of "0.07".
  const isPct = format === 'pct';
  const inputValue = isPct ? Number((value * 100).toFixed(2)) : value;
  const onTypedChange = (v: number): void => {
    onChange(isPct ? v / 100 : v);
  };

  return (
    <div className="ifield">
      <div className="ifield-row">
        <span className="ifield-label">{label}</span>
        <span className={`ifield-value ${explicit ? 'explicit' : 'inherited'}`}>
          {display}
        </span>
      </div>
      <div className="ifield-controls">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <input
          className="ifield-num"
          type="number"
          step={isPct ? 0.1 : step}
          value={inputValue}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onTypedChange(n);
          }}
          aria-label={`${label} value`}
        />
      </div>
      <div className="ifield-actions">
        <label>
          <input
            type="checkbox"
            checked={explicit}
            onChange={(e) => onChange(e.target.checked ? value : undefined)}
          />
          override
        </label>
      </div>
    </div>
  );
}

function inheritedTypedYield(
  accounts: AccountNode[],
  node: AccountNode,
): number | undefined {
  const field =
    node.asset_class === 'equity'
      ? 'equity_yield'
      : node.asset_class === 'bond'
        ? 'bond_yield'
        : node.asset_class === 'cash'
          ? 'cash_yield'
          : node.asset_class === 'real_estate'
            ? 'real_estate_yield'
            : undefined;
  if (!field) return undefined;
  let cur = node.parent_id;
  while (cur) {
    const p = accounts.find((a) => a.id === cur);
    if (!p) break;
    const v = p[field as keyof AccountNode] as FieldValue;
    if (typeof v === 'number') return v;
    if (v && typeof v === 'object' && 'value' in v) return v.value;
    cur = p.parent_id;
  }
  return undefined;
}

function AccountInspector({ node }: { node: AccountNode }) {
  const accounts = useStore((s) => s.accounts);
  const setAccountField = useStore((s) => s.setAccountField);
  const removeAccount = useStore((s) => s.removeAccount);
  const household = useStore((s) => s.household);
  const setHouseholdField = useStore((s) => s.setHouseholdField);
  const parent = accounts.find((a) => a.id === node.parent_id);
  const inheritedYield = inheritedTypedYield(accounts, node);
  const isActiveJurisdiction = household.jurisdiction_account_id === node.id;
  const isJurisdictionCandidate =
    node.kind === 'ambient' && node.effective_tax_rate !== undefined;

  const onDelete = (): void => {
    if (!confirm(`Delete "${node.name}"?`)) return;
    const r = removeAccount(node.id);
    if (!r.ok) alert(`Cannot delete: ${r.reason}`);
  };

  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <div className="i-kind-row">
          <span className="i-kind">
            {node.kind}
            {node.custodian ? <span className="i-custodian"> · {node.custodian}</span> : null}
          </span>
          <button className="i-delete" onClick={onDelete} title="Delete account">
            Delete
          </button>
        </div>
        <input
          className="i-title"
          value={node.name}
          onChange={(e) => setAccountField(node.id, 'name', e.target.value)}
        />
        {parent && (
          <div className="i-parent">
            inside <span className="muted">{parent.name}</span>
          </div>
        )}
      </div>

      {isJurisdictionCandidate && (
        <div className="jurisdiction-banner">
          {isActiveJurisdiction ? (
            <span className="jurisdiction-active">✓ Active jurisdiction</span>
          ) : (
            <button
              className="add-btn"
              onClick={() => setHouseholdField('jurisdiction_account_id', node.id)}
            >
              Set as active jurisdiction
            </button>
          )}
          <span className="muted small">
            Used for tax calculations on income, conversions, and withdrawals.
          </span>
        </div>
      )}

      {household.actors.length > 1 &&
        (node.kind === 'asset' || node.kind === 'income' || node.kind === 'expense' || node.kind === 'liability') && (
        <div className="ifield">
          <div className="ifield-row">
            <span className="ifield-label">Owners</span>
            <span className={`ifield-value ${node.owners ? 'explicit' : 'inherited'}`}>
              {node.owners
                ? node.owners
                    .map((id) => household.actors.find((a) => a.id === id)?.name ?? id)
                    .join(', ')
                : `default (${household.actors.find((a) => a.id === household.primary_actor_id)?.name ?? 'primary'})`}
            </span>
          </div>
          <div className="i-attach-list">
            {household.actors.map((p) => {
              const owners = node.owners ?? [household.primary_actor_id];
              const checked = owners.includes(p.id);
              return (
                <label key={p.id} className={`attach-row ${checked ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = checked
                        ? owners.filter((o) => o !== p.id)
                        : [...owners, p.id];
                      // Empty → clear back to undefined (= default).
                      setAccountField(
                        node.id,
                        'owners',
                        next.length === 0 ? undefined : next,
                      );
                    }}
                    aria-label={`${p.name} owner`}
                  />
                  <span className="attach-name">{p.name}</span>
                  {!p.alive && <span className="attach-kind muted">deceased</span>}
                </label>
              );
            })}
          </div>
          <p className="muted small" style={{ marginTop: 4 }}>
            For streams: drives whose age applies to start/end. For
            tax-deferred assets: drives the RMD schedule. Multiple
            checked = joint ownership (assets only).
          </p>
        </div>
      )}

      {node.kind === 'asset' && (
        <>
          <div className="ifield">
            <div className="ifield-row">
              <span className="ifield-label">Account type</span>
              <span className={`ifield-value ${node.account_type ? 'explicit' : 'inherited'}`}>
                {(() => {
                  const tt = resolveTaxTreatment(node);
                  const rmd = resolveSubjectToRmd(node);
                  return tt ? `${tt}${rmd ? ' · RMD' : ''}` : 'unset';
                })()}
              </span>
            </div>
            <select
              className="i-select"
              value={node.account_type ?? ''}
              onChange={(e) =>
                setAccountField(
                  node.id,
                  'account_type',
                  (e.target.value || undefined) as AccountType | undefined,
                )
              }
              aria-label="Account type"
            >
              <option value="">— unset —</option>
              {ACCOUNT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="muted small" style={{ marginTop: 4 }}>
              Drives derived <code>tax_treatment</code> and RMD eligibility. Override
              via the explicit fields below if needed.
            </p>
          </div>
          <div className="ifield">
            <div className="ifield-row">
              <span className="ifield-label">Custodian / tag</span>
            </div>
            <input
              className="i-text"
              type="text"
              placeholder="e.g. Schwab, Fidelity 401(k), Vanguard Roth"
              value={node.custodian ?? ''}
              onChange={(e) =>
                setAccountField(node.id, 'custodian', e.target.value || undefined)
              }
            />
          </div>
          <NumericField
            label="Start value"
            field={node.start_value}
            inheritedValue={undefined}
            format="dollars"
            min={0}
            max={5_000_000}
            step={1000}
            onChange={(v) =>
              setAccountField(node.id, 'start_value', v as number | undefined)
            }
          />
          {node.cost_basis !== undefined && node.asset_class !== 'cash' && (
            <NumericField
              label="Cost basis"
              field={node.cost_basis}
              inheritedValue={undefined}
              format="dollars"
              min={0}
              max={5_000_000}
              step={1000}
              onChange={(v) =>
                setAccountField(node.id, 'cost_basis', v as number | undefined)
              }
            />
          )}
          <NumericField
            label={`Yield (${node.asset_class ?? '?'})`}
            field={node.yield_rate}
            inheritedValue={inheritedYield}
            format="pct"
            min={-0.05}
            max={0.15}
            step={0.005}
            onChange={(v) => setAccountField(node.id, 'yield_rate', v)}
          />
        </>
      )}

      {node.kind === 'ambient' && (
        <>
          {(['equity_yield', 'bond_yield', 'cash_yield', 'real_estate_yield'] as const)
            .filter((k) => node[k] !== undefined)
            .map((k) => (
              <NumericField
                key={k}
                label={k.replace('_', ' ')}
                field={node[k]}
                inheritedValue={undefined}
                format="pct"
                min={-0.02}
                max={0.15}
                step={0.005}
                onChange={(v) => setAccountField(node.id, k, v)}
              />
            ))}
          {node.inflation_rate !== undefined && (
            <NumericField
              label="Inflation"
              field={node.inflation_rate}
              inheritedValue={undefined}
              format="pct"
              min={0}
              max={0.1}
              step={0.005}
              onChange={(v) => setAccountField(node.id, 'inflation_rate', v)}
            />
          )}
          {node.effective_tax_rate !== undefined && (
            <NumericField
              label="Effective tax rate"
              field={node.effective_tax_rate}
              inheritedValue={undefined}
              format="pct"
              min={0}
              max={0.5}
              step={0.005}
              onChange={(v) => setAccountField(node.id, 'effective_tax_rate', v)}
            />
          )}
        </>
      )}

      {(node.kind === 'income' || node.kind === 'expense') && (
        <>
          <NumericField
            label="Annual amount"
            field={node.annual_amount}
            inheritedValue={undefined}
            format="dollars"
            min={0}
            max={500000}
            step={1000}
            onChange={(v) =>
              setAccountField(node.id, 'annual_amount', v as number | undefined)
            }
          />
          <NumericField
            label="Annual growth rate"
            field={node.growth_rate}
            inheritedValue={undefined}
            format="pct"
            min={-0.05}
            max={0.1}
            step={0.0025}
            onChange={(v) => setAccountField(node.id, 'growth_rate', v)}
          />
          {node.start_age !== undefined && (
            <NumericField
              label="Start age"
              field={node.start_age}
              inheritedValue={undefined}
              format="integer"
              min={50}
              max={100}
              step={1}
              onChange={(v) =>
                setAccountField(node.id, 'start_age', v as number | undefined)
              }
            />
          )}
          {node.end_age !== undefined && (
            <NumericField
              label="End age"
              field={node.end_age}
              inheritedValue={undefined}
              format="integer"
              min={50}
              max={100}
              step={1}
              onChange={(v) =>
                setAccountField(node.id, 'end_age', v as number | undefined)
              }
            />
          )}
          {node.kind === 'expense' && (
            <div className="ifield">
              <div className="ifield-row">
                <span className="ifield-label">Tax deductible</span>
                <span className={`ifield-value ${node.tax_deductible ? 'explicit' : 'inherited'}`}>
                  {node.tax_deductible ? 'yes' : 'no'}
                </span>
              </div>
              <div className="ifield-actions">
                <label>
                  <input
                    type="checkbox"
                    checked={node.tax_deductible ?? false}
                    onChange={(e) =>
                      setAccountField(node.id, 'tax_deductible', e.target.checked || undefined)
                    }
                  />
                  reduces ordinary taxable income
                </label>
              </div>
              <p className="muted small" style={{ marginTop: 4 }}>
                For mortgage interest, charitable giving, etc. V1 treats this as a
                dollar-for-dollar reduction; standard-vs-itemized isn't modeled.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function EventInspector({ event }: { event: TimelineEvent }) {
  const accounts = useStore((s) => s.accounts);
  const setEventName = useStore((s) => s.setEventName);
  const setEventAge = useStore((s) => s.setEventAge);
  const setEventParam = useStore((s) => s.setEventParam);
  const toggleAttachment = useStore((s) => s.toggleEventAttachment);
  const removeEvent = useStore((s) => s.removeEvent);
  const select = useStore((s) => s.select);
  const isRange = event.end_age !== undefined && event.end_age !== event.trigger_age;

  if (event.auto_generated) {
    const sourceId = event.attached_account_ids[0];
    const source = sourceId ? accounts.find((a) => a.id === sourceId) : undefined;
    const actionType = event.actions[0]?.type;
    return (
      <div className="inspector-body">
        <div className="inspector-head">
          <div className="i-kind-row">
            <span className="i-kind">
              {event.kind} <span className="i-custodian">· auto-generated</span>
            </span>
          </div>
          <div className="i-title-readonly">{event.name}</div>
          {event.description && <p className="i-desc">{event.description}</p>}
        </div>
        <div className="ifield-row">
          <span className="ifield-label">Trigger age</span>
          <span className="ifield-value explicit">
            {event.trigger_age}
            {event.end_age !== undefined && event.end_age !== event.trigger_age
              ? `–${event.end_age}`
              : ''}
          </span>
        </div>
        {source && (
          <button
            className="add-btn full"
            onClick={() => select({ kind: 'account', id: source.id })}
          >
            Open source account → {source.name}
          </button>
        )}
        {actionType === 'rmd' ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            Auto-generated for any account whose derived <code>subject_to_rmd</code> is
            true (typically traditional 401(k)/IRA). To suppress, set
            <code> subject_to_rmd: false</code> on the source account.
          </p>
        ) : (
          <p className="muted small" style={{ marginTop: 8 }}>
            To change when this fires, edit the source account's <code>end_age</code>.
            To remove it, clear that field. To customize behavior, create a separate event.
          </p>
        )}
      </div>
    );
  }

  const onDelete = (): void => {
    if (!confirm(`Delete event "${event.name}"?`)) return;
    removeEvent(event.id);
  };

  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <div className="i-kind-row">
          <span className="i-kind">
            {event.kind}
            {event.auto_generated ? <span className="i-custodian"> · auto-generated</span> : null}
          </span>
          <button className="i-delete" onClick={onDelete} title="Delete event">
            Delete
          </button>
        </div>
        <input
          className="i-title"
          value={event.name}
          onChange={(e) => setEventName(event.id, e.target.value)}
        />
        {event.description && <p className="i-desc">{event.description}</p>}
      </div>

      <div className="ifield">
        <div className="ifield-row">
          <span className="ifield-label">Trigger age</span>
          <span className="ifield-value explicit">{event.trigger_age}</span>
        </div>
        <input
          type="range"
          min={50}
          max={100}
          step={1}
          value={event.trigger_age}
          onChange={(e) =>
            setEventAge(event.id, Number(e.target.value), event.end_age)
          }
        />
      </div>

      {isRange && event.end_age !== undefined && (
        <div className="ifield">
          <div className="ifield-row">
            <span className="ifield-label">End age</span>
            <span className="ifield-value explicit">{event.end_age}</span>
          </div>
          <input
            type="range"
            min={event.trigger_age}
            max={100}
            step={1}
            value={event.end_age}
            onChange={(e) =>
              setEventAge(event.id, event.trigger_age, Number(e.target.value))
            }
          />
        </div>
      )}

      {Object.keys(event.parameters).length > 0 && (
        <>
          <div className="i-section-h">Parameters (shared across attachments)</div>
          {Object.entries(event.parameters).map(([k, v]) => (
            <div key={k} className="ifield">
              <div className="ifield-row">
                <span className="ifield-label">{k}</span>
                <span className="ifield-value explicit">
                  {Math.abs(v) < 1 ? `${(v * 100).toFixed(1)}%` : fmtMoney(v)}
                </span>
              </div>
              <input
                type="range"
                min={Math.abs(v) < 1 ? -0.5 : 0}
                max={Math.abs(v) < 1 ? 0.5 : 200000}
                step={Math.abs(v) < 1 ? 0.01 : 1000}
                value={v}
                onChange={(e) => setEventParam(event.id, k, Number(e.target.value))}
              />
            </div>
          ))}
        </>
      )}

      <div className="i-section-h">
        Attached accounts ({event.attached_account_ids.length})
      </div>
      <div className="i-attach-list">
        {accounts
          .filter((a) => a.kind !== 'category')
          .map((a) => {
            const checked = event.attached_account_ids.includes(a.id);
            return (
              <label key={a.id} className={`attach-row ${checked ? 'on' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAttachment(event.id, a.id)}
                />
                <span className="attach-name">{a.name}</span>
                <span className="attach-kind">{a.kind}</span>
              </label>
            );
          })}
      </div>

      <div className="i-section-h">Actions</div>
      <ActionsEditor event={event} />
    </div>
  );
}

function ActionsEditor({ event }: { event: TimelineEvent }) {
  const accounts = useStore((s) => s.accounts);
  const household = useStore((s) => s.household);
  const setActionField = useStore((s) => s.setActionField);
  const addAction = useStore((s) => s.addAction);
  const removeAction = useStore((s) => s.removeAction);

  const ambientNodes = accounts.filter((a) => a.kind === 'ambient');
  const actionableTargets = accounts.filter(
    (a) => a.kind === 'asset' || a.kind === 'income' || a.kind === 'expense' || a.kind === 'liability',
  );

  return (
    <div className="actions-editor">
      {event.actions.map((a, i) => (
        <div key={i} className="action-card">
          <div className="action-card-head">
            <select
              value={a.type}
              onChange={(e) =>
                setActionField(event.id, i, {
                  type: e.target.value as ActionTemplate['type'],
                })
              }
            >
              <option value="liquidate">liquidate</option>
              <option value="transfer">transfer</option>
              <option value="add_value">add_value</option>
              <option value="set_value">set_value</option>
              <option value="reparent">reparent</option>
              <option value="end_account">end_account</option>
              <option value="rmd">rmd</option>
              <option value="death">death</option>
            </select>
            <button
              className="action-remove"
              onClick={() => removeAction(event.id, i)}
              aria-label="Remove action"
            >
              ×
            </button>
          </div>
          <div className="action-card-body">
            {(a.type === 'transfer') && (
              <>
                <label>
                  <span>Destination account</span>
                  <select
                    value={a.target_account ?? ''}
                    onChange={(e) =>
                      setActionField(event.id, i, { target_account: e.target.value })
                    }
                  >
                    <option value="">— pick —</option>
                    {actionableTargets.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({acc.kind})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Param to read</span>
                  <select
                    value={a.param_ref ?? ''}
                    onChange={(e) =>
                      setActionField(event.id, i, { param_ref: e.target.value })
                    }
                  >
                    <option value="">— constant —</option>
                    {Object.keys(event.parameters).map((k) => (
                      <option key={k} value={k}>
                        ${k}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {(a.type === 'add_value' || a.type === 'set_value') && (
              <>
                <label>
                  <span>Field</span>
                  <select
                    value={a.field ?? ''}
                    onChange={(e) =>
                      setActionField(event.id, i, { field: e.target.value })
                    }
                  >
                    <option value="">— pick —</option>
                    <option value="start_value">start_value (balance)</option>
                    <option value="annual_amount">annual_amount</option>
                  </select>
                </label>
                <label>
                  <span>Param to read</span>
                  <select
                    value={a.param_ref ?? ''}
                    onChange={(e) =>
                      setActionField(event.id, i, { param_ref: e.target.value })
                    }
                  >
                    <option value="">— constant —</option>
                    {Object.keys(event.parameters).map((k) => (
                      <option key={k} value={k}>
                        ${k}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {a.type === 'reparent' && (
              <label>
                <span>New jurisdiction</span>
                <select
                  value={a.new_parent ?? ''}
                  onChange={(e) =>
                    setActionField(event.id, i, { new_parent: e.target.value })
                  }
                >
                  <option value="">— pick —</option>
                  {ambientNodes.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {a.type === 'liquidate' && (
              <p className="action-hint muted small">
                Acts on the event's attached accounts. Sells assets and deposits net proceeds into cash.
              </p>
            )}
            {a.type === 'end_account' && (
              <p className="action-hint muted small">
                Marks attached income/expense accounts as inactive at the trigger age.
              </p>
            )}
            {a.type === 'rmd' && (
              <p className="action-hint muted small">
                Withdraws the IRS Uniform Lifetime amount (balance ÷ age divisor)
                from the attached tax-deferred account each year. Auto-generated
                for traditional 401(k)/IRA accounts; rarely added by hand.
              </p>
            )}
            {a.type === 'death' && (
              <>
                <label>
                  <span>Who dies?</span>
                  <select
                    value={a.actor_id ?? ''}
                    onChange={(e) =>
                      setActionField(event.id, i, { actor_id: e.target.value || undefined })
                    }
                    aria-label="Death actor"
                  >
                    <option value="">— pick —</option>
                    {household.actors.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="action-hint muted small">
                  Marks the actor inactive at trigger age. Surviving spouse
                  inherits the decedent's assets (tax-free spousal rollover).
                  Filing status flips MFJ → single from this age forward.
                </p>
              </>
            )}
          </div>
        </div>
      ))}
      <button className="add-btn full" onClick={() => addAction(event.id)}>
        + Add action
      </button>
    </div>
  );
}

function ActorInspector() {
  const household = useStore((s) => s.household);
  const accounts = useStore((s) => s.accounts);
  const setHouseholdField = useStore((s) => s.setHouseholdField);
  const setActorField = useStore((s) => s.setActorField);
  const addActor = useStore((s) => s.addActor);
  const removeActor = useStore((s) => s.removeActor);

  const primary = household.actors.find((a) => a.id === household.primary_actor_id) ?? household.actors[0];

  const cashCandidates = accounts.filter(
    (a) => a.kind === 'asset' && (a.asset_class === 'cash' || a.id === household.cash_account_id),
  );
  const jurisdictionCandidates = accounts.filter(
    (a) =>
      a.kind === 'ambient' &&
      (a.effective_tax_rate !== undefined || a.id === household.jurisdiction_account_id),
  );

  const onAddSpouse = (): void => {
    addActor('Spouse', 60);
    if (household.filing_status !== 'mfj') setHouseholdField('filing_status', 'mfj');
  };

  return (
    <div className="inspector-body">
      <div className="inspector-head">
        <div className="i-kind">scenario</div>
        <input
          className="i-title"
          value={household.scenario_name}
          onChange={(e) => setHouseholdField('scenario_name', e.target.value)}
        />
      </div>
      <div className="i-section-h">Household ({household.actors.length})</div>
      {household.actors.map((p) => (
        <div key={p.id} className="ifield">
          <div className="ifield-row">
            <span className="ifield-label">
              {p.id === household.primary_actor_id ? 'Primary' : 'Spouse'}
              {!p.alive && <span className="muted small"> · deceased</span>}
            </span>
            {p.id !== household.primary_actor_id && (
              <button
                className="i-delete"
                onClick={() => {
                  if (!confirm(`Remove ${p.name}?`)) return;
                  const r = removeActor(p.id);
                  if (!r.ok) alert(`Cannot remove: ${r.reason}`);
                }}
              >
                Remove
              </button>
            )}
          </div>
          <input
            className="i-text"
            type="text"
            value={p.name}
            onChange={(e) => setActorField(p.id, 'name', e.target.value)}
            aria-label={`${p.id === household.primary_actor_id ? 'Primary' : 'Spouse'} name`}
          />
          <div className="ifield-controls">
            <input
              type="range"
              min={18}
              max={110}
              step={1}
              value={p.current_age}
              onChange={(e) => setActorField(p.id, 'current_age', Number(e.target.value))}
            />
            <input
              className="ifield-num"
              type="number"
              step={1}
              value={p.current_age}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setActorField(p.id, 'current_age', n);
              }}
              aria-label={`${p.name} current age`}
            />
          </div>
        </div>
      ))}
      {household.actors.length === 1 && (
        <button className="add-btn full" onClick={onAddSpouse}>
          + Add spouse
        </button>
      )}
      <div className="i-section-h">Plan settings</div>
      <NumericField
        label="Horizon age"
        field={household.horizon_age}
        inheritedValue={undefined}
        format="integer"
        min={primary.current_age + 1}
        max={130}
        step={1}
        onChange={(v) =>
          setHouseholdField('horizon_age', (v as number | undefined) ?? household.horizon_age)
        }
      />
      <div className="ifield">
        <div className="ifield-row">
          <span className="ifield-label">Filing status</span>
          <span className="ifield-value explicit">{household.filing_status ?? 'single'}</span>
        </div>
        <select
          className="i-select"
          value={household.filing_status ?? 'single'}
          onChange={(e) =>
            setHouseholdField('filing_status', e.target.value as FilingStatus)
          }
          aria-label="Filing status"
        >
          <option value="single">Single</option>
          <option value="mfj">Married filing jointly</option>
        </select>
        <p className="muted small" style={{ marginTop: 4 }}>
          Selects which bracket table is used on the active jurisdiction's
          federal/state schedules. A death event flips MFJ → single
          automatically from that age forward.
        </p>
      </div>
      <div className="ifield">
        <div className="ifield-row">
          <span className="ifield-label">Cash sink</span>
        </div>
        <select
          className="i-select"
          value={household.cash_account_id}
          onChange={(e) => setHouseholdField('cash_account_id', e.target.value)}
        >
          {cashCandidates.length === 0 && (
            <option value={household.cash_account_id}>(missing — pick a cash account)</option>
          )}
          {cashCandidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ifield">
        <div className="ifield-row">
          <span className="ifield-label">Active jurisdiction</span>
        </div>
        <select
          className="i-select"
          value={household.jurisdiction_account_id}
          onChange={(e) => setHouseholdField('jurisdiction_account_id', e.target.value)}
        >
          {jurisdictionCandidates.length === 0 && (
            <option value={household.jurisdiction_account_id}>
              (no jurisdictions — create an ambient with effective_tax_rate)
            </option>
          )}
          {jurisdictionCandidates.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <p className="muted small" style={{ marginTop: 4 }}>
          The selected jurisdiction's <code>effective_tax_rate</code> applies to ordinary
          income and (proxy-multiplied) to LTCG. Use a <code>reparent</code> event to
          change it later in life.
        </p>
      </div>
    </div>
  );
}

export function Inspector() {
  const selection = useStore((s) => s.selection);
  const accounts = useStore((s) => s.accounts);
  const events = useAllEvents();

  let body: ReactNode;
  let title = 'Inspector';

  if (selection.kind === 'account') {
    const node = accounts.find((a) => a.id === selection.id);
    if (!node) {
      body = <div className="empty">Account not found.</div>;
    } else {
      body = <AccountInspector node={node} />;
      title = node.kind === 'ambient' ? 'Ambient' : 'Account';
    }
  } else if (selection.kind === 'event') {
    const e = events.find((x) => x.id === selection.id);
    if (!e) {
      body = <div className="empty">Event not found.</div>;
    } else {
      body = <EventInspector event={e} />;
      title = 'Event';
    }
  } else if (selection.kind === 'actor') {
    body = <ActorInspector />;
    title = 'Plan settings';
  } else {
    body = (
      <div className="empty">
        Click an account on the left, an event below, or "Plan settings" at the
        top of the tree to inspect.
      </div>
    );
  }

  return (
    <aside className="right-panel">
      <h3 className="panel-title">{title}</h3>
      {body}
    </aside>
  );
}
