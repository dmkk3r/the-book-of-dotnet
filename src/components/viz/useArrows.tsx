import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { routeArrows, type Arrow, type Box, type Link } from '@/lib/viz/route-arrows';

/**
 * Draws reference arrows between DOM elements inside `root`:
 * every element with `data-arrow-to="<id> <id>"` points to the elements with `data-arrow-id="<id>"`.
 * Targets marked with `data-arrow-enter="top"` (boxes side by side) are entered from the top.
 * Arrows are routed orthogonally with separate channels (see src/lib/viz/route-arrows.ts).
 */
export function useArrows(root: RefObject<HTMLElement | null>, deps: unknown[]): Arrow[] {
  const [arrows, setArrows] = useState<Arrow[]>([]);

  const measure = useCallback(() => {
    const el = root.current;
    if (!el) return;
    const origin = el.getBoundingClientRect();
    const box = (r: DOMRect): Box => ({
      left: r.left - origin.left,
      top: r.top - origin.top,
      right: r.right - origin.left,
      bottom: r.bottom - origin.top,
    });
    const links: Link[] = [];
    for (const source of el.querySelectorAll<HTMLElement>('[data-arrow-to]')) {
      for (const targetId of (source.dataset.arrowTo ?? '').split(' ').filter(Boolean)) {
        const target = el.querySelector<HTMLElement>(`[data-arrow-id="${CSS.escape(targetId)}"]`);
        if (!target) continue;
        const siblings =
          source.parentElement !== null && source.parentElement === target.parentElement;
        const column = target.closest<HTMLElement>('[data-arrow-column]');
        links.push({
          from: box(source.getBoundingClientRect()),
          to: box(target.getBoundingClientRect()),
          siblings,
          ...(column ? { column: box(column.getBoundingClientRect()) } : {}),
          ...(target.dataset.arrowEnter === 'top' ? { enterTop: true } : {}),
        });
      }
    }
    const next = routeArrows(links);
    setArrows((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [root]);

  // Re-measure whenever the visualized state (deps) changes.
  useLayoutEffect(() => measure(), [measure, ...deps]);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [root, measure]);

  return arrows;
}

/** SVG overlay rendering the arrows. Place inside a `position: relative` container. */
export function ArrowLayer({ arrows, idPrefix }: { arrows: Arrow[]; idPrefix: string }) {
  const markerId = `${idPrefix}-arrow`;
  return (
    <svg className="arrows" aria-hidden="true">
      <defs>
        <marker
          id={markerId}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="8"
          markerHeight="8"
          markerUnits="userSpaceOnUse"
          orient="auto"
        >
          <path d="M0 0.5L7.5 4L0 7.5z" />
        </marker>
      </defs>
      {arrows.map((a, i) => (
        <g key={i}>
          <path d={a.d} markerEnd={`url(#${markerId})`} />
          {a.long && <circle cx={a.start.x} cy={a.start.y} r="2.75" />}
        </g>
      ))}
    </svg>
  );
}
