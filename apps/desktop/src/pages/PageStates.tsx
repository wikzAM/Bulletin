import type { ReactNode } from "react";
import { copy } from "../lib/copy";

export function PageLoading() {
  return <p className="text-[var(--muted)]">{copy.states.loading}</p>;
}

export function PageError({ onRetry }: { onRetry?: () => void }) {
  const t = copy.states.error;
  return (
    <section aria-labelledby="page-error-title">
      <h1 id="page-error-title">{t.title}</h1>
      <p>{t.body}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}>
          {t.retry}
        </button>
      )}
    </section>
  );
}

export function PageShell({ children }: { children: ReactNode }) {
  return <div id="content">{children}</div>;
}