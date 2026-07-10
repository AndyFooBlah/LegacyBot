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
 * Tests for the ErrorBoundary component.
 *
 * Verifies that:
 *   - Children render normally when no error occurs
 *   - Rendering errors are caught and a friendly message is shown
 *   - Errors are logged to the console
 *   - The "Refresh" button triggers page reload
 *
 * References: design.md §5.3 (Priority 1) | src/components/shared/ErrorBoundary.tsx
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ErrorBoundary } from '../../../components/shared/ErrorBoundary';

// Suppress console.error noise from React's error boundary internals
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A component that throws during render — used to trigger the boundary. */
function ThrowingComponent({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  it('renders children when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Hello, world</div>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Hello, world')).toBeInTheDocument();
  });

  it('catches rendering errors and shows a friendly message', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test error" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(
      screen.getByText(/your stories are safe/i),
    ).toBeInTheDocument();
  });

  it('shows a Refresh button in the error state', () => {
    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test error" />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Refresh')).toBeInTheDocument();
  });

  it('calls window.location.reload when Refresh is clicked', () => {
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { reload: reloadMock },
      writable: true,
    });

    render(
      <ErrorBoundary>
        <ThrowingComponent message="Test error" />
      </ErrorBoundary>,
    );

    fireEvent.click(screen.getByText('Refresh'));
    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('logs the error to the console', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <ErrorBoundary>
        <ThrowingComponent message="Logged error" />
      </ErrorBoundary>,
    );

    // React's error boundary calls console.error + our componentDidCatch
    expect(consoleSpy).toHaveBeenCalled();
    const ourLog = consoleSpy.mock.calls.find(
      (call) => call[0] === '[ErrorBoundary] Caught error:',
    );
    expect(ourLog).toBeDefined();
  });
});
