import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 50: '#f2f5fa', 100: '#e1e8f3', 200: '#c3d0e5', 300: '#94a9cc', 400: '#5f7aa8', 500: '#3d5888', 600: '#2b426d', 700: '#203357', 800: '#162542', 900: '#0e1a31', 950: '#081022' },
        teal: { 50: '#effaf8', 100: '#d7f2ee', 200: '#ade4dc', 300: '#78cfc4', 400: '#45b3a7', 500: '#2a978c', 600: '#1f7a72', 700: '#1c615c', 800: '#1a4e4a', 900: '#18413e' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'] },
      boxShadow: { card: '0 1px 2px rgba(14,26,49,.04), 0 4px 16px rgba(14,26,49,.06)' },
    },
  },
  plugins: [],
} satisfies Config;
