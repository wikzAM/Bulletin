"use client";

import { copy } from "../lib/copy";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = copy.states.error;
  return (
    <main id="content">
      <div className="plan-errors" role="alert">
        <h1>{t.title}</h1>
        <p>{t.body}</p>
        <button type="button" onClick={reset}>
          {t.retry}
        </button>
      </div>
    </main>
  );
}
