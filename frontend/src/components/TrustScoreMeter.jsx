import { useEffect, useRef, useState } from 'react'

export const TIER_CONFIG = {
  LOW:           { color: '#10b981', glow: 'rgba(16,185,129,0.35)',  badgeClass: 'badge-green',  label: 'Low Risk',      sublabel: 'Excellent' },
  MEDIUM:        { color: '#F59E0B', glow: 'rgba(245,158,11,0.35)',  badgeClass: 'badge-gold',   label: 'Medium Risk',   sublabel: 'Standard'  },
  HIGH:          { color: '#f97316', glow: 'rgba(249,115,22,0.35)',  badgeClass: 'badge-orange', label: 'High Risk',     sublabel: 'Elevated'  },
  BLOCKED:       { color: '#ef4444', glow: 'rgba(239,68,68,0.35)',   badgeClass: 'badge-red',    label: 'Blocked',       sublabel: 'Declined'  },
  MANUAL_REVIEW: { color: '#8B5CF6', glow: 'rgba(139,92,246,0.35)', badgeClass: 'badge-violet', label: 'Manual Review', sublabel: 'Pending'   },
}

export default function TrustScoreMeter({ score = 0, tier = 'MEDIUM', size = 'md' }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef(null)
  const cfg = TIER_CONFIG[tier] || TIER_CONFIG.MEDIUM

  useEffect(() => {
    let current = 0
    const target = Math.max(0, Math.min(100, score))
    const animate = () => {
      const diff = target - current
      if (Math.abs(diff) < 1) { setDisplay(target); return }
      current += diff / 7
      setDisplay(Math.round(current))
      rafRef.current = requestAnimationFrame(animate)
    }
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(animate)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [score])

  const dim   = size === 'sm' ? 110 : 148
  const R     = size === 'sm' ? 42  : 56
  const SW    = size === 'sm' ? 8   : 10
  const CIRC  = 2 * Math.PI * R
  const filled = (display / 100) * CIRC

  return (
    <div className="flex flex-col items-center gap-4" role="img" aria-label={`Trust score: ${display} out of 100, tier: ${cfg.label}`}>
      {/* Gauge */}
      <div className="relative" style={{ filter: `drop-shadow(0 0 20px ${cfg.glow})` }}>
        <svg width={dim} height={dim} viewBox={`0 0 ${dim} ${dim}`} aria-hidden="true">
          {/* Track ring */}
          <circle
            cx={dim / 2} cy={dim / 2} r={R}
            fill="none" stroke="#1e2d4a" strokeWidth={SW}
          />
          {/* Track glow */}
          <circle
            cx={dim / 2} cy={dim / 2} r={R}
            fill="none" stroke={cfg.color} strokeWidth={SW}
            strokeOpacity="0.08"
          />
          {/* Progress arc */}
          <circle
            cx={dim / 2} cy={dim / 2} r={R}
            fill="none"
            stroke={cfg.color} strokeWidth={SW}
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC - filled}
            transform={`rotate(-90 ${dim / 2} ${dim / 2})`}
            style={{ transition: 'stroke-dashoffset 80ms linear' }}
          />
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-black text-white leading-none"
            style={{ fontSize: size === 'sm' ? '1.75rem' : '2.25rem' }}
          >
            {display}
          </span>
          <span className="text-[10px] font-semibold text-slate-600 mt-0.5">/ 100</span>
        </div>
      </div>

      {/* Tier badge */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-2xl border font-bold text-sm ${cfg.badgeClass}`}>
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: cfg.color, boxShadow: `0 0 6px ${cfg.glow}` }}
          aria-hidden="true"
        />
        {cfg.label}
      </div>
    </div>
  )
}
