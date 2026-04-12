import { Routes, Route, NavLink } from 'react-router-dom'
import { ShieldCheck, LayoutDashboard, Lock } from 'lucide-react'
import BorrowerFlow from './pages/BorrowerFlow'
import AdminDashboard from './pages/AdminDashboard'

const NAV = [
  { to: '/',      label: 'Apply',      icon: ShieldCheck,     end: true  },
  { to: '/admin', label: 'Compliance', icon: LayoutDashboard, end: false },
]

function Navbar() {
  return (
    <header className="sticky top-0 z-50 border-b border-navy-700/60 bg-navy-900/80 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center gap-8">

        {/* Brand */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative w-8 h-8 rounded-xl bg-gold-500 flex items-center justify-center shadow-glow-gold-sm">
            <span className="text-navy-950 font-black text-sm leading-none select-none">V</span>
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 border-2 border-navy-900" aria-hidden="true" />
          </div>
          <div className="leading-none">
            <p className="font-bold text-white tracking-tight text-[17px] m-0">
              Vault<span className="text-gold-400">IQ</span>
            </p>
            <p className="text-[9px] font-semibold tracking-[0.12em] uppercase text-slate-600 mt-0.5 m-0">
              Compliance Platform
            </p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex items-center gap-1" role="navigation" aria-label="Main navigation">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150 cursor-pointer ` +
                (isActive
                  ? 'bg-gold-500/10 text-gold-400 border border-gold-500/25'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]')
              }
            >
              <Icon size={14} strokeWidth={2.2} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Right */}
        <div className="ml-auto flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-slate-600 font-medium">
            <Lock size={10} className="text-emerald-500" aria-hidden="true" />
            <span>TLS 1.3 · RS256 · RFC 3161</span>
          </div>
          <span className="badge-gold">v0.1.0</span>
        </div>
      </div>
      <div className="h-px w-full bg-gradient-to-r from-transparent via-gold-500/25 to-transparent" aria-hidden="true" />
    </header>
  )
}

function Footer() {
  return (
    <footer className="border-t border-navy-700/40 py-5" role="contentinfo">
      <div className="max-w-6xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-xs text-slate-600 font-medium">
          © 2026 VaultIQ · Compliance-as-a-Service · Tunis Business School
        </p>
        <div className="flex items-center gap-4 text-[11px] text-slate-600">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" aria-hidden="true" />
            PAdES-T · XAdES-T
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 inline-block" aria-hidden="true" />
            Amazon Nova AI
          </span>
        </div>
      </div>
    </footer>
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
      <Footer />
    </div>
  )
}
