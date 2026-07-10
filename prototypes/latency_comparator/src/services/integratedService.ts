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

import { GoogleGenAI, Modality } from '@google/genai';
import type { LiveSession, LiveServerMessage } from '@google/genai';
import type { StepTimings } from './hybridService';

export interface IntegratedServiceConfig {
  onTranscriptionUpdate: (text: string, isFinal: boolean) => void;
  onBotStartedSpeaking: () => void;
  onBotThinking: () => void;
  onBotFinishedSpeaking: () => void;
  onStepTimings: (timings: StepTimings) => void;
}

// HH:MM:SS.mmm timestamp for console logs.
const ts = () => new Date().toISOString().slice(11, 23);

// Encode raw bytes to base64 for Gemini API transport.
function encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Decode base64 string from Gemini API back to bytes.
function decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Convert raw Int16 PCM bytes to a Web Audio API AudioBuffer.
function pcmToAudioBuffer(data: Uint8Array, ctx: AudioContext, sampleRate: number): AudioBuffer {
  const int16 = new Int16Array(data.buffer, data.byteOffset, data.byteLength / 2);
  const buffer = ctx.createBuffer(1, int16.length, sampleRate);
  const out = buffer.getChannelData(0);
  for (let i = 0; i < int16.length; i++) out[i] = int16[i] / 32768.0;
  return buffer;
}

export class IntegratedService {
  private config: IntegratedServiceConfig;
  private tokenProvider: () => Promise<string>;
  private genAI: GoogleGenAI | null = null;

  private session: LiveSession | null = null;
  private inputCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  // Audio playback scheduling — keeps chunks gapless.
  private nextStartTime = 0;
  private lastSourceNode: AudioBufferSourceNode | null = null;
  private activeSources = new Set<AudioBufferSourceNode>();

  // Latency measurement.
  // lastInputTranscriptTime is our best proxy for "user finished talking"
  // since Gemini Live doesn't expose an explicit VAD trigger event.
  private lastInputTranscriptTime = 0;
  private speakingStarted = false;

  // Transcripts accumulated within the current turn.
  private currentInputTranscript = '';
  private currentOutputTranscript = '';

  constructor(config: IntegratedServiceConfig, tokenProvider: () => Promise<string>) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    console.log(`[${ts()}] [Integrated] Service initialized.`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public async start(context: string, history: { speaker: string; text: string }[]): Promise<void> {
    const apiKey = await this.tokenProvider();
    if (!apiKey) throw new Error('Gemini API key (or ephemeral token) is required.');
    this.genAI = new GoogleGenAI({ apiKey });

    this.currentInputTranscript = '';
    this.currentOutputTranscript = '';
    this.speakingStarted = false;
    this.lastInputTranscriptTime = 0;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Capture at 16 kHz — the rate Gemini Live requires for PCM input.
    this.inputCtx = new AudioContext({ sampleRate: 16000 });
    // Separate playback context at Gemini's output sample rate (24 kHz).
    this.playbackCtx = new AudioContext({ sampleRate: 24000 });

    const systemInstruction = this.buildSystemInstruction(context, history);

    console.log(`[${ts()}] [Integrated] Connecting to Gemini Live…`);

    if (!this.genAI) throw new Error('GoogleGenAI not initialized');
    this.session = await this.genAI.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
          console.log(`[${ts()}] [Integrated] Connected. Starting mic stream.`);
          this.startMicStreaming();
        },
        onmessage: async (msg: LiveServerMessage) => {
          await this.handleMessage(msg);
        },
        onerror: (err: ErrorEvent) => {
          console.error(`[${ts()}] [Integrated] Connection error:`, err);
        },
        onclose: () => {
          console.log(`[${ts()}] [Integrated] Connection closed.`);
        },
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
      },
    });

    console.log(`[${ts()}] [Integrated] Session ready — listening.`);
  }

  public disconnect(): void {
    this.stopMicStreaming();
    if (this.session) {
      this.session.close();
      this.session = null;
    }
    // Cancel any pending audio.
    for (const src of this.activeSources) {
      try { src.stop(); } catch { /* already stopped */ }
    }
    this.activeSources.clear();
    this.playbackCtx?.close();
    this.playbackCtx = null;
  }

  // ---------------------------------------------------------------------------
  // Message handler
  // ---------------------------------------------------------------------------

  private async handleMessage(msg: LiveServerMessage): Promise<void> {
    const raw = JSON.stringify(msg);
    console.log(`[${ts()}] [Integrated] Raw message (${raw.length} chars): ${raw.substring(0, 300)}${raw.length > 300 ? '…' : ''}`);

    // --- User speech transcription ---
    // Track the timestamp of the most recent input transcript as a proxy
    // for when the user stopped talking (Gemini doesn't expose a VAD event).
    if (msg.serverContent?.inputTranscription?.text) {
      const text = msg.serverContent.inputTranscription.text;
      this.currentInputTranscript += text;
      this.lastInputTranscriptTime = performance.now();
      console.log(`[${ts()}] [Integrated] Input: "${text}"`);
      this.config.onTranscriptionUpdate(this.currentInputTranscript.trim(), false);
    }

    // --- Bot output transcription ---
    // The first outputTranscription message is a reliable signal that Gemini
    // has finished processing the user's turn and is generating a response.
    if (msg.serverContent?.outputTranscription?.text) {
      const text = msg.serverContent.outputTranscription.text;
      this.currentOutputTranscript += text;
      if (!this.speakingStarted) {
        console.log(`[${ts()}] [Integrated] Bot generating response.`);
        this.config.onBotThinking();
      }
    }

    // --- Bot audio ---
    const audioData = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (audioData && this.playbackCtx) {
      const pcmBytes = decode(audioData);
      const audioBuffer = pcmToAudioBuffer(pcmBytes, this.playbackCtx, 24000);

      const source = this.playbackCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.playbackCtx.destination);

      const startAt = Math.max(this.nextStartTime, this.playbackCtx.currentTime + 0.05);
      source.start(startAt);
      this.nextStartTime = startAt + audioBuffer.duration;
      this.lastSourceNode = source;
      this.activeSources.add(source);

      if (!this.speakingStarted) {
        this.speakingStarted = true;
        const firstBotAudioTime = performance.now();
        const totalMs = this.lastInputTranscriptTime > 0
          ? firstBotAudioTime - this.lastInputTranscriptTime
          : 0;
        console.log(
          `[${ts()}] [Integrated] First bot audio playing. ` +
          `Latency (last input transcript → first audio): ${totalMs.toFixed(0)}ms`
        );
        // For integrated architecture, STT/LLM/TTS aren't separate steps.
        this.config.onStepTimings({ sttMs: 0, llmMs: 0, ttsMs: 0, totalMs });
        this.config.onBotStartedSpeaking();
      }

      source.onended = () => {
        this.activeSources.delete(source);
        if (this.activeSources.size === 0) {
          console.log(`[${ts()}] [Integrated] Bot finished speaking.`);
          this.config.onBotFinishedSpeaking();
          // Reset for the next turn.
          this.speakingStarted = false;
          this.nextStartTime = 0;
        }
      };
    }

    // --- Turn complete ---
    if (msg.serverContent?.turnComplete) {
      console.log(`[${ts()}] [Integrated] Turn complete.`);
      if (this.currentInputTranscript) {
        this.config.onTranscriptionUpdate(this.currentInputTranscript.trim(), true);
        this.currentInputTranscript = '';
      }
      this.currentOutputTranscript = '';
    }

    // --- Interruption (user spoke while bot was mid-response) ---
    if (msg.serverContent?.interrupted) {
      console.log(`[${ts()}] [Integrated] Interrupted — cancelling pending audio.`);
      for (const src of this.activeSources) {
        try { src.stop(); } catch { /* already stopped */ }
      }
      this.activeSources.clear();
      this.nextStartTime = 0;
      this.speakingStarted = false;
      this.config.onBotFinishedSpeaking();
    }
  }

  // ---------------------------------------------------------------------------
  // Mic capture
  // ---------------------------------------------------------------------------

  private startMicStreaming(): void {
    if (!this.stream || !this.inputCtx) return;

    const source = this.inputCtx.createMediaStreamSource(this.stream);
    this.scriptProcessor = this.inputCtx.createScriptProcessor(4096, 1, 1);

    this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!this.session) return;
      const float32 = event.inputBuffer.getChannelData(0);
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        int16[i] = Math.max(-32768, Math.min(32767, float32[i] * 32768));
      }
      const pcmData = encode(new Uint8Array(int16.buffer));
      this.session.sendRealtimeInput({
        media: { data: pcmData, mimeType: 'audio/pcm;rate=16000' },
      });
    };

    // Silent gain node keeps the audio graph alive without mic playback.
    const silentGain = this.inputCtx.createGain();
    silentGain.gain.value = 0;
    source.connect(this.scriptProcessor);
    this.scriptProcessor.connect(silentGain);
    silentGain.connect(this.inputCtx.destination);

    console.log(`[${ts()}] [Integrated] Mic streaming started at ${this.inputCtx.sampleRate} Hz.`);
  }

  private stopMicStreaming(): void {
    if (this.scriptProcessor) {
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.inputCtx) {
      this.inputCtx.close();
      this.inputCtx = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private buildSystemInstruction(
    context: string,
    history: { speaker: string; text: string }[],
  ): string {
    const historyText = history.length > 0
      ? `\n\nConversation history so far (user = Eleanor, bot = you):\n${history.map(h => `${h.speaker}: ${h.text}`).join('\n')}`
      : '';
    return `${context}${historyText}`;
  }
}
