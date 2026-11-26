import type { CodeTab, ViewName, ViewStates } from './types.ts';

/** Build-time prepared data passed from StepPlayer.astro to the React island. */
export interface PreparedTab {
  id: CodeTab;
  label: string;
  /** Highlighted HTML, one entry per line. */
  lines: string[];
}

export interface PreparedStep<S> {
  codeLine?: number;
  highlight?: Partial<Record<CodeTab, number[]>>;
  state: S;
  changed: string[];
  explanationHtml: string;
}

export type PreparedSteps = {
  [V in ViewName]: { view: V; steps: PreparedStep<ViewStates[V]>[] };
}[ViewName];

export type PlayerProps = PreparedSteps & {
  title: string;
  layout: 'side' | 'stacked';
  tabs: PreparedTab[];
};
