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
 * Tests for the MemberManagement component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useParams: () => ({ familyId: 'family-1' }),
  useNavigate: () => mockNavigate,
}));

let mockMembers: any[] = [];
let mockMembersLoading = false;
let mockInvitations: any[] = [];
let mockInvitesLoading = false;

vi.mock('../../../hooks/useFamily', () => ({
  useFamilyMembers: () => ({
    members: mockMembers,
    loading: mockMembersLoading,
  }),
}));

vi.mock('../../../hooks/useInvitations', () => ({
  useFamilyInvitations: () => ({
    invitations: mockInvitations,
    loading: mockInvitesLoading,
    createInvite: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'uid-1' }, loading: false }),
}));

vi.mock('../../../hooks/useDossier', () => ({
  useDossierList: () => ({
    dossiers: [],
    loading: false,
  }),
}));

import { MemberManagement } from '../../../components/family/MemberManagement';

beforeEach(() => {
  mockNavigate.mockClear();
  mockMembers = [];
  mockMembersLoading = false;
  mockInvitations = [];
  mockInvitesLoading = false;
});

describe('MemberManagement — loading', () => {
  it('shows spinner when loading', () => {
    mockMembersLoading = true;
    const { container } = render(<MemberManagement />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('MemberManagement — member list', () => {
  beforeEach(() => {
    mockMembers = [
      { uid: 'uid-1', displayName: 'Alice Admin', email: 'alice@test.com', roles: ['admin'] },
      { uid: 'uid-2', displayName: 'Bob Storyteller', email: 'bob@test.com', roles: ['storyteller'] },
    ];
  });

  it('displays member names', () => {
    render(<MemberManagement />);
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    expect(screen.getByText('Bob Storyteller')).toBeInTheDocument();
  });

  it('displays role badges', () => {
    render(<MemberManagement />);
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('storyteller')).toBeInTheDocument();
  });

  it('shows Invite Member button', () => {
    render(<MemberManagement />);
    expect(screen.getByText('+ Invite Member')).toBeInTheDocument();
  });

  it('shows invite form when button clicked', () => {
    render(<MemberManagement />);
    fireEvent.click(screen.getByText('+ Invite Member'));
    expect(screen.getByText('Invite a Family Member')).toBeInTheDocument();
  });
});

describe('MemberManagement — pending invitations', () => {
  it('shows pending invitations section', () => {
    mockInvitations = [
      { id: 'inv-1', email: 'pending@test.com', roles: ['storyteller'], status: 'pending' },
    ];

    render(<MemberManagement />);
    expect(screen.getByText('Pending Invitations')).toBeInTheDocument();
    expect(screen.getByText('pending@test.com')).toBeInTheDocument();
  });
});
