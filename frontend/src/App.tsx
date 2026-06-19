import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, NavLink, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Overview from './pages/Overview';
import Vendors from './pages/Vendors';
import ScriptHealth from './pages/ScriptHealth';
import Team from './pages/Team';
import { useHealth, useScriptHealth } from './hooks/useAnalytics';
import { IconPulse, IconStore, IconShield, IconUsers, IconBolt } from './components/Icons';

const qc = new QueryClient();

const NAV = [
  { to: '/', label: 'Overview', icon: IconPulse, title: 'Overview' },
  { to: '/vendors', label: 'Vendors', icon: IconStore, title: 'Vendors' },
  { to: '/health', label: 'Script Health', icon: IconShield, title: 'Script Health' },
  { to: '/team', label: 'Team', icon: IconUsers, title: 'Booking Team' },
];

function Sidebar() {
  const { data: scripts } = useScriptHealth();
  const failing = (scripts ?? []).filter((s) => s.status === 'FAILING').length;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark"><IconBolt size={17} /></span>
        <div>
          <div className="brand-name">Automate</div>
          <div className="brand-sub">Headout</div>
        </div>
      </div>
      <nav className="nav">
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
            <Icon />
            <span>{label}</span>
            {to === '/health' && failing > 0 && <span className="nav-badge">{failing}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="env-row">
          <span className="num" style={{ color: 'var(--ok)' }}>●</span>
          <span>Production · v1</span>
        </div>
      </div>
    </aside>
  );
}

function Topbar() {
  const { pathname } = useLocation();
  const { data: health, isError } = useHealth();
  const up = !isError && health?.ok;
  const title = NAV.find((n) => n.to === pathname)?.title ?? 'Overview';

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="topbar">
      <h1>{title}</h1>
      <div className="spacer" />
      <span className="num" style={{ fontSize: 12, color: 'var(--faint)' }}>
        {now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </span>
      <span className={`live ${up ? 'up' : 'down'}`}>
        <span className="dot" />
        {up ? 'Live' : 'Offline'}
      </span>
    </header>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <div className="app">
          <Sidebar />
          <div className="main">
            <Topbar />
            <div className="content">
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/vendors" element={<Vendors />} />
                <Route path="/health" element={<ScriptHealth />} />
                <Route path="/team" element={<Team />} />
              </Routes>
            </div>
          </div>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
