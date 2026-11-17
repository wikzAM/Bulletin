import { copy } from "../../lib/copy";
import { NewMissionForm } from "./new-mission-form";

export default function NewMissionPage() {
  return (
    <main id="content">
      <h1>{copy.newMission.title}</h1>
      <p className="muted">{copy.newMission.intro}</p>
      <NewMissionForm />
    </main>
  );
}
