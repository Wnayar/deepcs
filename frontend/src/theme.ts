import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'deepcs.theme';

/** What the operating system asks for, used only when nothing has been chosen. */
function preferred(): Theme {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Private browsing can refuse localStorage outright. Losing the preference
    // between visits is a smaller problem than the page failing to render.
    return null;
  }
}

/**
 * The light or dark choice, written onto `<html data-theme>` where the
 * stylesheet reads it.
 *
 * An explicit choice wins over the system setting and is remembered; with no
 * choice made, the system setting is followed and keeps being followed if it
 * changes, which is what makes the app go dark at sunset along with everything
 * else on the machine.
 */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? preferred());

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (stored()) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const follow = (event: MediaQueryListEvent) => setTheme(event.matches ? 'dark' : 'light');
    media.addEventListener('change', follow);
    return () => media.removeEventListener('change', follow);
  }, []);

  const toggle = () => {
    setTheme((current) => {
      const next = current === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* the choice still applies for this visit */
      }
      return next;
    });
  };

  return [theme, toggle];
}
