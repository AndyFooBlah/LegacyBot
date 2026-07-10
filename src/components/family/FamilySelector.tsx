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
 * FamilySelector — post-login landing page.
 * If 0 families: show "Create a family" + "I have an invite link"
 * If 1 family: auto-redirect
 * If multiple: show family list
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import { getUserFamilyIds } from '../../hooks/useFamily';
import { Logo } from '../shared/Logo';

export const FamilySelector: React.FC = () => {
  const { user, isSuperadmin } = useAuth();
  const navigate = useNavigate();
  const [familyIds, setFamilyIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    user.getIdToken()
      .then(() => getUserFamilyIds(user.uid))
      .then((ids) => setFamilyIds(ids))
      .catch((err) => console.error('[FamilySelector] Failed to load family IDs:', err))
      .finally(() => setLoading(false));
  }, [user?.uid]);

  useEffect(() => {
    if (loading) return;
    if (familyIds.length === 1) {
      navigate(`/family/${familyIds[0]}`, { replace: true });
    }
  }, [loading, familyIds, navigate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    );
  }

  // Auto-redirect handled in effect above; show nothing while redirecting
  if (familyIds.length === 1) return null;

  if (familyIds.length === 0) {
    return (
      <div className="max-w-md mx-auto p-8 mt-20 space-y-8 text-center">
        <div className="space-y-2">
          <div className="flex items-center justify-center gap-3">
            <Logo size={44} />
            <h1 className="text-4xl font-bold text-slate-800 tracking-tighter font-display">
              BiographyBot
            </h1>
          </div>
          <p className="text-slate-400">
            Preserve your family's stories for generations to come.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={() => navigate('/create-family')}
            className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold text-lg hover:bg-indigo-700 transition-colors shadow-lg"
          >
            Create a Family
          </button>
          <p className="text-sm text-slate-400">or</p>
          <button
            onClick={() => {
              const link = window.prompt('Paste your invite link:');
              if (link) {
                try {
                  const url = new URL(link);
                  navigate(url.pathname + url.search);
                } catch {
                  navigate(link);
                }
              }
            }}
            className="w-full py-4 bg-white border-2 border-slate-200 text-slate-700 rounded-2xl font-bold text-lg hover:bg-slate-50 transition-colors"
          >
            I Have an Invite Link
          </button>
        </div>

        {isSuperadmin && (
          <button
            onClick={() => navigate('/admin/invitation-codes')}
            className="text-xs text-slate-400 font-medium hover:text-slate-600 transition-colors"
          >
            Superadmin: Invitation codes
          </button>
        )}
      </div>
    );
  }

  // Multiple families — show selector
  return (
    <div className="max-w-md mx-auto p-8 mt-12 space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-slate-800">Your Families</h2>
        <p className="text-slate-400 text-sm">Select a family to continue.</p>
      </div>

      <div className="space-y-3">
        {familyIds.map((id) => (
          <button
            key={id}
            onClick={() => navigate(`/family/${id}`)}
            className="w-full p-4 bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow text-left font-semibold text-slate-800"
          >
            {id}
          </button>
        ))}
      </div>

      <div className="text-center pt-4">
        <button
          onClick={() => navigate('/create-family')}
          className="text-sm text-indigo-600 font-semibold hover:underline"
        >
          + Create another family
        </button>
      </div>

      {isSuperadmin && (
        <div className="text-center">
          <button
            onClick={() => navigate('/admin/invitation-codes')}
            className="text-xs text-slate-400 font-medium hover:text-slate-600 transition-colors"
          >
            Superadmin: Invitation codes
          </button>
        </div>
      )}
    </div>
  );
};
