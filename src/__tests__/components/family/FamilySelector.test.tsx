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
 * Tests for the FamilySelector component.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

const mockUser = { uid: 'uid-1', email: 'test@test.com', displayName: 'Test', getIdToken: vi.fn().mockResolvedValue('mock-token') };
let mockIsSuperadmin = false;
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: false, isSuperadmin: mockIsSuperadmin }),
}));

let mockFamilyIds: string[] = [];
vi.mock('../../../hooks/useFamily', () => ({
  getUserFamilyIds: () => Promise.resolve(mockFamilyIds),
}));

import { FamilySelector } from '../../../components/family/FamilySelector';

beforeEach(() => {
  mockNavigate.mockClear();
  mockFamilyIds = [];
  mockIsSuperadmin = false;
});

describe('FamilySelector — no families', () => {
  it('shows Create a Family button when user has no families', async () => {
    render(<FamilySelector />);

    await waitFor(() => {
      expect(screen.getByText('Create a Family')).toBeInTheDocument();
    });
  });

  it('shows I Have an Invite Link button', async () => {
    render(<FamilySelector />);

    await waitFor(() => {
      expect(screen.getByText('I Have an Invite Link')).toBeInTheDocument();
    });
  });

  it('navigates to create-family on button click', async () => {
    render(<FamilySelector />);

    await waitFor(() => {
      expect(screen.getByText('Create a Family')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Create a Family'));
    expect(mockNavigate).toHaveBeenCalledWith('/create-family');
  });
});

describe('FamilySelector — single family', () => {
  it('auto-redirects to the family', async () => {
    mockFamilyIds = ['family-1'];
    render(<FamilySelector />);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/family/family-1', { replace: true });
    });
  });
});

describe('FamilySelector — multiple families', () => {
  it('shows family list', async () => {
    mockFamilyIds = ['family-1', 'family-2'];
    render(<FamilySelector />);

    await waitFor(() => {
      expect(screen.getByText('Your Families')).toBeInTheDocument();
    });
  });
});

describe('FamilySelector — superadmin link', () => {
  it('hides the invitation-codes link for non-superadmins', async () => {
    render(<FamilySelector />);
    await waitFor(() => {
      expect(screen.getByText('Create a Family')).toBeInTheDocument();
    });
    expect(screen.queryByText(/Superadmin: Invitation codes/)).toBeNull();
  });

  it('shows the invitation-codes link for superadmins (0 families)', async () => {
    mockIsSuperadmin = true;
    render(<FamilySelector />);
    await waitFor(() => {
      expect(screen.getByText(/Superadmin: Invitation codes/)).toBeInTheDocument();
    });
  });

  it('shows the invitation-codes link for superadmins (multiple families)', async () => {
    mockIsSuperadmin = true;
    mockFamilyIds = ['family-1', 'family-2'];
    render(<FamilySelector />);
    await waitFor(() => {
      expect(screen.getByText(/Superadmin: Invitation codes/)).toBeInTheDocument();
    });
  });

  it('navigates to the invitation codes page when superadmin link clicked', async () => {
    mockIsSuperadmin = true;
    render(<FamilySelector />);
    await waitFor(() => {
      expect(screen.getByText(/Superadmin: Invitation codes/)).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText(/Superadmin: Invitation codes/));
    expect(mockNavigate).toHaveBeenCalledWith('/admin/invitation-codes');
  });
});
