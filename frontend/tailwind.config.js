/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#04080f',
          900: '#070d1a',
          800: '#0a1628',
          700: '#0f2040',
          600: '#142a52',
          500: '#1a3a6b',
          400: '#1e4080',
        },
        brand: {
          DEFAULT: '#2e86de',
          50:  '#eaf3ff',
          100: '#d0e6ff',
          200: '#a6ccff',
          300: '#70aaff',
          400: '#4191f0',
          500: '#2e86de',
          600: '#1a6cc5',
          700: '#1557a0',
          800: '#114680',
          900: '#0d3563',
        },
        teal: {
          DEFAULT: '#54c2b0',
          400: '#7fd8ca',
          500: '#54c2b0',
          600: '#3aab98',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-sm': '0 0 12px rgba(46,134,222,0.25)',
        'glow':    '0 0 24px rgba(46,134,222,0.35)',
        'glow-lg': '0 0 40px rgba(46,134,222,0.45)',
        'card':    '0 4px 24px rgba(0,0,0,0.4)',
      },
      backgroundImage: {
        'grid-pattern': "linear-gradient(rgba(46,134,222,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(46,134,222,0.03) 1px, transparent 1px)",
      },
      backgroundSize: {
        'grid': '48px 48px',
      },
      animation: {
        'fade-in':    'fadeIn 0.4s ease-out',
        'slide-up':   'slideUp 0.4s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
        'spin-slow':  'spin 3s linear infinite',
      },
      keyframes: {
        fadeIn:  { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(16px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
