import { useEffect, useState } from 'react';

export function useMediaQuery(query: string) {
  const get = () => typeof window !== 'undefined' && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setMatches(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return matches;
}

/** Tailwind `lg` breakpoint */
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
