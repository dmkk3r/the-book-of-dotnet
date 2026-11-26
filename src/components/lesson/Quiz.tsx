import { useEffect, useId, useState } from 'react';
import { doneIds, setDone } from '@/lib/progress';
import './quiz.css';

export interface QuizQuestion {
  q: string;
  options: string[];
  /** Index of the correct option. */
  correct: number;
  explanation: string;
}

interface Props {
  lessonId: string;
  questions: QuizQuestion[];
}

/**
 * Questions with instant feedback. Answering every question correctly marks the lesson
 * as done. Wrong answers can be retried.
 */
export default function Quiz({ lessonId, questions }: Props) {
  const idPrefix = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const [chosen, setChosen] = useState<(number | undefined)[]>(() =>
    questions.map(() => undefined),
  );
  const [alreadyDone, setAlreadyDone] = useState(false);
  const allCorrect = questions.every((q, i) => chosen[i] === q.correct);

  useEffect(() => {
    setAlreadyDone(doneIds().has(lessonId));
  }, [lessonId]);

  useEffect(() => {
    if (allCorrect) setDone(lessonId, true);
  }, [allCorrect, lessonId]);

  const choose = (qi: number, oi: number) =>
    setChosen((prev) => prev.map((v, i) => (i === qi ? oi : v)));

  return (
    <div className="quiz">
      {questions.map((question, qi) => {
        const answer = chosen[qi];
        const answered = answer !== undefined;
        const right = answer === question.correct;
        return (
          <div className="q" key={qi} role="group" aria-labelledby={`${idPrefix}-q${qi}`}>
            <p className="q-text" id={`${idPrefix}-q${qi}`}>
              <span className="q-n">{qi + 1}.</span> {question.q}
            </p>
            <div className="opts">
              {question.options.map((option, oi) => {
                const state =
                  answer === oi ? (oi === question.correct ? 'right' : 'wrong') : undefined;
                return (
                  <button
                    key={oi}
                    type="button"
                    className="opt"
                    data-state={state}
                    aria-pressed={answer === oi}
                    onClick={() => choose(qi, oi)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            <p
              className="fb"
              aria-live="polite"
              data-state={answered ? (right ? 'right' : 'wrong') : undefined}
            >
              {answered && (
                <>
                  <strong>{right ? 'Richtig. ' : 'Nicht ganz. '}</strong>
                  {question.explanation}
                </>
              )}
            </p>
          </div>
        );
      })}
      <p className="quiz-status" role="status">
        {allCorrect
          ? 'Alle Fragen richtig beantwortet. Die Lektion ist als erledigt markiert.'
          : alreadyDone
            ? 'Du hast diese Lektion bereits abgeschlossen.'
            : ''}
      </p>
    </div>
  );
}
