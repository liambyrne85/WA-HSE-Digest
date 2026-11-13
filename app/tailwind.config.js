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
        // High-visibility safety orange accent on steel neutrals.
        brand: {
          50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c',
          500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12',
        },
        steel: {
          50: '#f6f7f9', 100: '#eceef2', 200: '#d5d9e1', 300: '#b0b8c6', 400: '#8592a7',
          500: '#66738c', 600: '#515c73', 700: '#434b5e', 800: '#2b313d', 900: '#1b1f27', 950: '#111419',
        },
      },
      boxShadow: { card: '0 1px 0 rgba(17,20,25,0.04), 0 1px 3px rgba(17,20,25,0.08)' },
    },
  },
  plugins: [],
};
