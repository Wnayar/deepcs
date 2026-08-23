import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'deepcs.theme.v2';

/** Dark by default: the site is designed dark-first. A saved choice wins. */
const DEFAULT: Theme = 'dark';

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    // Private browsing can refuse localStorage; losing the preference beats
    // failing to render.
    return null;
  }
}

/** The theme choice, written onto `<html data-theme>` where the stylesheet
 * reads it. index.html pre-sets dark so the first paint does not flash. */
export function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => stored() ?? DEFAULT);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

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
