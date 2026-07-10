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

import { GoogleGenerativeAI } from "@google/generative-ai";
import { convertFloat32ToInt16, Resampler, arrayBufferToBase64 } from "../utils/audioUtils";

export interface StepTimings {
  /** ms from VAD trigger to last STT segment (negative = streaming was ahead) */
  sttMs: number;
  /** ms for the LLM call */
  llmMs: number;
  /** ms for the TTS call */
  ttsMs: number;
  /** ms from VAD trigger to audio ready to play */
  totalMs: number;
}

interface HybridServiceConfig {
  onTranscriptionUpdate: (text: string, isFinal: boolean) => void;
  onBotStartedSpeaking: () => void;
  onBotThinking: () => void;
  onBotFinishedSpeaking: () => void;
  onStepTimings: (timings: StepTimings) => void;
}

const TARGET_SAMPLE_RATE = 24000; // Gradium STT requires 24 kHz PCM
const AUDIO_BUFFER_SIZE = 4096;

// VAD auto-stop: how many consecutive Gradium step frames must have
// inactivity_prob >= threshold before we treat the utterance as complete.
// Each frame is ~80ms, so 5 frames ≈ 400ms of sustained silence.
const VAD_SILENCE_THRESHOLD = 0.5;
const VAD_SILENCE_FRAMES_REQUIRED = 5;

// HH:MM:SS.mmm timestamp for console logs.
const ts = () => new Date().toISOString().slice(11, 23);

export class HybridService {
  private config: HybridServiceConfig;
  private tokenProvider: () => Promise<string>;
  private genAI: GoogleGenerativeAI | null = null;

  private sttSocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private audioProcessor: ScriptProcessorNode | null = null;

  private finalTranscript = '';
  private lastTextSegmentTime = 0;
  private t_stop = 0;
  private t_llmStart = 0;
  private t_llmEnd = 0;
  private t_ttsStart = 0;
  private t_ttsEnd = 0;

  // VAD auto-stop state
  private silenceFrameCount = 0;
  private autoStopTriggered = false;
  private storedContext = '';
  private storedHistory: { speaker: string; text: string }[] = [];

  constructor(config: HybridServiceConfig, tokenProvider: () => Promise<string>) {
    this.config = config;
    this.tokenProvider = tokenProvider;
    console.log(`[${ts()}] [Hybrid] Service initialized.`);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  public async start(context: string, history: { speaker: string; text: string }[]): Promise<void> {
    const apiKey = await this.tokenProvider();
    if (!apiKey) throw new Error("Gemini API key is required.");
    this.genAI = new GoogleGenerativeAI(apiKey);
    
    this.finalTranscript = '';
    this.lastTextSegmentTime = 0;
    this.silenceFrameCount = 0;
    this.autoStopTriggered = false;
    this.storedContext = context;
    this.storedHistory = history;

    await this.connectToStt();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.processAudio();
    console.log(`[${ts()}] [Hybrid] Listening — VAD will auto-stop at ${VAD_SILENCE_FRAMES_REQUIRED} frames >= ${VAD_SILENCE_THRESHOLD}.`);
  }

  public async stop(context: string, history: { speaker: string; text: string }[]): Promise<void> {
    // Guard against double-invocation (VAD auto-stop + manual click).
    if (this.autoStopTriggered) return;
    this.autoStopTriggered = true;
    await this._doStop(context, history);
  }

  public disconnect(): void {
    this.stopAudioCapture();
    if (this.sttSocket) {
      this.sttSocket.close();
      this.sttSocket = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Internal stop logic (shared by manual and VAD-triggered paths)
  // ---------------------------------------------------------------------------

  private async _doStop(context: string, history: { speaker: string; text: string }[]): Promise<void> {
    this.t_stop = performance.now();
    console.log(`[${ts()}] [VAD] End of speech detected — using transcript accumulated so far.`);

    // Immediately signal the UI that the user is done speaking.
    this.config.onBotThinking();

    // Stop capturing and sending audio to Gradium.
    this.stopAudioCapture();

    // Close the STT socket. No end_of_stream needed — STT is real-time
    // streaming so all segments for the speech we heard have already arrived.
    if (this.sttSocket) {
      this.sttSocket.close();
      this.sttSocket = null;
    }

    // Use whatever transcript has accumulated — no flush wait required.
    const transcriptToProcess = this.finalTranscript.trim();
    if (transcriptToProcess) {
      console.log(`[${ts()}] [VAD] Transcript: "${transcriptToProcess}"`);
      this.config.onTranscriptionUpdate(transcriptToProcess, true);
      await this.processFinalTranscript(transcriptToProcess, context, history);
    } else {
      console.warn(`[${ts()}] [Hybrid] No transcript captured — nothing to process.`);
      this.config.onBotFinishedSpeaking();
    }
  }

  // ---------------------------------------------------------------------------
  // STT
  // ---------------------------------------------------------------------------

  private connectToStt(): Promise<void> {
    // Connects to the local Node.js proxy (server.ts on port 3001).
    // The proxy holds the Gradium API key and relays to wss://us.api.gradium.ai/api/speech/asr.
    this.sttSocket = new WebSocket('ws://localhost:3001');

    return new Promise<void>((resolve, reject) => {
      this.sttSocket!.onopen = () => {
        console.log(`[${ts()}] [STT] Connected to proxy. Sending setup…`);
        this.sttSocket!.send(JSON.stringify({
          type: "setup",
          model_name: "default",
          input_format: "pcm",
        }));
        resolve();
      };

      this.sttSocket!.onmessage = (event) => {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(event.data as string);
        } catch {
          console.warn(`[${ts()}] [STT] Non-JSON message:`, event.data);
          return;
        }

        if (data.type === 'text') {
          this.finalTranscript += (data.text as string) + ' ';
          this.lastTextSegmentTime = performance.now();
          console.log(`[${ts()}] [STT] Segment: "${data.text}"`);
          this.config.onTranscriptionUpdate(this.finalTranscript.trim(), false);
        } else if (data.type === 'end_text') {
          console.log(`[${ts()}] [STT] end_text at ${(data.stop_s as number).toFixed(2)}s`);
        } else if (data.type === 'end_of_stream') {
          console.log(`[${ts()}] [STT] Gradium acknowledged end_of_stream.`);
        } else if (data.type === 'ready') {
          console.log(`[${ts()}] [STT] Gradium ready:`, data);
        } else if (data.type === 'step') {
          this.handleVadStep(data);
        } else if (data.type === 'error') {
          console.error(`[${ts()}] [STT] Gradium error:`, data.message);
        } else {
          console.log(`[${ts()}] [STT] Unhandled message type: ${data.type}`);
        }
      };

      this.sttSocket!.onclose = (event) => {
        console.log(`[${ts()}] [STT] Socket closed. ${event.code} ${event.reason || ''}`);
      };

      this.sttSocket!.onerror = (error) => {
        console.error(`[${ts()}] [STT] Socket error:`, error);
        reject(new Error("STT WebSocket error — is the proxy server running? (npm run start-server)"));
      };
    });
  }

  // ---------------------------------------------------------------------------
  // VAD auto-stop
  // ---------------------------------------------------------------------------

  private handleVadStep(data: Record<string, unknown>): void {
    if (this.autoStopTriggered) return;

    const vad = data.vad as Array<{ inactivity_prob?: number }> | undefined;
    const inactivityProb = vad?.[2]?.inactivity_prob ?? 0;

    if (inactivityProb >= VAD_SILENCE_THRESHOLD) {
      this.silenceFrameCount++;
      if (this.silenceFrameCount >= VAD_SILENCE_FRAMES_REQUIRED) {
        this.autoStopTriggered = true;
        console.log(
          `[${ts()}] [VAD] Silence threshold reached ` +
          `(${VAD_SILENCE_FRAMES_REQUIRED} consecutive frames >= ${VAD_SILENCE_THRESHOLD}, ` +
          `last inactivity_prob: ${inactivityProb.toFixed(3)}) — auto-stopping.`
        );
        // Fire and forget — this is in a WebSocket message handler.
        this._doStop(this.storedContext, this.storedHistory);
      }
    } else {
      this.silenceFrameCount = 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Audio capture
  // ---------------------------------------------------------------------------

  private processAudio(): void {
    if (!this.stream) return;

    this.audioContext = new window.AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.audioProcessor = this.audioContext.createScriptProcessor(AUDIO_BUFFER_SIZE, 1, 1);

    // ScriptProcessorNode must be connected to the destination graph to fire
    // onaudioprocess, but we don't want to hear the microphone — use a silent
    // gain node to keep the graph alive without playing audio back.
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;

    const resampler = new Resampler(this.audioContext.sampleRate, TARGET_SAMPLE_RATE);

    this.audioProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      const inputData = event.inputBuffer.getChannelData(0);
      const resampledData = resampler.resample(inputData);
      const pcmData = convertFloat32ToInt16(resampledData);

      if (this.sttSocket?.readyState === WebSocket.OPEN) {
        const base64Audio = arrayBufferToBase64(pcmData);
        this.sttSocket.send(JSON.stringify({ type: "audio", audio: base64Audio }));
      }
    };

    source.connect(this.audioProcessor);
    this.audioProcessor.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
  }

  private stopAudioCapture(): void {
    if (this.audioProcessor) {
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
  }

  // ---------------------------------------------------------------------------
  // LLM + TTS
  // ---------------------------------------------------------------------------

  private async processFinalTranscript(
    transcript: string,
    context: string,
    history: { speaker: string; text: string }[],
  ): Promise<void> {
    const botText = await this.callLlm(transcript, context, history);
    if (botText) {
      await this.callTts(botText);
    } else {
      this.config.onBotFinishedSpeaking();
    }
  }

  private async callLlm(
    transcript: string,
    context: string,
    history: { speaker: string; text: string }[],
  ): Promise<string | null> {
    if (!this.genAI) throw new Error("GoogleGenerativeAI not initialized");
    const model = this.genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `
${context}

Here is the conversation history so far (user = Eleanor, bot = you):
${history.map(h => `${h.speaker}: ${h.text}`).join('\n')}
user: ${transcript}
bot:`;

    try {
      this.t_llmStart = performance.now();
      console.log(`[${ts()}] [LLM] Calling Gemini 2.5 Flash…`);
      const result = await model.generateContent(prompt);
      this.t_llmEnd = performance.now();
      const text = result.response.text();
      console.log(`[${ts()}] [LLM] Response received (${(this.t_llmEnd - this.t_llmStart).toFixed(0)}ms): ${text.slice(0, 80)}${text.length > 80 ? '…' : ''}`);
      return text;
    } catch (error) {
      console.error(`[${ts()}] [LLM] Error:`, error);
      return "I'm sorry, I encountered an error while thinking.";
    }
  }

  private callTts(text: string): Promise<void> {
    const voiceId = import.meta.env.VITE_GRADIUM_VOICE_ID ?? "default";

    this.t_ttsStart = performance.now();
    console.log(`[${ts()}] [TTS] Connecting — voice_id="${voiceId}", ${text.length} chars…`);

    return new Promise<void>((resolve) => {
      const ws = new WebSocket('ws://localhost:3001/tts');
      ws.binaryType = 'arraybuffer';

      // WAV header parsed from the first chunk.
      let wavParams: { sampleRate: number; channels: number; bitsPerSample: number; dataOffset: number } | null = null;
      let audioCtx: AudioContext | null = null;
      let nextStartTime = 0;
      let chunkCount = 0;
      let speakingStarted = false;
      let lastSourceNode: AudioBufferSourceNode | null = null;
      let allChunksScheduled = false;

      const onPlaybackComplete = () => {
        console.log(`[${ts()}] [TTS] Playback complete.`);
        audioCtx?.close();
        this.config.onBotFinishedSpeaking();
        resolve();
      };

      // Decode raw 16-bit PCM bytes into an AudioBuffer and schedule it.
      const scheduleRawPcm = (pcmData: ArrayBuffer) => {
        if (!audioCtx || !wavParams || pcmData.byteLength === 0) return;
        const { sampleRate, channels, bitsPerSample } = wavParams;
        const bytesPerSample = bitsPerSample / 8;
        const numSamples = Math.floor(pcmData.byteLength / (bytesPerSample * channels));
        if (numSamples === 0) return;

        const audioBuffer = audioCtx.createBuffer(channels, numSamples, sampleRate);
        const int16 = new Int16Array(pcmData);
        for (let ch = 0; ch < channels; ch++) {
          const out = audioBuffer.getChannelData(ch);
          for (let i = 0; i < numSamples; i++) {
            out[i] = int16[i * channels + ch] / 32768.0;
          }
        }

        const source = audioCtx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(audioCtx.destination);

        // Schedule flush against a small initial buffer so chunks play gaplessly.
        const startAt = Math.max(nextStartTime, audioCtx.currentTime + 0.05);
        source.start(startAt);
        nextStartTime = startAt + audioBuffer.duration;
        lastSourceNode = source;

        if (!speakingStarted) {
          speakingStarted = true;
          this.t_ttsEnd = performance.now();
          const sttMs = this.lastTextSegmentTime - this.t_stop;
          const llmMs = this.t_llmEnd - this.t_llmStart;
          const ttsMs = this.t_ttsEnd - this.t_ttsStart;
          const totalMs = this.t_ttsEnd - this.t_stop;
          console.log(
            `[${ts()}] [TTS] First audio chunk playing (${ttsMs.toFixed(0)}ms TTS). ` +
            `Total stop→audio: ${totalMs.toFixed(0)}ms ` +
            `[STT lag: ${sttMs >= 0 ? '+' : ''}${sttMs.toFixed(0)}ms | LLM: ${llmMs.toFixed(0)}ms | TTS: ${ttsMs.toFixed(0)}ms]`
          );
          this.config.onStepTimings({ sttMs, llmMs, ttsMs, totalMs });
          this.config.onBotStartedSpeaking();
        }

        // Resolve when the LAST scheduled chunk finishes playing.
        source.onended = () => {
          if (allChunksScheduled && source === lastSourceNode) {
            onPlaybackComplete();
          }
        };
      };

      ws.onopen = () => {
        console.log(`[${ts()}] [TTS] Connected. Sending setup…`);
        ws.send(JSON.stringify({ type: 'setup', voice_id: voiceId, output_format: 'wav' }));
      };

      ws.onmessage = (event) => {
        // Normalise to an ArrayBuffer regardless of binary vs JSON-base64 delivery.
        let rawData: ArrayBuffer | null = null;

        if (event.data instanceof ArrayBuffer) {
          rawData = event.data;
        } else {
          let data: Record<string, unknown>;
          try { data = JSON.parse(event.data as string); } catch { return; }

          if (data.type === 'ready') {
            console.log(`[${ts()}] [TTS] Gradium ready. Sending text…`);
            ws.send(JSON.stringify({ type: 'text', text }));
            return;
          } else if (data.type === 'audio') {
            const b64 = data.audio as string;
            const binary = atob(b64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            rawData = bytes.buffer;
          } else if (data.type === 'end_of_stream') {
            console.log(`[${ts()}] [TTS] end_of_stream — closing.`);
            ws.close();
            return;
          } else if (data.type === 'error') {
            console.error(`[${ts()}] [TTS] Gradium error:`, data);
            return;
          } else {
            console.log(`[${ts()}] [TTS] Message [${data.type}]:`, data);
            return;
          }
        }

        if (!rawData || rawData.byteLength === 0) return;
        chunkCount++;

        if (!wavParams) {
          // First audio chunk: parse the RIFF/WAV header to get stream params.
          const view = new DataView(rawData);
          const isRiff = rawData.byteLength >= 4 &&
            view.getUint8(0) === 0x52 && view.getUint8(1) === 0x49 &&
            view.getUint8(2) === 0x46 && view.getUint8(3) === 0x46;

          if (isRiff) {
            const channels = view.getUint16(22, true);
            const sampleRate = view.getUint32(24, true);
            const bitsPerSample = view.getUint16(34, true);
            // Walk sub-chunks to find 'data' start offset.
            let offset = 12;
            while (offset + 8 <= rawData.byteLength) {
              const id = String.fromCharCode(
                view.getUint8(offset), view.getUint8(offset + 1),
                view.getUint8(offset + 2), view.getUint8(offset + 3),
              );
              if (id === 'data') { offset += 8; break; }
              offset += 8 + view.getUint32(offset + 4, true);
            }
            wavParams = { sampleRate, channels, bitsPerSample, dataOffset: offset };
            audioCtx = new AudioContext({ sampleRate });
            nextStartTime = audioCtx.currentTime + 0.1;
            console.log(`[${ts()}] [TTS] WAV header: ${sampleRate}Hz ${channels}ch ${bitsPerSample}bit, PCM data@${offset}. Bytes in this chunk: ${rawData.byteLength - offset}`);
            // Play any PCM bytes packed after the header in chunk #1.
            if (rawData.byteLength > offset) {
              scheduleRawPcm(rawData.slice(offset));
            }
          } else {
            console.warn(`[${ts()}] [TTS] First chunk not RIFF — assuming raw 48kHz 16-bit mono PCM`);
            wavParams = { sampleRate: 48000, channels: 1, bitsPerSample: 16, dataOffset: 0 };
            audioCtx = new AudioContext({ sampleRate: 48000 });
            nextStartTime = audioCtx.currentTime + 0.1;
            scheduleRawPcm(rawData);
          }
        } else {
          // Subsequent chunks are raw PCM.
          console.log(`[${ts()}] [TTS] Chunk #${chunkCount}: ${rawData.byteLength} bytes → scheduling`);
          scheduleRawPcm(rawData);
        }
      };

      ws.onclose = () => {
        allChunksScheduled = true;
        console.log(`[${ts()}] [TTS] WS closed. ${chunkCount} chunk(s) received.`);
        if (chunkCount === 0 || !speakingStarted) {
          console.error(`[${ts()}] [TTS] No audio received.`);
          this.config.onBotFinishedSpeaking();
          resolve();
        }
        // Otherwise onPlaybackComplete fires from lastSourceNode.onended.
      };

      ws.onerror = (error) => {
        console.error(`[${ts()}] [TTS] WebSocket error:`, error);
        this.config.onBotFinishedSpeaking();
        resolve();
      };
    });
  }
}
