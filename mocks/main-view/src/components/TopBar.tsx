import { useRef, useState } from 'react';
import { exportScenarioJson, importScenarioJson, useStore } from '../store';

export function TopBar(): JSX.Element {
  const dollarMode = useStore((s) => s.dollarMode);
  const toggle = useStore((s) => s.toggleDollarMode);
  const scenarioName = useStore((s) => s.actor.scenario_name);
  const newBlankScenario = useStore((s) => s.newBlankScenario);
  const resetToSeed = useStore((s) => s.resetToSeed);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showNewMenu, setShowNewMenu] = useState(false);

  const onNewBlank = (): void => {
    setShowNewMenu(false);
    if (!confirm('Replace current scenario with an empty scenario? This cannot be undone (export first if you want a backup).')) return;
    newBlankScenario();
  };

  const onResetDemo = (): void => {
    setShowNewMenu(false);
    if (!confirm('Replace current scenario with the demo data? This cannot be undone.')) return;
    resetToSeed();
  };

  const onExport = (): void => {
    const json = exportScenarioJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safe = scenarioName.replace(/[^a-z0-9-]+/gi, '_').toLowerCase();
    a.href = url;
    a.download = `${safe || 'scenario'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onImportClick = (): void => {
    fileInputRef.current?.click();
  };

  const onImportFile = async (e: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (
      !confirm(
        `Replace the current scenario with the contents of "${file.name}"? This cannot be undone.`,
      )
    )
      return;
    const text = await file.text();
    const r = importScenarioJson(text);
    if (!r.ok) alert(`Could not import: ${r.reason}`);
  };

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark">FM</span>
        <span className="brand-name">Financial Modeler</span>
        <span className="scenario-name">{scenarioName}</span>
      </div>
      <div className="topbar-right">
        <div className="toggle">
          <button
            className={dollarMode === 'nominal' ? 'on' : ''}
            onClick={() => dollarMode !== 'nominal' && toggle()}
          >
            Nominal $
          </button>
          <button
            className={dollarMode === 'real' ? 'on' : ''}
            onClick={() => dollarMode !== 'real' && toggle()}
          >
            Today's $
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={onImportFile}
          style={{ display: 'none' }}
        />
        <div className="new-menu-wrap">
          <button
            className="btn-ghost"
            onClick={() => setShowNewMenu((v) => !v)}
            title="Start a new scenario"
          >
            New ▾
          </button>
          {showNewMenu && (
            <div className="new-menu" onMouseLeave={() => setShowNewMenu(false)}>
              <button onClick={onNewBlank}>
                <span className="new-menu-title">Blank scenario</span>
                <span className="new-menu-desc">Empty plan — add your own accounts</span>
              </button>
              <button onClick={onResetDemo}>
                <span className="new-menu-title">Reset to demo</span>
                <span className="new-menu-desc">Restore the pre-retirement sample household</span>
              </button>
            </div>
          )}
        </div>
        <button className="btn-ghost" onClick={onImportClick} title="Replace current scenario from a JSON file">
          Import
        </button>
        <button className="btn-ghost" onClick={onExport} title="Download current scenario as JSON">
          Export
        </button>
        <button className="btn-ghost" disabled title="Multi-scenario compare ships in Phase 3">
          Compare…
        </button>
      </div>
    </header>
  );
}
