import { create } from 'zustand';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'vl-theme';

const systemDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
function apply(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && systemDark());
  document.documentElement.classList.toggle('dark', dark);
}

const initial = (() => {
  try { return (localStorage.getItem(KEY) as ThemeChoice) || 'system'; } catch { return 'system'; }
})();

export const useTheme = create<{ choice: ThemeChoice; setChoice: (c: ThemeChoice) => void; isDark: () => boolean }>((set, get) => ({
  choice: initial,
  setChoice: (choice) => {
    try { localStorage.setItem(KEY, choice); } catch { /* ignore */ }
    apply(choice);
    set({ choice });
  },
  isDark: () => get().choice === 'dark' || (get().choice === 'system' && systemDark()),
}));

window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useTheme.getState().choice === 'system') apply('system');
});
