import { Link, Route, Routes } from "react-router-dom";
import { DesktopChrome } from "./components/DesktopChrome";
import { TitleBar } from "./components/TitleBar";
import { copy } from "./lib/copy";
import { AboutPage } from "./pages/AboutPage";
import { DemoPage } from "./pages/DemoPage";
import { LessonsPage } from "./pages/LessonsPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { QuestionsPage } from "./pages/QuestionsPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ReplayPage } from "./pages/ReplayPage";
import { SetupPage } from "./pages/SetupPage";
import { SpendPage } from "./pages/SpendPage";

export function App() {
  return (
    <DesktopChrome>
      <div className="desktop-shell min-h-screen bg-[var(--bg)] text-[var(--fg)]">
        <TitleBar />
        <header className="shell-nav flex flex-wrap items-baseline gap-4 border-b border-[var(--border)] bg-[var(--card)] px-8 py-3">
          <nav className="flex flex-wrap gap-4 text-sm" aria-label={copy.nav.label}>
            <Link to="/">{copy.nav.projects}</Link>
            <Link to="/questions">{copy.nav.questions}</Link>
            <Link to="/spend">{copy.nav.spend}</Link>
            <Link to="/settings">{copy.nav.settings}</Link>
            <Link to="/setup">First run</Link>
            <Link to="/new">{copy.nav.newProject}</Link>
            <Link to="/demo">{copy.nav.demo}</Link>
            <Link to="/about">{copy.about.title}</Link>
          </nav>
          <p className="ml-auto hidden text-xs text-[var(--muted)] md:block">
            Ctrl/⌘ N new · Ctrl/⌘ / jump · Esc
          </p>
        </header>
        <main className="desktop-main px-8 py-6">
          <Routes>
            <Route path="/" element={<ProjectsPage />} />
            <Route path="/missions/:id" element={<ProjectPage />} />
            <Route path="/missions/:id/lessons" element={<LessonsPage />} />
            <Route path="/missions/:id/report" element={<ReportPage />} />
            <Route path="/missions/:id/replay" element={<ReplayPage />} />

            <Route path="/questions" element={<QuestionsPage />} />
            <Route path="/spend" element={<SpendPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/new" element={<NewProjectPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/demo" element={<DemoPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="*" element={<NotFoundPage />} />

          </Routes>
        </main>
      </div>
    </DesktopChrome>
  );
}
