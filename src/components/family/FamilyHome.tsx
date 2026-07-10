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
 * FamilyHome — role-based landing page within a family.
 * Admin: shows FamilyPage (unified member management + storytellers)
 * Storyteller-only: shows StorytellerDashboard (history + start session)
 * Both: shows FamilyPage (admin view)
 */

import React from 'react';
import { useParams, Navigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { useCurrentRoles } from '../../hooks/useFamily';
import { FamilyDashboard } from './FamilyDashboard';
import { StorytellerDashboard } from '../storyteller/StorytellerDashboard';

export const FamilyHome: React.FC = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { user } = useAuth();
  const { isAdmin, isStoryteller, loading } = useCurrentRoles(familyId, user?.uid);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // Admins (even with dual role) see the full admin view
  if (isAdmin) {
    return <FamilyDashboard />;
  }

  // Storyteller-only: show their dashboard with history + start session
  if (isStoryteller) {
    return <StorytellerDashboard />;
  }

  // Not a member — redirect to family selector so new users can create a family
  return <Navigate to="/" replace />;
};
