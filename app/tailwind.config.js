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
        // Access & Site Services brand: Access Blue primary, Night Shift navy neutrals, platform yellow accent.
        brand: {
          50: '#eef2fd', 100: '#dbe3fb', 200: '#b9c8f6', 300: '#8ea6ef', 400: '#5d7de4',
          500: '#2047c6', 600: '#1b3dab', 700: '#17338e', 800: '#142a72', 900: '#11235c',
        },
        steel: {
          50: '#f6f8fb', 100: '#eef1f6', 200: '#dce2ec', 300: '#bcc6d6', 400: '#8794ab',
          500: '#63708a', 600: '#4a5670', 700: '#36415a', 800: '#222d47', 900: '#13213f', 950: '#0c1529',
        },
        hivis: { 50: '#fef8e7', 100: '#fdefc4', 300: '#f9d46f', 400: '#f8c94a', 500: '#f5b81a', 600: '#d99c0a', 700: '#a87806' },
      },
      boxShadow: { card: '0 1px 0 rgba(17,20,25,0.04), 0 1px 3px rgba(17,20,25,0.08)' },
    },
  },
  plugins: [],
};
