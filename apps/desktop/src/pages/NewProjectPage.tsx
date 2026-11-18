import { copy } from "../lib/copy";
import { NewMissionForm } from "../components/NewMissionForm";
import { PageShell } from "./PageStates";

export function NewProjectPage() {
  return (
    <PageShell>
      <h1>{copy.newMission.title}</h1>
      <p className="muted">{copy.newMission.intro}</p>
      <NewMissionForm />
    </PageShell>
  );
}