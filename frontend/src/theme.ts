import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'deepcs.theme';

/**
 * What a first-time visitor gets.
 *
 * Dark, rather than whatever the operating system asks for. This is a place
 * for reading long pages at night and it is designed dark first, so following
 * the system setting would hand most visitors the theme that got less
 * attention. Light is one click away and the choice is remembered.
 */
const DEFAULT: Theme = 'dark';

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
 * A saved choice wins and is remembered between visits. With none saved the
 * app is dark, matching the `data-theme` already on the document so the first
 * paint does not flash.
 */
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
