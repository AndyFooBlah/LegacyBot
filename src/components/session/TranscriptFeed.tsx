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
 * TranscriptFeed — real-time message display during a live session.
 *
 * Shows the conversation as it happens, with user messages on the right
 * (indigo) and bot messages on the left (white with border). Each message
 * includes a timestamp. The feed auto-scrolls to the latest message.
 *
 * When empty, shows a placeholder message reminding the user that
 * transcripts stream in real-time and no data is ever deleted.
 *
 * References: product_requirements.md §3.2 | GitHub Issue #19
 */

import React, { useEffect, useRef } from 'react';
import { Message } from '../../types';

/** Max length of the rendered tool-argument string before truncation. */
const TOOL_ARGS_MAX = 100;

/**
 * Render a tool call's arguments as a compact, truncated string for the
 * transcript. Returns '' when there are no arguments.
 */
function formatToolArgs(args: Message['toolArgs']): string {
  if (!args || Object.keys(args).length === 0) return '';
  let str: string;
  try {
    str = JSON.stringify(args);
  } catch {
    str = String(args);
  }
  return str.length > TOOL_ARGS_MAX ? `${str.slice(0, TOOL_ARGS_MAX)}…` : str;
}

interface TranscriptFeedProps {
  messages: Message[];
  sessionId: string | null;
  /**
   * When true, show an animated "Listening…" placeholder on the user's side.
   * The native-audio model (gemini-3.1-flash-live-preview) only sends the
   * user's transcription once, at end-of-turn, so their words can't stream in
   * word-by-word like the bot's. This placeholder gives real-time feedback that
   * the mic is open while they speak; it's replaced by their actual bubble when
   * the transcription lands.
   */
  listening?: boolean;
}

export const TranscriptFeed: React.FC<TranscriptFeedProps> = ({ messages, sessionId, listening = false }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive (or the listening state changes)
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, listening]);

  return (
    <div className="w-full max-w-3xl mx-auto h-full flex flex-col space-y-3">
      <div className="flex justify-between items-center px-4 shrink-0">
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest">
          Real-time Archive
        </h3>
        <span className="text-[10px] text-slate-300 font-mono">
          Session: {sessionId || '---'}
        </span>
      </div>
      <div
        ref={scrollRef}
        className="flex-1 min-h-0 bg-white/40 backdrop-blur-sm border border-slate-100 rounded-[2.5rem] p-8 overflow-y-auto space-y-6 shadow-inner scroll-smooth"
      >
        {messages.length === 0 && !listening ? (
          <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-4 opacity-50 text-center">
            <svg className="w-12 h-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
              />
            </svg>
            <p className="italic font-medium">
              Transcripts stream here as you speak. No data is ever deleted.
            </p>
          </div>
        ) : (
          <>
            {messages.map((m) => {
            if (m.role === 'tool') {
              // Show the tool name and its arguments (truncated) so the
              // transcript records what the assistant actually looked up or
              // changed, not just that "a tool ran". Falls back to m.text
              // (`[toolName]`) if the structured toolName is missing.
              const toolName = m.toolName ?? m.text;
              const args = formatToolArgs(m.toolArgs);
              return (
                <div key={m.id} className="flex justify-center">
                  <div className="flex items-start gap-1.5 px-3 py-1.5 bg-slate-100 rounded-xl text-[10px] text-slate-400 font-mono max-w-[90%]">
                    <svg className="w-3 h-3 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="min-w-0 break-all">
                      <span className="font-semibold text-slate-500">{toolName}</span>
                      {args && <span className="text-slate-400"> {args}</span>}
                    </span>
                  </div>
                </div>
              );
            }
            return (
              <div
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] px-5 py-3 rounded-3xl text-sm leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-indigo-600 text-white shadow-lg rounded-br-none'
                      : 'bg-white text-slate-700 border border-slate-200 rounded-bl-none shadow-sm'
                  }`}
                >
                  {m.text}
                  <div
                    className={`text-[9px] mt-1 opacity-50 ${
                      m.role === 'user' ? 'text-white' : 'text-slate-400'
                    }`}
                  >
                    {m.timestamp.toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
              </div>
            );
            })}
            {listening && (
              <div className="flex justify-end">
                <div className="max-w-[85%] px-5 py-3 rounded-3xl rounded-br-none bg-indigo-100 border border-indigo-200 text-indigo-500 flex items-center gap-2.5 shadow-sm">
                  <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3z" />
                    <path d="M19 11a1 1 0 10-2 0 5 5 0 01-10 0 1 1 0 10-2 0 7 7 0 006 6.92V21a1 1 0 102 0v-3.08A7 7 0 0019 11z" />
                  </svg>
                  <span className="text-sm italic">Listening</span>
                  <span className="flex items-end gap-1 pb-0.5" aria-hidden="true">
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};
