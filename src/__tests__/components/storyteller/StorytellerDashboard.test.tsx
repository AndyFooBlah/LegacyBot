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
 * Tests for the StorytellerDashboard component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ familyId: 'family-1' }),
  useNavigate: () => mockNavigate,
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'uid-1' }, loading: false }),
}));

let mockDossiers: any[] = [];
let mockLoading = false;

vi.mock('../../../hooks/useDossier', () => ({
  useDossierList: () => ({
    dossiers: mockDossiers,
    loading: mockLoading,
  }),
}));

// Mock Firestore so DossierSessions' onSnapshot call is a no-op
vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  query: vi.fn(),
  orderBy: vi.fn(),
  onSnapshot: vi.fn((_q, cb) => {
    cb({ docs: [] });
    return () => {};
  }),
}));

vi.mock('../../../services/firebase', () => ({
  db: {},
}));

import { StorytellerDashboard } from '../../../components/storyteller/StorytellerDashboard';

beforeEach(() => {
  mockNavigate.mockClear();
  mockDossiers = [];
  mockLoading = false;
});

describe('StorytellerDashboard — loading', () => {
  it('shows spinner when loading', () => {
    mockLoading = true;
    const { container } = render(<StorytellerDashboard />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('StorytellerDashboard — no dossiers', () => {
  it('shows welcome message when no dossiers assigned', () => {
    render(<StorytellerDashboard />);
    expect(screen.getByText('Welcome!')).toBeInTheDocument();
    expect(screen.getByText(/hasn't set things up/)).toBeInTheDocument();
  });
});

describe('StorytellerDashboard — with dossiers', () => {
  beforeEach(() => {
    mockDossiers = [
      { id: 'd1', storytellerName: 'Margaret', storytellerContext: 'Born in 1935' },
    ];
  });

  it('displays welcome with storyteller name', () => {
    render(<StorytellerDashboard />);
    expect(screen.getByText('Welcome, Margaret')).toBeInTheDocument();
  });

  it('does not display storyteller context', () => {
    render(<StorytellerDashboard />);
    expect(screen.queryByText('Born in 1935')).not.toBeInTheDocument();
  });

  it('shows Start a Conversation button', () => {
    render(<StorytellerDashboard />);
    expect(screen.getByText('Start a Conversation')).toBeInTheDocument();
  });

  it('shows Past Sessions section heading', () => {
    render(<StorytellerDashboard />);
    expect(screen.getByText('Past Sessions')).toBeInTheDocument();
  });

  it('navigates to session on Start a Conversation click', () => {
    render(<StorytellerDashboard />);
    fireEvent.click(screen.getByText('Start a Conversation'));
    expect(mockNavigate).toHaveBeenCalledWith('/family/family-1/dossier/d1/session');
  });
});
