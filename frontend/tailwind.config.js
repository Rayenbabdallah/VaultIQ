/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Deep navy backgrounds — OLED-optimised dark mode
        navy: {
          950: '#020817',
          900: '#0F172A',
          800: '#111827',
          750: '#141e2e',
          700: '#1a2540',
          600: '#1e2d4a',
          500: '#243354',
          400: '#2d4070',
        },
        // Gold — primary trust colour
        gold: {
          DEFAULT: '#F59E0B',
          50:  '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#F59E0B',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        // Violet — AI / tech accent
        violet: {
          DEFAULT: '#8B5CF6',
          50:  '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8B5CF6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // Semantic
        success: { DEFAULT: '#10b981', light: '#d1fae5' },
        danger:  { DEFAULT: '#ef4444', light: '#fee2e2' },
        warning: { DEFAULT: '#f59e0b', light: '#fef3c7' },
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      boxShadow: {
        'glow-gold-sm': '0 0 12px rgba(245,158,11,0.2)',
        'glow-gold':    '0 0 24px rgba(245,158,11,0.3)',
        'glow-gold-lg': '0 0 48px rgba(245,158,11,0.35)',
        'glow-violet':  '0 0 24px rgba(139,92,246,0.3)',
        'glow-green':   '0 0 20px rgba(16,185,129,0.25)',
        'card':         '0 4px 24px rgba(0,0,0,0.5)',
        'card-hover':   '0 8px 40px rgba(0,0,0,0.6)',
        'inner-glow':   'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'grid-subtle':   'linear-gradient(rgba(245,158,11,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(245,158,11,0.02) 1px, transparent 1px)',
        'gold-shimmer':  'linear-gradient(135deg, #F59E0B 0%, #FBBF24 50%, #F59E0B 100%)',
        'hero-gradient': 'radial-gradient(ellipse 80% 60% at 50% -20%, rgba(139,92,246,0.15) 0%, transparent 60%)',
        'card-gradient': 'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)',
      },
      backgroundSize: {
        'grid': '48px 48px',
      },
      borderRadius: {
        '4xl': '2rem',
      },
      animation: {
        'fade-in':      'fadeIn 0.35s ease-out',
        'slide-up':     'slideUp 0.4s cubic-bezier(0.16,1,0.3,1)',
        'slide-in-r':   'slideInRight 0.4s cubic-bezier(0.16,1,0.3,1)',
        'scale-in':     'scaleIn 0.3s cubic-bezier(0.16,1,0.3,1)',
        'pulse-slow':   'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'shimmer':      'shimmer 2s linear infinite',
        'bounce-soft':  'bounceSoft 0.6s ease-out',
        'spin-slow':    'spin 3s linear infinite',
        'count-up':     'countUp 0.8s ease-out',
      },
      keyframes: {
        fadeIn:      { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp:     { from: { opacity: 0, transform: 'translateY(20px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        slideInRight:{ from: { opacity: 0, transform: 'translateX(24px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        scaleIn:     { from: { opacity: 0, transform: 'scale(0.95)' }, to: { opacity: 1, transform: 'scale(1)' } },
        shimmer:     { from: { backgroundPosition: '-200% 0' }, to: { backgroundPosition: '200% 0' } },
        bounceSoft:  { '0%': { transform: 'scale(0.95)' }, '60%': { transform: 'scale(1.02)' }, '100%': { transform: 'scale(1)' } },
        countUp:     { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
      transitionTimingFunction: {
        'spring': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [],
}
