import { useLayoutEffect, useState, type RefObject } from 'react';

/** True if the element is wider than its visible area (it scrolls horizontally). */
export function useOverflow(ref: RefObject<HTMLElement | null>, deps: unknown[]): boolean {
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setOverflow(el.scrollWidth > el.clientWidth + 1);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, ...deps]);
  return overflow;
}
