/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Barlow Condensed"', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Brand palette from CSS variables (Leaders set the colours in Settings → Branding).
        brand: { 50: 'rgb(var(--brand-50) / <alpha-value>)', 100: 'rgb(var(--brand-100) / <alpha-value>)', 200: 'rgb(var(--brand-200) / <alpha-value>)', 300: 'rgb(var(--brand-300) / <alpha-value>)', 400: 'rgb(var(--brand-400) / <alpha-value>)', 500: 'rgb(var(--brand-500) / <alpha-value>)', 600: 'rgb(var(--brand-600) / <alpha-value>)', 700: 'rgb(var(--brand-700) / <alpha-value>)', 800: 'rgb(var(--brand-800) / <alpha-value>)', 900: 'rgb(var(--brand-900) / <alpha-value>)' },
        steel: { 50: 'rgb(var(--steel-50) / <alpha-value>)', 100: 'rgb(var(--steel-100) / <alpha-value>)', 200: 'rgb(var(--steel-200) / <alpha-value>)', 300: 'rgb(var(--steel-300) / <alpha-value>)', 400: 'rgb(var(--steel-400) / <alpha-value>)', 500: 'rgb(var(--steel-500) / <alpha-value>)', 600: 'rgb(var(--steel-600) / <alpha-value>)', 700: 'rgb(var(--steel-700) / <alpha-value>)', 800: 'rgb(var(--steel-800) / <alpha-value>)', 900: 'rgb(var(--steel-900) / <alpha-value>)', 950: 'rgb(var(--steel-950) / <alpha-value>)' },
        hivis: { 50: 'rgb(var(--hivis-50) / <alpha-value>)', 100: 'rgb(var(--hivis-100) / <alpha-value>)', 300: 'rgb(var(--hivis-300) / <alpha-value>)', 400: 'rgb(var(--hivis-400) / <alpha-value>)', 500: 'rgb(var(--hivis-500) / <alpha-value>)', 600: 'rgb(var(--hivis-600) / <alpha-value>)', 700: 'rgb(var(--hivis-700) / <alpha-value>)' },
      },
      boxShadow: { card: '0 1px 0 rgba(17,20,25,0.04), 0 1px 3px rgba(17,20,25,0.08)' },
    },
  },
  plugins: [],
};
