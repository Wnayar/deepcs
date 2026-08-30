import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'deepcs.theme.v2';

/** Dark by default: the site is designed dark-first. A saved choice wins. */
const DEFAULT: Theme = 'dark';

/** The saved choice, or null when there is no usable one. */
function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);

    if (value === 'light' || value === 'dark') {
      return value;
    }

    return null;
  } catch {
    // Private browsing can refuse localStorage; losing the preference beats
    // failing to render.
    return null;
  }
}

/** Writes the choice back, if the browser will accept it. */
function save(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // The choice still applies for the rest of this visit.
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
      save(next);
      return next;
    });
  };

  return [theme, toggle];
}
