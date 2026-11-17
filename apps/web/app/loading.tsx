import { copy } from "../lib/copy";

export default function Loading() {
  return (
    <main id="content">
      <p className="muted" role="status">
        {copy.states.loading}
      </p>
    </main>
  );
}
