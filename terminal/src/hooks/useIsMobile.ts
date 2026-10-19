import { useEffect, useState } from 'react';

/** Narrow viewport or coarse pointer on tablet-or-smaller — drives bottom nav. */
export function useIsMobile(breakpoint = 768) {
  const [mobile, setMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    const narrow = window.matchMedia(`(max-width: ${breakpoint}px)`).matches;
    const coarseTablet =
      window.matchMedia('(pointer: coarse)').matches &&
      window.matchMedia('(max-width: 1024px)').matches;
    return narrow || coarseTablet;
  });

  useEffect(() => {
    const mqWidth = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const mqCoarse = window.matchMedia('(pointer: coarse)');
    const mqTablet = window.matchMedia('(max-width: 1024px)');
    const update = () => {
      setMobile(mqWidth.matches || (mqCoarse.matches && mqTablet.matches));
    };
    update();
    mqWidth.addEventListener('change', update);
    mqCoarse.addEventListener('change', update);
    mqTablet.addEventListener('change', update);
    return () => {
      mqWidth.removeEventListener('change', update);
      mqCoarse.removeEventListener('change', update);
      mqTablet.removeEventListener('change', update);
    };
  }, [breakpoint]);

  return mobile;
}
