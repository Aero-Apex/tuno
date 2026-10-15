/** Every color, radius and font comes from CSS variables so the theme editor can change all of it live. */
const v = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        elevated: v('elevated'),
        text: v('text'),
        muted: v('muted'),
        accent: v('accent'),
        'on-accent': v('on-accent'),
        dynamic: v('dynamic'),
      },
      borderRadius: {
        sm: 'calc(var(--radius) * 0.5)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'calc(var(--radius) * 1.5)',
        xl: 'calc(var(--radius) * 2)',
        cover: 'var(--cover-radius)',
      },
      fontFamily: {
        sans: ['var(--font)', 'system-ui', 'sans-serif'],
      },
      spacing: {
        row: 'var(--row-h)',
        sidebar: 'var(--sidebar-w)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'none' } },
        eq: { '0%,100%': { height: '20%' }, '50%': { height: '100%' } },
      },
      animation: {
        'fade-in': 'fade-in var(--anim, 200ms) ease-out both',
        eq: 'eq 0.9s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
