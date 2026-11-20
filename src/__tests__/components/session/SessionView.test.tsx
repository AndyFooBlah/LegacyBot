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
 * Tests for the SessionView component.
 * Now uses familyId from route params.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ConnectionStatus } from '../../../types';

// --- Mocks ---

const mockNavigate = vi.fn();
let mockSearch = '';
vi.mock('react-router-dom', () => ({
  useParams: () => ({ familyId: 'family-1', dossierId: 'dossier-1' }),
  useNavigate: () => mockNavigate,
  useSearchParams: () => [new URLSearchParams(mockSearch), vi.fn()],
}));

vi.mock('../../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { uid: 'uid-1' }, loading: false }),
}));

vi.mock('../../../hooks/useFamily', () => ({
  useFamily: () => ({ family: { familyTree: [] }, loading: false }),
  useCurrentRoles: () => ({ isAdmin: false, isStoryteller: true, loading: false }),
}));

let mockDossier: any = {
  storytellerName: 'Margaret',
  personality: 'empathetic',
  selectedVoice: 'Zephyr',
};
let mockQuestions: any[] = [];
let mockDossierLoading = false;

vi.mock('../../../hooks/useDossier', () => ({
  useDossier: () => ({
    dossier: mockDossierLoading ? null : mockDossier,
    questions: mockQuestions,
    loading: mockDossierLoading,
    updateQuestion: vi.fn(),
  }),
}));

const mockStartSession = vi.fn();
const mockStopSession = vi.fn();
const mockReconnectSession = vi.fn().mockResolvedValue(undefined);
const mockFlushPartialSession = vi.fn().mockResolvedValue(undefined);
let mockStatus = ConnectionStatus.DISCONNECTED;
let mockMessages: any[] = [];
let mockSessionId: string | null = null;
const mockSendText = vi.fn();
let mockIsThinking = false;
let mockDeviceError: string | null = null;
let lastHookOptions: any = null;

vi.mock('../../../hooks/useUnifiedSession', () => ({
  useUnifiedSession: (options: any) => { lastHookOptions = options; return {
    sendText: mockSendText,
    isThinking: mockIsThinking,
    deviceError: mockDeviceError,
    status: mockStatus,
    messages: mockMessages,
    isBotSpeaking: false,
    sessionId: mockSessionId,
    startSession: mockStartSession,
    reconnectSession: mockReconnectSession,
    stopSession: mockStopSession,
    flushPartialSession: mockFlushPartialSession,
  }; },
}));

// Mock Visualizer to avoid canvas issues in jsdom
vi.mock('../../../components/session/Visualizer', () => ({
  Visualizer: () => <div data-testid="visualizer" />,
}));

import { SessionView } from '../../../components/session/SessionView';

// Helper: render and flush all pending effects
async function renderView() {
  let result!: ReturnType<typeof render>;
  await act(async () => { result = render(<SessionView />); });
  return result;
}

beforeEach(() => {
  mockSearch = '';
  mockIsThinking = false;
  mockDeviceError = null;
  mockSendText.mockReset().mockResolvedValue(true);
  mockNavigate.mockClear();
  mockStartSession.mockClear();
  mockStopSession.mockClear();
  mockReconnectSession.mockClear();
  mockFlushPartialSession.mockClear();
  mockDossier = { storytellerName: 'Margaret', personality: 'empathetic', selectedVoice: 'Zephyr' };
  mockDossierLoading = false;
  mockStatus = ConnectionStatus.DISCONNECTED;
  mockMessages = [];
  mockSessionId = null;
});

describe('SessionView — loading state', () => {
  it('shows spinner when dossier is loading', async () => {
    mockDossierLoading = true;
    const { container } = await renderView();
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});

describe('SessionView — disconnected state', () => {
  it('shows the storyteller name', async () => {
    await renderView();
    expect(screen.getByText(/Session with Margaret/)).toBeInTheDocument();
  });

  it('shows the start (call) button', async () => {
    await renderView();
    expect(screen.getByLabelText('Start a conversation')).toBeInTheDocument();
  });

  it('shows the "press to start recording" prompt while idle', async () => {
    await renderView();
    expect(screen.getByText(/Press to start recording/)).toBeInTheDocument();
  });

  it('does not show the recorded-time readout before connecting', async () => {
    await renderView();
    expect(screen.queryByLabelText('Recorded time')).not.toBeInTheDocument();
  });

  it('calls startSession when start button is clicked', async () => {
    await renderView();
    fireEvent.click(screen.getByLabelText('Start a conversation'));
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });

  it('shows the Back to Home control for storytellers', async () => {
    await renderView();
    expect(screen.getByLabelText('Back to Home')).toBeInTheDocument();
  });

  it('navigates to family home on Back control click for storytellers', async () => {
    await renderView();
    fireEvent.click(screen.getByLabelText('Back to Home'));
    expect(mockNavigate).toHaveBeenCalledWith('/family/family-1');
  });
});

describe('SessionView — connecting state', () => {
  it('disables the start button while connecting', async () => {
    mockStatus = ConnectionStatus.CONNECTING;
    const { container } = await renderView();
    const spinner = container.querySelector('.animate-spin');
    expect(spinner).not.toBeNull();
  });
});

describe('SessionView — connected state', () => {
  beforeEach(() => {
    mockStatus = ConnectionStatus.CONNECTED;
  });

  it('shows the recorded-time readout while connected', async () => {
    await renderView();
    const timer = screen.getByLabelText('Recorded time');
    expect(timer).toBeInTheDocument();
    expect(timer.textContent).toMatch(/^\d+:\d{2}$/);
  });

  it('shows the live listening status', async () => {
    await renderView();
    expect(screen.getByText(/Listening to Margaret/)).toBeInTheDocument();
  });

  it('shows the end-call (stop) button while connected', async () => {
    await renderView();
    expect(screen.getByLabelText('End conversation')).toBeInTheDocument();
  });

  it('hides the "press to start recording" prompt while connected', async () => {
    await renderView();
    expect(screen.queryByText(/Press to start recording/)).not.toBeInTheDocument();
  });

  it('calls stopSession when stop button is clicked', async () => {
    await renderView();
    fireEvent.click(screen.getByLabelText('End conversation'));
    expect(mockStopSession).toHaveBeenCalledTimes(1);
  });
});

describe('SessionView — error state', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockStatus = ConnectionStatus.ERROR;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows reconnecting banner immediately (no modal yet)', async () => {
    await renderView();
    expect(screen.getByText(/Reconnecting/)).toBeInTheDocument();
    expect(screen.queryByText('Connection Interrupted')).not.toBeInTheDocument();
  });

  it('auto-reconnects (calls reconnectSession) after delay without starting a new session', async () => {
    await renderView();
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockReconnectSession).toHaveBeenCalledTimes(1);
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockFlushPartialSession).not.toHaveBeenCalled();
  });

  it('shows error modal after auto-reconnect attempt fails', async () => {
    // mockReconnectSession is a no-op so status stays ERROR — simulating reconnect failure
    await renderView();
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.getByText('Connection Interrupted')).toBeInTheDocument();
    expect(screen.getByText(/everything you've shared so far has been saved/)).toBeInTheDocument();
    expect(screen.getByText('Try Again')).toBeInTheDocument();
    expect(screen.getByText('End Session')).toBeInTheDocument();
  });

  it('calls reconnectSession (not startSession) when Try Again is clicked', async () => {
    await renderView();
    await act(async () => { vi.advanceTimersByTime(600); });
    mockReconnectSession.mockClear();
    await act(async () => { fireEvent.click(screen.getByText('Try Again')); });
    expect(mockReconnectSession).toHaveBeenCalledTimes(1);
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('flushes and navigates to home on End Session click', async () => {
    await renderView();
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { fireEvent.click(screen.getByText('End Session')); });
    expect(mockFlushPartialSession).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/family/family-1');
  });
});

// ---------------------------------------------------------------------------
describe('written session (?mode=chat, #210)', () => {
  beforeEach(() => {
    mockSearch = 'mode=chat';
    mockStatus = ConnectionStatus.CONNECTED;
    mockMessages = [{ id: 'm1', role: 'bot', text: 'Hello Margaret. Where did you grow up?', timestamp: new Date() }];
  });
  afterEach(() => { mockStatus = ConnectionStatus.DISCONNECTED; mockMessages = []; });

  it('asks the session hook for the chat transport, and voice by default', async () => {
    await renderView();
    expect(lastHookOptions.mode).toBe('chat');
    mockSearch = '';
    await renderView();
    expect(lastHookOptions.mode).toBe('voice');
  });

  it('shows a composer and says plainly that nothing is recorded', async () => {
    await renderView();
    expect(screen.getByLabelText('Your message')).toBeInTheDocument();
    expect(screen.getByText('Not recorded')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is recorded/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Recorded time')).not.toBeInTheDocument();
  });

  it('has no composer in a voice session', async () => {
    mockSearch = '';
    await renderView();
    expect(screen.queryByLabelText('Your message')).not.toBeInTheDocument();
  });

  it('sends the draft and clears the box', async () => {
    await renderView();
    const box = screen.getByLabelText('Your message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '  In a small house by the sea.  ' } });
    await act(async () => { fireEvent.click(screen.getByText('Send')); });
    expect(mockSendText).toHaveBeenCalledWith('In a small house by the sea.');
    expect(box.value).toBe('');
  });

  it('sends on Enter and makes a new line on Shift+Enter', async () => {
    await renderView();
    const box = screen.getByLabelText('Your message');
    fireEvent.change(box, { target: { value: 'One line' } });
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(mockSendText).not.toHaveBeenCalled();
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(mockSendText).toHaveBeenCalledWith('One line');
  });

  it('puts the words back in the box if they could not be answered', async () => {
    mockSendText.mockResolvedValue(false);
    await renderView();
    const box = screen.getByLabelText('Your message') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'A long answer I do not want to lose.' } });
    await act(async () => { fireEvent.click(screen.getByText('Send')); });
    expect(box.value).toBe('A long answer I do not want to lose.');
  });

  it('will not send an empty message, or a second one while a reply is being written', async () => {
    await renderView();
    expect(screen.getByText('Send')).toBeDisabled();
    mockIsThinking = true;
    await renderView();
    const boxes = screen.getAllByLabelText('Your message');
    fireEvent.change(boxes[boxes.length - 1], { target: { value: 'again' } });
    const sends = screen.getAllByText('Send');
    expect(sends[sends.length - 1]).toBeDisabled();
    expect(screen.getAllByText(/is writing…/).length).toBeGreaterThan(0);
  });

  it('shows a failed turn as a message beside the composer, not as a microphone dialog', async () => {
    mockDeviceError = "That didn't go through. Your message is still in the box; please send it again.";
    await renderView();
    expect(screen.getByRole('alert')).toHaveTextContent(/didn't go through/);
    expect(screen.queryByText('Session Stopped')).not.toBeInTheDocument();
  });
});
