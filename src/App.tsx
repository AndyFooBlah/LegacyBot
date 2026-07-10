// Copyright 2026 Andrew Brook
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * App — the root component with client-side routing and auth guard.
 *
 * Route structure:
 *   /                                             → FamilySelector
 *   /create-family                                → CreateFamily
 *   /invite?token=...                             → AcceptInvite
 *   /family/:familyId                             → Admin: FamilyDashboard | Storyteller: StorytellerDashboard
 *   /family/:familyId/member/:memberUid           → MemberAdmin (admin only)
 *   /family/:familyId/tree                        → FamilyTreePage (admin only)
 *   /family/:familyId/info                        → FamilyInfo hub (admin only)
 *   /family/:familyId/info/events                 → FamilyEventsPage
 *   /family/:familyId/info/facts                  → FamilyFactsPage
 *   /family/:familyId/info/profiles               → FamilyProfilesPage
 *   /family/:familyId/memoirs                     → MemoirLibrary
 *   /family/:familyId/storyteller                 → StorytellerDashboard
 *   /family/:familyId/events/:eventId             → FamilyEventDetail
 *   /family/:familyId/dossier/:dossierId          → DossierEditor
 *   /family/:familyId/dossier/:dossierId/session  → SessionView
 *   /family/:familyId/dossier/:dossierId/talk     → redirects to session
 *   /family/:familyId/dossier/:dossierId/memoir   → MemoirViewer
 *   /family/:familyId/dossier/:dossierId/events   → EventsTimeline
 *   /family/:familyId/dossier/:dossierId/media    → MediaGallery
 *   /family/:familyId/dossier/:dossierId/history  → SessionList
 *   /family/:familyId/dossier/:dossierId/history/:sessionId → TranscriptViewer
 */

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/shared/Layout';
import { ErrorBoundary } from './components/shared/ErrorBoundary';

// Eagerly loaded — needed immediately on first render for most users
import { FamilySelector } from './components/family/FamilySelector';
import { FamilyHome } from './components/family/FamilyHome';

// Lazy-loaded route bundles — each only downloads when the route is visited
const CreateFamily = lazy(() =>
  import('./components/family/CreateFamily').then((m) => ({ default: m.CreateFamily })),
);
const AcceptInvite = lazy(() =>
  import('./components/auth/AcceptInvite').then((m) => ({ default: m.AcceptInvite })),
);
const MemberAdmin = lazy(() =>
  import('./components/family/MemberAdmin').then((m) => ({ default: m.MemberAdmin })),
);
const FamilyTreePage = lazy(() =>
  import('./components/family/FamilyTreePage').then((m) => ({ default: m.FamilyTreePage })),
);
const FamilyInfo = lazy(() =>
  import('./components/family/FamilyInfo').then((m) => ({ default: m.FamilyInfo })),
);
const FamilyEventsPage = lazy(() =>
  import('./components/family/FamilyEventsPage').then((m) => ({ default: m.FamilyEventsPage })),
);
const FamilyFactsPage = lazy(() =>
  import('./components/family/FamilyFactsPage').then((m) => ({ default: m.FamilyFactsPage })),
);
const FamilyProfilesPage = lazy(() =>
  import('./components/family/FamilyProfilesPage').then((m) => ({ default: m.FamilyProfilesPage })),
);
const MemoirLibrary = lazy(() =>
  import('./components/family/MemoirLibrary').then((m) => ({ default: m.MemoirLibrary })),
);
const FamilyEventDetail = lazy(() =>
  import('./components/family/FamilyEventDetail').then((m) => ({ default: m.FamilyEventDetail })),
);
const DossierEditor = lazy(() =>
  import('./components/dossier/DossierEditor').then((m) => ({ default: m.DossierEditor })),
);
const SessionView = lazy(() =>
  import('./components/session/SessionView').then((m) => ({ default: m.SessionView })),
);
const SessionList = lazy(() =>
  import('./components/history/SessionList').then((m) => ({ default: m.SessionList })),
);
const TranscriptViewer = lazy(() =>
  import('./components/history/TranscriptViewer').then((m) => ({ default: m.TranscriptViewer })),
);
const EventsTimeline = lazy(() =>
  import('./components/history/EventsTimeline').then((m) => ({ default: m.EventsTimeline })),
);
const MemoirViewer = lazy(() =>
  import('./components/memoir/MemoirViewer').then((m) => ({ default: m.MemoirViewer })),
);
const MediaGallery = lazy(() =>
  import('./components/media/MediaGallery').then((m) => ({ default: m.MediaGallery })),
);
const StorytellerDashboard = lazy(() =>
  import('./components/storyteller/StorytellerDashboard').then((m) => ({ default: m.StorytellerDashboard })),
);
const InvitationCodesPage = lazy(() =>
  import('./components/admin/InvitationCodesPage').then((m) => ({ default: m.InvitationCodesPage })),
);
const DiagnosticsPage = lazy(() =>
  import('./components/diagnostics/DiagnosticsPage').then((m) => ({ default: m.DiagnosticsPage })),
);

const RouteLoader: React.FC = () => (
  <div className="flex items-center justify-center h-64">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
  </div>
);

const App: React.FC = () => {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<FamilySelector />} />
              <Route path="/create-family" element={<CreateFamily />} />
              <Route path="/invite" element={<AcceptInvite />} />
              <Route path="/admin/invitation-codes" element={<InvitationCodesPage />} />
              <Route path="/diagnostics" element={<DiagnosticsPage />} />
              <Route path="/family/:familyId" element={<FamilyHome />} />
              <Route path="/family/:familyId/member/:memberUid" element={<MemberAdmin />} />
              <Route path="/family/:familyId/tree" element={<FamilyTreePage />} />
              <Route path="/family/:familyId/info" element={<FamilyInfo />} />
              <Route path="/family/:familyId/info/events" element={<FamilyEventsPage />} />
              <Route path="/family/:familyId/info/facts" element={<FamilyFactsPage />} />
              <Route path="/family/:familyId/info/profiles" element={<FamilyProfilesPage />} />
              <Route path="/family/:familyId/memoirs" element={<MemoirLibrary />} />
              <Route path="/family/:familyId/storyteller" element={<StorytellerDashboard />} />
              <Route path="/family/:familyId/events/:eventId" element={<FamilyEventDetail />} />
              <Route path="/family/:familyId/dossier/:dossierId" element={<DossierEditor />} />
              <Route path="/family/:familyId/dossier/:dossierId/session" element={<SessionView />} />
              <Route path="/family/:familyId/dossier/:dossierId/talk" element={<Navigate to="../session" replace />} />
              <Route path="/family/:familyId/dossier/:dossierId/memoir" element={<MemoirViewer />} />
              <Route path="/family/:familyId/dossier/:dossierId/events" element={<EventsTimeline />} />
              <Route path="/family/:familyId/dossier/:dossierId/media" element={<MediaGallery />} />
              <Route path="/family/:familyId/dossier/:dossierId/history" element={<SessionList />} />
              <Route path="/family/:familyId/dossier/:dossierId/history/:sessionId" element={<TranscriptViewer />} />
            </Route>
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  );
};

export default App;
