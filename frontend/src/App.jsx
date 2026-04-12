import { Routes, Route, NavLink, useLocation } from 'react-router-dom'
import { ShieldCheck, LayoutDashboard, ChevronRight } from 'lucide-react'
import BorrowerFlow from './pages/BorrowerFlow'
import AdminDashboard from './pages/AdminDashboard'

const NAV = [
  { to: '/',      label: 'Borrow',     icon: ShieldCheck },
  { to: '/admin', label: 'Compliance', icon: LayoutDashboard },
]

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy-700 bg-navy-900/90 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center gap-8">
        {/* Brand */}
        <div className="flex items-center gap-3 mr-4">
          <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shadow-glow-sm">
            <span className="text-white font-black text-sm">V</span>
          </div>
          <span className="font-extrabold text-white tracking-tight text-lg">
            Vault<span className="text-brand">IQ</span>
          </span>
        </div>

        {/* Nav links */}
        <nav className="flex items-center gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 ` +
                (isActive
                  ? 'bg-brand/15 text-brand border border-brand/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-navy-700')
              }
            >
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Right slot */}
        <div className="ml-auto flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-teal-500/15 text-teal-400 border border-teal-500/30">
            v0.1.0
          </span>
        </div>
      </div>
    </header>
  )
}

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <Routes>
          <Route path="/"      element={<BorrowerFlow />} />
          <Route path="/admin" element={<AdminDashboard />} />
        </Routes>
      </main>
      <footer className="border-t border-navy-700 py-4 text-center text-xs text-slate-600">
        VaultIQ Financial Services · Intelligent Lending Platform
      </footer>
    </div>
  )
}
