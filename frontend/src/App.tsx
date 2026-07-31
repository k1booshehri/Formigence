import { Link, Route, Routes } from 'react-router-dom';

import PublicQuestionnairePage from './pages/PublicQuestionnairePage';
import SignInPage from './pages/SignInPage';

export default function App() {
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <nav className="mx-auto flex max-w-3xl items-center gap-4 px-6 py-4">
          <Link to="/" className="font-semibold">
            Formigence
          </Link>
          <span className="text-sm text-slate-500">assessment platform</span>
        </nav>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <Routes>
          <Route path="/" element={<SignInPage />} />
          <Route path="/q/:slug" element={<PublicQuestionnairePage />} />
          <Route path="*" element={<p className="text-slate-600">Not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
