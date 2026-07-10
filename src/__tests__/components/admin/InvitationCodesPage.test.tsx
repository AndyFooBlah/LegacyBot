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
 * Tests for the superadmin InvitationCodesPage. Covers:
 *   - Non-superadmins see the refusal view
 *   - Superadmins see generated codes, redemption counts, and actions
 *   - Generate / deactivate / reactivate flows trigger the service wrappers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { InvitationCode } from '../../../types';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

interface MockUser { uid: string }
let mockUser: MockUser | null = null;
let mockIsSuperadmin = false;
let mockLoading = false;
vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: mockUser, loading: mockLoading, isSuperadmin: mockIsSuperadmin }),
}));

const mockGenerate = vi.fn();
const mockDeactivate = vi.fn();
const mockReactivate = vi.fn();
const mockListCodes = vi.fn();
const mockListRedemptions = vi.fn();
vi.mock('../../../services/invitationCodes', () => ({
  generateInvitationCode: (...args: unknown[]) => mockGenerate(...args),
  deactivateInvitationCode: (...args: unknown[]) => mockDeactivate(...args),
  reactivateInvitationCode: (...args: unknown[]) => mockReactivate(...args),
  listInvitationCodes: (...args: unknown[]) => mockListCodes(...args),
  listRedemptions: (...args: unknown[]) => mockListRedemptions(...args),
}));

import { InvitationCodesPage } from '../../../components/admin/InvitationCodesPage';

function makeCode(overrides: Partial<InvitationCode> = {}): InvitationCode {
  return {
    id: 'ABC123',
    createdBy: 'uid-admin',
    active: true,
    redemptionCount: 0,
    createdAt: { toDate: () => new Date('2026-04-10T00:00:00Z') } as unknown as InvitationCode['createdAt'],
    ...overrides,
  };
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockUser = { uid: 'uid-1' };
  mockIsSuperadmin = true;
  mockLoading = false;
  mockGenerate.mockReset();
  mockDeactivate.mockReset();
  mockReactivate.mockReset();
  mockListCodes.mockReset();
  mockListRedemptions.mockReset();
  mockListCodes.mockResolvedValue([]);
});

describe('InvitationCodesPage — access control', () => {
  it('shows refusal view for signed-out users', async () => {
    mockUser = null;
    mockIsSuperadmin = false;
    render(<InvitationCodesPage />);
    expect(screen.getByText(/Superadmin only/)).toBeInTheDocument();
  });

  it('shows refusal view when signed in without superadmin claim', async () => {
    mockIsSuperadmin = false;
    render(<InvitationCodesPage />);
    expect(screen.getByText(/Superadmin only/)).toBeInTheDocument();
    expect(mockListCodes).not.toHaveBeenCalled();
  });

  it('navigates home when the refusal CTA is clicked', async () => {
    mockUser = null;
    mockIsSuperadmin = false;
    render(<InvitationCodesPage />);
    fireEvent.click(screen.getByText('Go home'));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});

describe('InvitationCodesPage — listing', () => {
  it('renders the empty state when no codes exist', async () => {
    mockListCodes.mockResolvedValue([]);
    render(<InvitationCodesPage />);
    await waitFor(() => {
      expect(screen.getByText(/No invitation codes yet/)).toBeInTheDocument();
    });
  });

  it('renders code cards with active/inactive status', async () => {
    mockListCodes.mockResolvedValue([
      makeCode({ id: 'ABC123', active: true, redemptionCount: 2 }),
      makeCode({ id: 'XYZ789', active: false, redemptionCount: 0 }),
    ]);
    render(<InvitationCodesPage />);
    await waitFor(() => {
      expect(screen.getByText('ABC123')).toBeInTheDocument();
    });
    expect(screen.getByText('XYZ789')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByText(/2 redemptions/)).toBeInTheDocument();
  });
});

describe('InvitationCodesPage — generate', () => {
  it('calls the service with the typed description and refreshes', async () => {
    mockListCodes.mockResolvedValueOnce([]);
    mockGenerate.mockResolvedValue('ABC123');
    mockListCodes.mockResolvedValueOnce([makeCode({ id: 'ABC123' })]);

    render(<InvitationCodesPage />);
    await waitFor(() => expect(mockListCodes).toHaveBeenCalledTimes(1));

    const input = screen.getByPlaceholderText(/Description \(optional\)/);
    fireEvent.change(input, { target: { value: 'launch — friends' } });
    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith('launch — friends');
    });
    await waitFor(() => expect(mockListCodes).toHaveBeenCalledTimes(2));
  });

  it('omits blank descriptions', async () => {
    mockGenerate.mockResolvedValue('XYZ789');
    render(<InvitationCodesPage />);
    await waitFor(() => expect(mockListCodes).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText('Generate'));
    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith(undefined);
    });
  });
});

describe('InvitationCodesPage — deactivate / reactivate', () => {
  it('deactivates an active code', async () => {
    mockListCodes.mockResolvedValueOnce([makeCode({ id: 'ABC123', active: true })]);
    mockDeactivate.mockResolvedValue(undefined);
    mockListCodes.mockResolvedValueOnce([makeCode({ id: 'ABC123', active: false })]);

    render(<InvitationCodesPage />);
    await waitFor(() => expect(screen.getByText('ABC123')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Deactivate'));
    await waitFor(() => {
      expect(mockDeactivate).toHaveBeenCalledWith('ABC123');
    });
  });

  it('reactivates an inactive code', async () => {
    mockListCodes.mockResolvedValueOnce([makeCode({ id: 'ABC123', active: false })]);
    mockReactivate.mockResolvedValue(undefined);
    mockListCodes.mockResolvedValueOnce([makeCode({ id: 'ABC123', active: true })]);

    render(<InvitationCodesPage />);
    await waitFor(() => expect(screen.getByText('ABC123')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Reactivate'));
    await waitFor(() => {
      expect(mockReactivate).toHaveBeenCalledWith('ABC123');
    });
  });
});

describe('InvitationCodesPage — redemptions', () => {
  it('loads and displays redemptions when View users is clicked', async () => {
    mockListCodes.mockResolvedValue([makeCode({ id: 'ABC123', redemptionCount: 1 })]);
    mockListRedemptions.mockResolvedValue([
      {
        id: 'uid-1',
        userEmail: 'friend@example.com',
        userDisplayName: 'Friend',
        familyId: 'fam-1',
        redeemedAt: { toDate: () => new Date('2026-04-12T00:00:00Z') },
      },
    ]);

    render(<InvitationCodesPage />);
    await waitFor(() => expect(screen.getByText('ABC123')).toBeInTheDocument());

    fireEvent.click(screen.getByText('View users'));
    await waitFor(() => {
      expect(screen.getByText('Friend')).toBeInTheDocument();
    });
    expect(screen.getByText(/friend@example.com/)).toBeInTheDocument();
    expect(mockListRedemptions).toHaveBeenCalledWith('ABC123');
  });
});
