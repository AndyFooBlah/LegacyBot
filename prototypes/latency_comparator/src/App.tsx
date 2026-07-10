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

import { useState, useEffect, useRef } from 'react';
import './App.css';
import { backstory } from './context/backstory';
import { conversationHistory as initialConversation } from './context/conversation_history';
import { interviewPlan } from './context/interview_plan';
import { HybridService } from './services/hybridService';
import type { StepTimings } from './services/hybridService';
import { IntegratedService } from './services/integratedService';

type Architecture = 'integrated' | 'hybrid';
type Status = 'idle' | 'listening' | 'thinking' | 'speaking';
type ConversationTurn = { speaker: 'user' | 'bot'; text: string };

function App() {
  const [architecture, setArchitecture] = useState<Architecture>('hybrid');
  const [status, setStatus] = useState<Status>('idle');
  const [transcript, setTranscript] = useState<ConversationTurn[]>([...initialConversation]);
  const [inProgressTranscript, setInProgressTranscript] = useState<string>('');
  const [latency, setLatency] = useState({ total: 0, stt: 0, llm: 0, tts: 0 });
  const [hasPermission, setHasPermission] = useState(false);

  const serviceRef = useRef<HybridService | IntegratedService | null>(null);

  const context = `
    ${backstory}
    **Interview Plan:**
    ${interviewPlan.map(item => `- ${item}`).join('\n')}
  `;

  useEffect(() => {
    const serviceConfig = {
      onTranscriptionUpdate: (text: string, isFinal: boolean) => {
        if (isFinal) {
          if (text) {
            setTranscript(prev => [...prev, { speaker: 'user', text }]);
          }
          setInProgressTranscript('');
        } else {
          setInProgressTranscript(text);
        }
      },
      onBotStartedSpeaking: () => {
        setStatus('speaking');
      },
      onBotThinking: () => {
        setStatus('thinking');
      },
      onBotFinishedSpeaking: () => {
        // Fallback for when TTS is skipped or errors — audio.onended handles the normal path.
        setStatus('idle');
      },
      onStepTimings: (timings: StepTimings) => {
        setLatency({
          total: timings.totalMs,
          stt: timings.sttMs,
          llm: timings.llmMs,
          tts: timings.ttsMs,
        });
      },
    };

    const tokenProvider = async () => {
      const key = import.meta.env.VITE_GEMINI_API_KEY;
      if (!key) {
        const promptKey = prompt('VITE_GEMINI_API_KEY not found in environment. Please enter your Gemini API key:');
        return promptKey || '';
      }
      return key;
    };

    if (architecture === 'hybrid') {
      serviceRef.current = new HybridService(serviceConfig, tokenProvider);
    } else {
      serviceRef.current = new IntegratedService(serviceConfig, tokenProvider);
    }
  }, [architecture]);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        setHasPermission(true);
        stream.getTracks().forEach(track => track.stop());
      })
      .catch(() => setHasPermission(false));
  }, []);

  const handleStartStop = async () => {
    if (status === 'idle') {
      setStatus('listening');
      await serviceRef.current?.start(context, transcript);
    } else {
      // For hybrid: stop() triggers final LLM+TTS pass then sets status via callbacks.
      // For integrated: disconnect() ends the session immediately.
      if (serviceRef.current instanceof HybridService) {
        await serviceRef.current.stop(context, transcript);
      } else {
        serviceRef.current?.disconnect();
        setStatus('idle');
      }
    }
  };

  return (
    <div className="container">
      <header>
        <h1>Conversational AI Latency Comparator</h1>
        <p>Interview with Dr. Eleanor Vance</p>
      </header>

      <div className="controls">
        <div className="control-group">
          <label htmlFor="architecture">Architecture:</label>
          <select
            id="architecture"
            value={architecture}
            onChange={(e) => setArchitecture(e.target.value as Architecture)}
            disabled={status !== 'idle'}
          >
            <option value="hybrid">Hybrid (Gradium + Gemini)</option>
            <option value="integrated">Integrated (Gemini Live)</option>
          </select>
        </div>
        <button onClick={handleStartStop} className={`status-${status}`} disabled={!hasPermission}>
          {status === 'idle'
            ? 'Start Interview'
            : status === 'listening'
              ? architecture === 'integrated'
                ? 'Connected — speak naturally (click to disconnect)'
                : 'Listening… (VAD auto-stops | click to stop manually)'
              : `${status.charAt(0).toUpperCase() + status.slice(1)}…`}
        </button>
      </div>

      <div className="metrics">
        <h2>Performance Metrics (last turn)</h2>
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <tbody>
            <tr>
              <td><strong>Total (last word → first audio)</strong></td>
              <td style={{ textAlign: 'right' }}>{latency.total > 0 ? `${latency.total.toFixed(0)} ms` : '—'}</td>
            </tr>
            {architecture === 'hybrid' && (
              <>
                <tr>
                  <td style={{ paddingLeft: '1em' }}>STT lag (last segment vs VAD stop)</td>
                  <td style={{ textAlign: 'right' }}>
                    {latency.total > 0
                      ? `${latency.stt >= 0 ? '+' : ''}${latency.stt.toFixed(0)} ms`
                      : '—'}
                  </td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: '1em' }}>LLM (Gemini 2.5 Flash)</td>
                  <td style={{ textAlign: 'right' }}>{latency.total > 0 ? `${latency.llm.toFixed(0)} ms` : '—'}</td>
                </tr>
                <tr>
                  <td style={{ paddingLeft: '1em' }}>TTS (Gradium)</td>
                  <td style={{ textAlign: 'right' }}>{latency.total > 0 ? `${latency.tts.toFixed(0)} ms` : '—'}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <div className="transcript">
        <h2>Conversation Transcript</h2>
        <div className="transcript-log">
          {transcript.map((entry, index) => (
            <div key={index} className={`turn turn-${entry.speaker}`}>
              <strong>{entry.speaker === 'bot' ? 'Interviewer' : 'Eleanor'}:</strong>
              <p>{entry.text}</p>
            </div>
          ))}
          {inProgressTranscript && (
            <div className="turn turn-user-in-progress">
              <strong>Eleanor:</strong>
              <p><em>{inProgressTranscript}</em></p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
