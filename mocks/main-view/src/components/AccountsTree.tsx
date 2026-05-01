import { useState } from 'react';
import { useStore } from '../store';
import type { AccountKind, AccountNode } from '../types';

const fmtMoney = (v: number): string =>
  v.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

const kindBadge: Record<AccountNode['kind'], { label: string; color: string }> = {
  category: { label: 'group', color: '#6c7886' },
  ambient: { label: 'ambient', color: '#c084fc' },
  asset: { label: 'asset', color: '#3a82f6' },
  liability: { label: 'debt', color: '#f87171' },
  income: { label: 'income', color: '#4ade80' },
  expense: { label: 'expense', color: '#f5b342' },
};

const kindOptions: AccountKind[] = ['asset', 'income', 'expense', 'ambient'];

export function AccountsTree() {
  const accounts = useStore((s) => s.accounts);
  const household = useStore((s) => s.household);
  const expanded = useStore((s) => s.expandedNodes);
  const toggleExpanded = useStore((s) => s.toggleExpanded);
  const selection = useStore((s) => s.selection);
  const select = useStore((s) => s.select);
  const addAccount = useStore((s) => s.addAccount);
  const [showPicker, setShowPicker] = useState(false);

  // Owner-badge helper: only meaningful in 2+ actor households, and
  // only renders when the account specifies a non-default owner.
  const ownerBadge = (node: AccountNode): string | null => {
    if (household.actors.length < 2) return null;
    const owners = node.owners;
    if (!owners || owners.length === 0) return null;
    return owners
      .map((id) => household.actors.find((a) => a.id === id)?.name ?? id)
      .join(' + ');
  };

  const childrenOf = (parentId: string | null): AccountNode[] =>
    accounts.filter((a) => a.parent_id === parentId);

  const renderNode = (node: AccountNode, depth: number) => {
    const kids = childrenOf(node.id);
    const hasKids = kids.length > 0;
    const isExpanded = expanded.has(node.id);
    const isSelected = selection.kind === 'account' && selection.id === node.id;
    const badge = kindBadge[node.kind];

    return (
      <div key={node.id}>
        <div
          className={`tree-row ${isSelected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          onClick={() => select({ kind: 'account', id: node.id })}
        >
          <span
            className="tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              if (hasKids) toggleExpanded(node.id);
            }}
          >
            {hasKids ? (isExpanded ? '▾' : '▸') : ''}
          </span>
          <span className="tree-name">{node.name}</span>
          <span
            className="tree-badge"
            style={{ color: badge.color, borderColor: badge.color + '55' }}
          >
            {badge.label}
          </span>
          {(() => {
            const ob = ownerBadge(node);
            return ob ? <span className="tree-badge tree-badge-owner">{ob}</span> : null;
          })()}
          {node.kind === 'asset' && node.start_value !== undefined ? (
            <span className="tree-value">{fmtMoney(node.start_value)}</span>
          ) : node.kind === 'income' || node.kind === 'expense' ? (
            <span className="tree-value">
              {node.annual_amount ? fmtMoney(node.annual_amount) + '/yr' : ''}
            </span>
          ) : node.kind === 'ambient' ? (
            <span className="tree-value">
              {node.yield_rate !== undefined && typeof node.yield_rate === 'number'
                ? `${(node.yield_rate * 100).toFixed(1)}%`
                : node.inflation_rate !== undefined &&
                    typeof node.inflation_rate === 'number'
                  ? `${(node.inflation_rate * 100).toFixed(1)}%`
                  : node.effective_tax_rate !== undefined &&
                      typeof node.effective_tax_rate === 'number'
                    ? `${(node.effective_tax_rate * 100).toFixed(0)}%`
                    : ''}
            </span>
          ) : null}
        </div>
        {hasKids && isExpanded && kids.map((k) => renderNode(k, depth + 1))}
      </div>
    );
  };

  const roots = accounts.filter((a) => a.parent_id === null);

  const onPick = (kind: AccountKind): void => {
    addAccount(kind, kind === 'ambient' ? null : 'us_economy');
    setShowPicker(false);
  };

  const planSelected = selection.kind === 'actor';

  return (
    <aside className="left-panel">
      <div className="panel-head">
        <h3 className="panel-title">Accounts</h3>
        <button
          className="add-btn"
          onClick={() => setShowPicker((v) => !v)}
          aria-label="Add account"
        >
          {showPicker ? '×' : '+ Add'}
        </button>
      </div>
      {showPicker && (
        <div className="kind-picker">
          {kindOptions.map((k) => {
            const b = kindBadge[k];
            return (
              <button
                key={k}
                className="kind-option"
                style={{ borderColor: b.color + '55', color: b.color }}
                onClick={() => onPick(k)}
              >
                + {b.label}
              </button>
            );
          })}
        </div>
      )}
      <div
        className={`tree-row plan-row ${planSelected ? 'selected' : ''}`}
        onClick={() => select({ kind: 'actor' })}
      >
        <span className="tree-toggle"> </span>
        <span className="tree-name">Plan settings</span>
        <span className="tree-badge" style={{ color: '#9aa6b2', borderColor: '#2a3441' }}>
          actor
        </span>
      </div>
      <div className="tree">{roots.map((r) => renderNode(r, 0))}</div>
      <div className="tree-help">
        Click any node to inspect & edit. Inheritance flows from parent to child.
      </div>
    </aside>
  );
}
