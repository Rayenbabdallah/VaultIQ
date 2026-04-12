import { Check } from 'lucide-react'

export default function StepIndicator({ steps, current }) {
  const progress = Math.round((current / (steps.length - 1)) * 100)

  return (
    <div className="mb-10">
      {/* Mobile: compact bar */}
      <div className="sm:hidden mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-semibold text-slate-500">Step {current + 1} / {steps.length}</span>
          <span className="text-xs font-bold text-gold-400">{steps[current]}</span>
        </div>
        <div className="progress-track">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* Desktop: full row */}
      <div className="hidden sm:flex items-center justify-center" role="list" aria-label="Progress steps">
        {steps.map((step, i) => {
          const state = i < current ? 'done' : i === current ? 'active' : 'upcoming'
          const isLast = i === steps.length - 1
          return (
            <div key={i} className="flex items-center" role="listitem">
              <div className="flex flex-col items-center gap-2">
                <div
                  className={[
                    'relative w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all duration-300',
                    state === 'done'     ? 'bg-gold-500 border-gold-500 text-navy-950 shadow-glow-gold-sm' : '',
                    state === 'active'   ? 'bg-navy-800 border-gold-400 text-gold-400 shadow-glow-gold-sm' : '',
                    state === 'upcoming' ? 'bg-navy-800 border-navy-700 text-slate-600' : '',
                  ].join(' ')}
                  aria-current={state === 'active' ? 'step' : undefined}
                  aria-label={`${step} — ${state}`}
                >
                  {state === 'done'
                    ? <Check size={14} strokeWidth={3} aria-hidden="true" />
                    : <span aria-hidden="true">{i + 1}</span>
                  }
                  {state === 'active' && (
                    <span className="absolute inset-0 rounded-full border-2 border-gold-400/30 animate-ping" aria-hidden="true" />
                  )}
                </div>
                <span className={[
                  'text-[11px] font-semibold whitespace-nowrap transition-colors duration-200',
                  state === 'active'   ? 'text-gold-400' : '',
                  state === 'done'     ? 'text-slate-400' : '',
                  state === 'upcoming' ? 'text-slate-600' : '',
                ].join(' ')}>
                  {step}
                </span>
              </div>
              {!isLast && (
                <div className="w-16 h-px mx-2 mb-5 rounded-full bg-navy-700 overflow-hidden relative" aria-hidden="true">
                  <div
                    className="absolute inset-y-0 left-0 bg-gold-500 transition-all duration-500 rounded-full"
                    style={{ width: i < current ? '100%' : '0%' }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
