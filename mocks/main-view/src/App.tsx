import { TopBar } from './components/TopBar';
import { AccountsTree } from './components/AccountsTree';
import { ProjectionView } from './components/ProjectionView';
import { CashFlowChart } from './components/CashFlowChart';
import { EventTimeline } from './components/EventTimeline';
import { Inspector } from './components/Inspector';
import { SummaryStrip } from './components/SummaryStrip';
import './styles.css';

export default function App() {
  return (
    <div className="app">
      <TopBar />
      <div className="layout">
        <AccountsTree />
        <main className="main">
          <SummaryStrip />
          <ProjectionView />
          <CashFlowChart />
          <EventTimeline />
        </main>
        <Inspector />
      </div>
    </div>
  );
}
