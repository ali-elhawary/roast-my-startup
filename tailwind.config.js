/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './client/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Single accent color used across all screens.
        accent: {
          DEFAULT: '#39FF6A',
          dim: '#1f7a38',
        },
        ink: {
          900: '#0a0a0b',
          800: '#111113',
          700: '#1a1a1e',
          600: '#26262c',
          400: '#5c5c66',
          200: '#a8a8b3',
          100: '#d8d8de',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
