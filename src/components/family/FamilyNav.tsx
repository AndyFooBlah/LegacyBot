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
 * FamilyNav — top navigation bar shared by all family admin pages.
 */

import React from 'react';
import { Link, useLocation } from 'react-router-dom';

interface FamilyNavProps {
  familyId: string;
  familyName?: string;
}

export const FamilyNav: React.FC<FamilyNavProps> = ({ familyId, familyName }) => {
  const location = useLocation();

  const links = [
    { label: 'Dashboard', to: `/family/${familyId}` },
    { label: 'Family Tree', to: `/family/${familyId}/tree` },
    { label: 'Family Info', to: `/family/${familyId}/info` },
    { label: 'Memoirs', to: `/family/${familyId}/memoirs` },
  ];

  return (
    <div className="border-b border-slate-100 pb-4 mb-6">
      {familyName && (
        <h1 className="text-2xl font-bold text-slate-800 tracking-tight mb-3">{familyName}</h1>
      )}
      <nav className="flex gap-1 flex-wrap">
        {links.map((link) => {
          const isActive =
            link.to === `/family/${familyId}`
              ? location.pathname === link.to
              : location.pathname.startsWith(link.to);
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
};
