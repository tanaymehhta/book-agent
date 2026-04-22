import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: 'var(--paper)',
        'paper-2': 'var(--paper-2)',
        'paper-deep': 'var(--paper-deep)',
        ink: 'var(--ink)',
        'ink-2': 'var(--ink-2)',
        'ink-3': 'var(--ink-3)',
        'ink-4': 'var(--ink-4)',
        accent: 'var(--accent)',
        'accent-deep': 'var(--accent-deep)',
        'accent-soft': 'var(--accent-soft)',
        moss: 'var(--moss)',
        'moss-soft': 'var(--moss-soft)',
        ocean: 'var(--ocean)',
        'ocean-soft': 'var(--ocean-soft)',
        amber: 'var(--amber)',
        'amber-soft': 'var(--amber-soft)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        surface: 'var(--paper-2)',
        'surface-2': 'var(--paper-deep)',
        border: 'var(--line-strong)',
        muted: 'var(--ink-3)',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-serif', 'Georgia', 'serif'],
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgba(26,26,23,0.04), 0 1px 2px rgba(26,26,23,0.05)',
        'card-hover': '0 1px 0 rgba(26,26,23,0.06), 0 4px 14px rgba(26,26,23,0.08)',
        panel: '-18px 0 48px -20px rgba(26,26,23,0.18)',
      },
    },
  },
  plugins: [],
};
export default config;
