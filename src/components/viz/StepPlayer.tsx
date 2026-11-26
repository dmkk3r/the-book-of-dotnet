import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type { PlayerProps } from '@/lib/viz/prepared';
import type { CodeTab } from '@/lib/viz/types';
import Icon from '@/components/Icon';
import CodeView from './CodeView';
import BucketView from './BucketView';
import GcHeapView from './GcHeapView';
import GraphView from './GraphView';
import LayoutView from './LayoutView';
import MemoryView from './MemoryView';
import PipelineView from './PipelineView';
import TableView from './TableView';
import TimelineView from './TimelineView';
import './viz.css';

const AUTOPLAY_MS = 3000;

/**
 * Generic step player: code on the left, state view on the right, explanation below.
 * Keyboard: ←/→ previous/next, Home/End first/last step (when focus is inside the player).
 */
export default function StepPlayer(props: PlayerProps) {
  const { title, tabs, steps, layout } = props;
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [index, setIndex] = useState(0);
  const [tab, setTab] = useState<CodeTab>(tabs[0]?.id ?? 'cs');
  const [playing, setPlaying] = useState(false);
  const last = steps.length - 1;
  const step = steps[index]!;

  const go = (next: number) => setIndex(Math.max(0, Math.min(last, next)));

  useEffect(() => {
    if (!playing) return;
    if (index >= last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setIndex((i) => Math.min(last, i + 1)), AUTOPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, () => void> = {
      ArrowRight: () => go(index + 1),
      ArrowLeft: () => go(index - 1),
      Home: () => go(0),
      End: () => go(last),
    };
    const action = keys[e.key];
    if (!action || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    setPlaying(false);
    action();
  };

  const highlighted: Partial<Record<CodeTab, number[]>> = {
    ...step.highlight,
    cs: step.codeLine !== undefined ? [step.codeLine] : [],
  };

  let view;
  switch (props.view) {
    case 'memory': {
      const s = props.steps[index]!;
      view = <MemoryView state={s.state} changed={s.changed} idPrefix={idPrefix} />;
      break;
    }
    case 'timeline': {
      const s = props.steps[index]!;
      view = <TimelineView state={s.state} changed={s.changed} idPrefix={idPrefix} />;
      break;
    }
    case 'gcheap': {
      const s = props.steps[index]!;
      view = <GcHeapView state={s.state} changed={s.changed} idPrefix={idPrefix} />;
      break;
    }
    case 'pipeline': {
      const s = props.steps[index]!;
      view = <PipelineView state={s.state} changed={s.changed} />;
      break;
    }
    case 'buckets': {
      const s = props.steps[index]!;
      view = <BucketView state={s.state} changed={s.changed} idPrefix={idPrefix} />;
      break;
    }
    case 'layout': {
      const s = props.steps[index]!;
      view = <LayoutView state={s.state} changed={s.changed} />;
      break;
    }
    case 'graph': {
      const s = props.steps[index]!;
      view = <GraphView state={s.state} changed={s.changed} idPrefix={idPrefix} />;
      break;
    }
    case 'table': {
      const s = props.steps[index]!;
      view = <TableView state={s.state} changed={s.changed} idPrefix={idPrefix} />;
      break;
    }
  }

  return (
    <div
      className="player"
      data-layout={layout}
      data-pagefind-ignore
      role="group"
      aria-roledescription="Schritt-für-Schritt-Visualisierung"
      aria-label={title}
      onKeyDown={onKeyDown}
    >
      <div className="player-grid">
        <CodeView
          idPrefix={idPrefix}
          tabs={tabs}
          active={tab}
          onTabChange={setTab}
          highlighted={highlighted}
        />
        <div className="viewpane">{view}</div>
      </div>
      <div className="explain">
        <p aria-live="polite" aria-atomic="true">
          <span className="sr-only">
            Schritt {index + 1} von {steps.length}:{' '}
          </span>
          <span dangerouslySetInnerHTML={{ __html: step.explanationHtml }} />
        </p>
        <div className="ctrls">
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPlaying(false);
              go(0);
            }}
            disabled={index === 0}
            aria-label="Zum ersten Schritt"
            title="Zum ersten Schritt (Pos1)"
          >
            <Icon name="reset" />
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              setPlaying(false);
              go(index - 1);
            }}
            disabled={index === 0}
          >
            Zurück
          </button>
          <span className="count" aria-hidden="true">
            {index + 1} / {steps.length}
          </span>
          <button
            type="button"
            className="btn primary"
            onClick={() => {
              setPlaying(false);
              go(index + 1);
            }}
            disabled={index === last}
          >
            Weiter
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => {
              if (!playing && index === last) setIndex(0);
              setPlaying(!playing);
            }}
            aria-pressed={playing}
            aria-label={playing ? 'Automatisch abspielen anhalten' : 'Automatisch abspielen'}
            title={playing ? 'Anhalten' : 'Automatisch abspielen'}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
        </div>
      </div>
      <p className="player-hint">
        Tipp: Mit den Pfeiltasten ← → wechselst du die Schritte, sobald der Fokus im Player liegt.
      </p>
    </div>
  );
}
