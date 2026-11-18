import { Link } from "react-router-dom";
import { copy } from "../lib/copy";
import { PageShell } from "./PageStates";

export function NotFoundPage() {
  const t = copy.states.notFound;
  return (
    <PageShell>
      <h1>{t.title}</h1>
      <p>{t.body}</p>
      <Link to="/">{t.home}</Link>
    </PageShell>
  );
}