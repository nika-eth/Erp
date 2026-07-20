/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Paleta acotada para mantener la UI blanca unificada del mostrador.
        acento: {
          DEFAULT: '#1d4ed8',
          hover: '#1e40af',
        },
        peligro: '#dc2626',
        exito: '#15803d',
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};
