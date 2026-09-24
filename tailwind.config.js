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
        // Söhne carries body + (via the 600-900 @font-face range) all bold/impact
        // text as Söhne Condensed. Value Serif for editorial quotes; Söhne Mono
        // for labels/metadata/operator.
        sans: ['Sohne', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ['MongoDB Value Serif', 'Georgia', 'serif'],
        mono: ['Sohne Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};
