import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        ink: '#0e1116',
        surface: '#161b22',
        'surface-2': '#1c232c',
        border: '#2a313a',
        muted: '#8b949e',
      },
    },
  },
  plugins: [],
};
export default config;
