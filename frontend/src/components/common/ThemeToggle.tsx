import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/store/theme';

export function ThemeToggle() {
  const { choice, setChoice, isDark } = useTheme();
  const dark = isDark();
  void choice; // re-render when choice changes
  return (
    <button onClick={() => setChoice(dark ? 'light' : 'dark')} className="grid h-9 w-9 place-items-center rounded-xl text-muted transition hover:bg-surface-2 hover:text-ink" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} title={dark ? 'Light mode' : 'Dark mode'}>
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
