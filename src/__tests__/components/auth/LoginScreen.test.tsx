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
 * Tests for the LoginScreen component.
 *
 * Verifies form validation, error display, loading states,
 * sign-in/sign-up mode switching, and all authentication paths.
 *
 * References: design.md §5.3 (Priority 2) | src/components/auth/LoginScreen.tsx
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { LoginScreen } from '../../../components/auth/LoginScreen';

let mockGoogleSignIn: Mock<() => Promise<void>>;
let mockEmailSignIn: Mock<(email: string, password: string) => Promise<void>>;
let mockEmailSignUp: Mock<(email: string, password: string) => Promise<void>>;

beforeEach(() => {
  mockGoogleSignIn = vi.fn().mockResolvedValue(undefined);
  mockEmailSignIn = vi.fn().mockResolvedValue(undefined);
  mockEmailSignUp = vi.fn().mockResolvedValue(undefined);
});

function renderLogin() {
  return render(
    <LoginScreen
      onGoogleSignIn={mockGoogleSignIn}
      onEmailSignIn={mockEmailSignIn}
      onEmailSignUp={mockEmailSignUp}
    />,
  );
}

describe('LoginScreen — rendering', () => {
  it('shows the BiographyBot heading', () => {
    renderLogin();
    expect(screen.getByText('BiographyBot')).toBeInTheDocument();
  });

  it('shows the tagline', () => {
    renderLogin();
    expect(screen.getByText(/Tell your family's story/)).toBeInTheDocument();
  });

  it('shows the Google sign-in button', () => {
    renderLogin();
    expect(screen.getByText('Continue with Google')).toBeInTheDocument();
  });

  it('shows the email and password fields', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('you@example.com')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
  });

  it('shows the Sign In button by default', () => {
    renderLogin();
    expect(screen.getByText('Sign In')).toBeInTheDocument();
  });

  it('shows create account link', () => {
    renderLogin();
    expect(screen.getByText('Create an account')).toBeInTheDocument();
  });
});

describe('LoginScreen — Google sign-in', () => {
  it('calls onGoogleSignIn when Google button is clicked', async () => {
    renderLogin();

    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(mockGoogleSignIn).toHaveBeenCalledTimes(1);
    });
  });

  it('shows error when Google sign-in fails', async () => {
    mockGoogleSignIn.mockRejectedValueOnce(new Error('Popup closed'));
    renderLogin();

    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(screen.getByText('Popup closed')).toBeInTheDocument();
    });
  });

  it('disables buttons during loading', async () => {
    mockGoogleSignIn.mockImplementation(() => new Promise(() => {}));
    renderLogin();

    fireEvent.click(screen.getByText('Continue with Google'));

    await waitFor(() => {
      expect(screen.getByText('Continue with Google')).toBeDisabled();
      expect(screen.getByText('Signing in...')).toBeDisabled();
    });
  });
});

describe('LoginScreen — email sign-in', () => {
  it('calls onEmailSignIn with email and password', async () => {
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(mockEmailSignIn).toHaveBeenCalledWith('test@example.com', 'secret123');
    });
  });

  it('shows validation error when fields are empty', async () => {
    renderLogin();

    fireEvent.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(screen.getByText('Please enter both email and password.')).toBeInTheDocument();
    });

    expect(mockEmailSignIn).not.toHaveBeenCalled();
  });

  it('shows friendly error for invalid credentials', async () => {
    mockEmailSignIn.mockRejectedValueOnce({ code: 'auth/invalid-credential' });
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrong' },
    });
    fireEvent.click(screen.getByText('Sign In'));

    await waitFor(() => {
      expect(screen.getByText('Incorrect email or password.')).toBeInTheDocument();
    });
  });

  it('submits on Enter key via form', async () => {
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'pass123' },
    });
    fireEvent.submit(screen.getByPlaceholderText('you@example.com').closest('form')!);

    await waitFor(() => {
      expect(mockEmailSignIn).toHaveBeenCalledWith('test@example.com', 'pass123');
    });
  });
});

describe('LoginScreen — sign-up mode', () => {
  it('switches to sign-up mode when Create an account is clicked', () => {
    renderLogin();
    fireEvent.click(screen.getByText('Create an account'));

    expect(screen.getByText('Create Account')).toBeInTheDocument();
    expect(screen.getByText('Sign in')).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Choose a password/)).toBeInTheDocument();
  });

  it('calls onEmailSignUp in sign-up mode', async () => {
    renderLogin();
    fireEvent.click(screen.getByText('Create an account'));

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Choose a password/), {
      target: { value: 'newpass123' },
    });
    fireEvent.click(screen.getByText('Create Account'));

    await waitFor(() => {
      expect(mockEmailSignUp).toHaveBeenCalledWith('new@example.com', 'newpass123');
    });

    expect(mockEmailSignIn).not.toHaveBeenCalled();
  });

  it('validates minimum password length on sign-up', async () => {
    renderLogin();
    fireEvent.click(screen.getByText('Create an account'));

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'new@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Choose a password/), {
      target: { value: '12345' },
    });
    fireEvent.click(screen.getByText('Create Account'));

    await waitFor(() => {
      expect(screen.getByText('Password must be at least 6 characters.')).toBeInTheDocument();
    });

    expect(mockEmailSignUp).not.toHaveBeenCalled();
  });

  it('shows friendly error for email-already-in-use', async () => {
    mockEmailSignUp.mockRejectedValueOnce({ code: 'auth/email-already-in-use' });
    renderLogin();
    fireEvent.click(screen.getByText('Create an account'));

    fireEvent.change(screen.getByPlaceholderText('you@example.com'), {
      target: { value: 'existing@example.com' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Choose a password/), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByText('Create Account'));

    await waitFor(() => {
      expect(screen.getByText(/already exists/)).toBeInTheDocument();
    });
  });

  it('switches back to sign-in mode', () => {
    renderLogin();
    fireEvent.click(screen.getByText('Create an account'));
    fireEvent.click(screen.getByText('Sign in'));

    expect(screen.getByText('Sign In')).toBeInTheDocument();
    expect(screen.getByText('Create an account')).toBeInTheDocument();
  });

  it('clears error when switching modes', async () => {
    renderLogin();

    // Trigger an error in sign-in mode
    fireEvent.click(screen.getByText('Sign In'));
    await waitFor(() => {
      expect(screen.getByText('Please enter both email and password.')).toBeInTheDocument();
    });

    // Switch to sign-up — error should be cleared
    fireEvent.click(screen.getByText('Create an account'));
    expect(screen.queryByText('Please enter both email and password.')).not.toBeInTheDocument();
  });
});
