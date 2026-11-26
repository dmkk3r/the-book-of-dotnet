import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { PreparedTab } from '@/lib/viz/prepared';
import type { CodeTab } from '@/lib/viz/types';

interface Props {
  idPrefix: string;
  tabs: PreparedTab[];
  active: CodeTab;
  onTabChange: (tab: CodeTab) => void;
  /** 1-based highlighted lines per tab. */
  highlighted: Partial<Record<CodeTab, number[]>>;
}

/** Code with tabs (C#, IL, …) and per-step line highlighting. */
export default function CodeView({ idPrefix, tabs, active, onTabChange, highlighted }: Props) {
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const preRef = useRef<HTMLPreElement>(null);
  const tab = tabs.find((t) => t.id === active) ?? tabs[0]!;
  const lines = new Set(highlighted[tab.id] ?? []);

  // Keep the first highlighted line visible inside the code pane (never scroll the page).
  useEffect(() => {
    const pre = preRef.current;
    const line = pre?.querySelector<HTMLElement>('[data-on="true"]');
    if (!pre || !line) return;
    const top = line.offsetTop - pre.offsetTop;
    if (top < pre.scrollTop || top + line.offsetHeight > pre.scrollTop + pre.clientHeight) {
      pre.scrollTop = Math.max(0, top - pre.clientHeight / 3);
    }
  });

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === tab.id);
    let next = -1;
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    e.stopPropagation(); // Arrow keys switch tabs here, not steps.
    onTabChange(tabs[next]!.id);
    tabRefs.current[next]?.focus();
  };

  return (
    <div className="codepane">
      {tabs.length > 1 && (
        <div className="tabs" role="tablist" aria-label="Codeansicht" onKeyDown={onKeyDown}>
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${idPrefix}-tab-${t.id}`}
              aria-selected={t.id === tab.id}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={t.id === tab.id ? 0 : -1}
              onClick={() => onTabChange(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <pre
        ref={preRef}
        className="code"
        id={`${idPrefix}-panel`}
        role={tabs.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={tabs.length > 1 ? `${idPrefix}-tab-${tab.id}` : undefined}
        tabIndex={0}
      >
        {tab.lines.map((html, i) => {
          const on = lines.has(i + 1);
          return (
            <div key={i} className="line" data-on={on}>
              <span className="ln" aria-hidden="true">
                {i + 1}
              </span>
              <span dangerouslySetInnerHTML={{ __html: html || ' ' }} />
              {on && <span className="sr-only"> (aktuelle Zeile)</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
