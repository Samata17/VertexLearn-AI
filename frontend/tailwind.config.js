/** Design tokens live as CSS variables in src/styles/index.css so light/dark themes stay consistent. */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        'surface-2': v('surface-2'),
        border: v('border'),
        ink: v('ink'),
        muted: v('muted'),
        brand: {
          50: '#F5F3FF', 100: '#EDE9FE', 200: '#DDD6FE', 300: '#C4B5FD', 400: '#A78BFA',
          500: '#8B5CF6', 600: '#7C3AED', 700: '#6D28D9', 800: '#5B21B6', 900: '#4C1D95',
        },
        navy: { 800: '#1B1A4A', 900: '#14123A', 950: '#0B0B1E' },
      },
      boxShadow: {
        card: '0 1px 2px rgb(20 18 58 / 0.04), 0 1px 3px rgb(20 18 58 / 0.06)',
        lift: '0 4px 6px -1px rgb(20 18 58 / 0.06), 0 12px 24px -6px rgb(20 18 58 / 0.10)',
        glow: '0 0 0 4px rgb(124 58 237 / 0.15)',
      },
      borderRadius: { xl: '0.875rem', '2xl': '1.125rem' },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        'scale-in': { from: { opacity: 0, transform: 'scale(.97)' }, to: { opacity: 1, transform: 'none' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        bounce3: { '0%,80%,100%': { transform: 'scale(0.6)', opacity: 0.4 }, '40%': { transform: 'scale(1)', opacity: 1 } },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out both',
        'scale-in': 'scale-in .18s ease-out both',
        shimmer: 'shimmer 1.4s infinite',
        bounce3: 'bounce3 1.2s infinite ease-in-out both',
      },
    },
  },
  plugins: [],
};
