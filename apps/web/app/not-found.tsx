import Link from "next/link";
import { copy } from "../lib/copy";

export default function NotFound() {
  const t = copy.states.notFound;
  return (
    <main id="content">
      <h1>{t.title}</h1>
      <p>{t.body}</p>
      <Link href="/">{t.home}</Link>
    </main>
  );
}
