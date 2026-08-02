/**
 * Route table.
 *
 * A data router (`createBrowserRouter`) rather than `<BrowserRouter>`, because
 * `useBlocker` — the unsaved-changes guard in the builder — only works with one.
 */
import { Navigate, createBrowserRouter } from 'react-router-dom';

import { AppLayout } from '@/components/layout/AppLayout';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import BuilderPage from '@/pages/BuilderPage';
import LoginPage from '@/pages/LoginPage';
import NotFoundPage from '@/pages/NotFoundPage';
import PublicQuestionnairePage from '@/pages/PublicQuestionnairePage';
import PublicResultPage from '@/pages/PublicResultPage';
import QuestionnairesPage from '@/pages/QuestionnairesPage';
import ResponsesPage from '@/pages/ResponsesPage';
import { RootBoundary } from '@/components/RootBoundary';

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/app/questionnaires" replace /> },
  { path: '/login', element: <LoginPage />, errorElement: <RootBoundary /> },
  {
    path: '/app',
    element: <ProtectedRoute />,
    errorElement: <RootBoundary />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Navigate to="/app/questionnaires" replace /> },
          { path: 'questionnaires', element: <QuestionnairesPage /> },
          { path: 'questionnaires/new', element: <BuilderPage /> },
          { path: 'questionnaires/:id/edit', element: <BuilderPage /> },
          { path: 'questionnaires/:id/responses', element: <ResponsesPage /> },
        ],
      },
    ],
  },
  { path: '/q/:slug', element: <PublicQuestionnairePage />, errorElement: <RootBoundary /> },
  {
    path: '/q/:slug/result/:responseId',
    element: <PublicResultPage />,
    errorElement: <RootBoundary />,
  },
  { path: '*', element: <NotFoundPage /> },
]);
