import { Check } from 'lucide-react'

export default function StepIndicator({ steps, current }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-10">
      {steps.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'upcoming'
        const isLast = i === steps.length - 1
        return (
          <div key={i} className="flex items-center">
            {/* Circle */}
            <div className="flex flex-col items-center">
              <div
                className={`
                  w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold
                  transition-all duration-300 border-2
                  ${state === 'done'     ? 'bg-brand border-brand text-white shadow-glow-sm' : ''}
                  ${state === 'active'   ? 'bg-navy-700 border-brand text-brand shadow-glow' : ''}
                  ${state === 'upcoming' ? 'bg-navy-800 border-navy-600 text-slate-500' : ''}
                `}
              >
                {state === 'done' ? <Check size={15} strokeWidth={3} /> : i + 1}
              </div>
              <span
                className={`mt-2 text-xs font-medium whitespace-nowrap
                  ${state === 'active' ? 'text-brand' : state === 'done' ? 'text-slate-400' : 'text-slate-600'}`}
              >
                {step}
              </span>
            </div>
            {/* Connector */}
            {!isLast && (
              <div className={`w-16 h-0.5 mx-1 mb-5 rounded transition-all duration-300
                ${state === 'done' ? 'bg-brand' : 'bg-navy-600'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
