import { useEffect, useState } from 'react'

const TIER_CONFIG = {
  LOW:           { color: '#10b981', glow: 'rgba(16,185,129,0.4)',  bg: 'bg-emerald-500/10', text: 'text-emerald-400', border: 'border-emerald-500/30', label: 'Low Risk'    },
  MEDIUM:        { color: '#f59e0b', glow: 'rgba(245,158,11,0.4)',  bg: 'bg-amber-500/10',   text: 'text-amber-400',  border: 'border-amber-500/30',   label: 'Medium Risk' },
  HIGH:          { color: '#f97316', glow: 'rgba(249,115,22,0.4)',  bg: 'bg-orange-500/10',  text: 'text-orange-400', border: 'border-orange-500/30',   label: 'High Risk'   },
  BLOCKED:       { color: '#ef4444', glow: 'rgba(239,68,68,0.4)',   bg: 'bg-red-500/10',     text: 'text-red-400',    border: 'border-red-500/30',      label: 'Blocked'     },
  MANUAL_REVIEW: { color: '#8b5cf6', glow: 'rgba(139,92,246,0.4)', bg: 'bg-violet-500/10',  text: 'text-violet-400', border: 'border-violet-500/30',   label: 'Manual Review' },
}

export default function TrustScoreMeter({ score = 0, tier = 'MEDIUM' }) {
  const [display, setDisplay] = useState(0)
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.MEDIUM

  // Animate score counter
  useEffect(() => {
    let start = 0
    const step = () => {
      start += Math.ceil((score - start) / 6)
      if (start >= score) { setDisplay(score); return }
      setDisplay(start)
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [score])

  // SVG circular gauge
  const R = 54
  const CIRC = 2 * Math.PI * R
  const filled = (display / 100) * CIRC

  return (
    <div className="flex flex-col items-center gap-6">
      {/* Gauge */}
      <div className="relative" style={{ filter: `drop-shadow(0 0 18px ${cfg.glow})` }}>
        <svg width={140} height={140} viewBox="0 0 140 140">
          {/* Track */}
          <circle cx="70" cy="70" r={R} fill="none" stroke="#1a3a6b" strokeWidth="10" />
          {/* Progress */}
          <circle
            cx="70" cy="70" r={R} fill="none"
            stroke={cfg.color} strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC - filled}
            transform="rotate(-90 70 70)"
            style={{ transition: 'stroke-dashoffset 0.1s linear' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-4xl font-black text-white leading-none">{display}</span>
          <span className="text-xs font-semibold text-slate-500 mt-0.5">/ 100</span>
        </div>
      </div>

      {/* Tier badge */}
      <div className={`flex items-center gap-2 px-5 py-2.5 rounded-2xl border font-bold text-sm ${cfg.bg} ${cfg.text} ${cfg.border}`}>
        <span className="w-2 h-2 rounded-full" style={{ background: cfg.color }} />
        {cfg.label}
      </div>
    </div>
  )
}

export { TIER_CONFIG }
