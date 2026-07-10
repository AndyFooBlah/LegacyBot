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

// Need to load .env variables FIRST
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';

// HH:MM:SS.mmm timestamp prefix for all log lines.
const ts = () => new Date().toISOString().slice(11, 23);

const PORT = 3001;
const app = express();
app.use(express.json());

// Allow the Vite dev server (port 5173) to call the proxy.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', 'http://localhost:5173');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});

const server = http.createServer(app);

// ---------------------------------------------------------------------------
// WebSocket proxy — routes by path:
//   /asr  → wss://us.api.gradium.ai/api/speech/asr  (STT)
//   /tts  → wss://us.api.gradium.ai/api/speech/tts  (TTS)
// ---------------------------------------------------------------------------
const wss = new WebSocketServer({ server });

wss.on('connection', (clientWs, req) => {
  const gradiumApiKey = process.env.VITE_GRADIUM_API_KEY;
  if (!gradiumApiKey) {
    console.error(`[${ts()}] VITE_GRADIUM_API_KEY not found.`);
    clientWs.close(1011, 'Server configuration error: API key not found.');
    return;
  }

  const url = req.url ?? '/';
  if (url.startsWith('/tts')) {
    handleTtsConnection(clientWs, gradiumApiKey);
  } else {
    handleSttConnection(clientWs, gradiumApiKey);
  }
});

// ---------------------------------------------------------------------------
// STT proxy  (browser → ws://localhost:3001/asr → wss://us.api.gradium.ai/api/speech/asr)
// ---------------------------------------------------------------------------
function handleSttConnection(clientWs: WebSocket, gradiumApiKey: string) {
  console.log(`[${ts()}] [STT] Client connected`);

  const gradiumUrl = 'wss://us.api.gradium.ai/api/speech/asr';
  const headers = { 'x-api-key': gradiumApiKey };

  // Messages that arrive before Gradium's WebSocket opens are queued here.
  const pendingMessages: string[] = [];

  console.log(`[${ts()}] [STT] Connecting to ${gradiumUrl}`);
  const gradiumWs = new WebSocket(gradiumUrl, { headers });

  gradiumWs.on('open', () => {
    console.log(`[${ts()}] [STT] Connected to Gradium. Flushing ${pendingMessages.length} queued message(s).`);
    for (const msg of pendingMessages) gradiumWs.send(msg);
    pendingMessages.length = 0;
  });

  gradiumWs.on('message', (message) => {
    const str = message.toString();
    try {
      const parsed = JSON.parse(str);
      if (parsed.type !== 'step') {
        console.log(`[${ts()}] [STT] Gradium → client: ${str.substring(0, 200)}${str.length > 200 ? '…' : ''}`);
      }
    } catch {
      console.log(`[${ts()}] [STT] Gradium → client (non-JSON): ${str.substring(0, 200)}`);
    }
    clientWs.send(str);
  });

  gradiumWs.on('close', (code, reason) => {
    console.log(`[${ts()}] [STT] Gradium closed: ${code} ${reason.toString()}`);
    clientWs.close(code, 'Upstream connection closed');
  });

  gradiumWs.on('error', (error) => {
    console.error(`[${ts()}] [STT] Gradium error:`, error);
    clientWs.close(1011, 'Proxy connection error.');
  });

  clientWs.on('message', (message) => {
    const messageStr = message.toString();
    const action = gradiumWs.readyState === WebSocket.OPEN ? 'Sending' : 'Queuing';
    try {
      const parsed = JSON.parse(messageStr);
      if (parsed.type === 'setup') {
        console.log(`[${ts()}] [STT] ${action} SETUP:`, JSON.stringify(parsed));
      } else if (parsed.type === 'audio') {
        // Too frequent to log.
      } else if (parsed.type === 'end_of_stream') {
        console.log(`[${ts()}] [STT] ${action} END_OF_STREAM`);
      } else {
        console.log(`[${ts()}] [STT] ${action}:`, messageStr.substring(0, 200));
      }
    } catch {
      console.log(`[${ts()}] [STT] ${action} non-JSON:`, messageStr.substring(0, 200));
    }

    if (gradiumWs.readyState === WebSocket.OPEN) {
      gradiumWs.send(messageStr);
    } else {
      pendingMessages.push(messageStr);
    }
  });

  clientWs.on('close', (code, reason) => {
    console.log(`[${ts()}] [STT] Client closed: ${code} ${reason.toString()}`);
    if (gradiumWs.readyState === WebSocket.OPEN || gradiumWs.readyState === WebSocket.CONNECTING) {
      gradiumWs.close();
    }
  });
}

// ---------------------------------------------------------------------------
// TTS proxy  (browser → ws://localhost:3001/tts → wss://us.api.gradium.ai/api/speech/tts)
// Gradium TTS sends binary audio frames back; we forward them as binary.
// ---------------------------------------------------------------------------
function handleTtsConnection(clientWs: WebSocket, gradiumApiKey: string) {
  console.log(`[${ts()}] [TTS] Client connected`);

  const gradiumUrl = 'wss://us.api.gradium.ai/api/speech/tts';
  const headers = { 'x-api-key': gradiumApiKey };

  const pendingMessages: (string | Buffer)[] = [];

  console.log(`[${ts()}] [TTS] Connecting to ${gradiumUrl}`);
  const gradiumWs = new WebSocket(gradiumUrl, { headers });

  gradiumWs.on('open', () => {
    console.log(`[${ts()}] [TTS] Connected to Gradium. Flushing ${pendingMessages.length} queued message(s).`);
    for (const msg of pendingMessages) gradiumWs.send(msg);
    pendingMessages.length = 0;
  });

  let audioChunkCount = 0;
  gradiumWs.on('message', (data, isBinary) => {
    if (isBinary) {
      audioChunkCount++;
      console.log(`[${ts()}] [TTS] Binary audio frame #${audioChunkCount}: ${(data as Buffer).length} bytes → forwarding`);
      clientWs.send(data, { binary: true }, (err) => {
        if (err) console.error(`[${ts()}] [TTS] Error forwarding binary to client:`, err);
      });
    } else {
      const str = data.toString();
      let msgType = 'unknown';
      try { msgType = JSON.parse(str).type; } catch { /* ignore */ }
      if (msgType === 'audio') {
        audioChunkCount++;
        console.log(`[${ts()}] [TTS] JSON audio chunk #${audioChunkCount} → forwarding (${str.length} chars)`);
      } else {
        console.log(`[${ts()}] [TTS] Gradium → client [${msgType}]: ${str.substring(0, 200)}`);
      }
      clientWs.send(str, (err) => {
        if (err) console.error(`[${ts()}] [TTS] Error forwarding [${msgType}] to client:`, err);
      });
    }
  });

  gradiumWs.on('close', (code, reason) => {
    console.log(`[${ts()}] [TTS] Gradium closed: ${code} ${reason.toString()}`);
    clientWs.close(code, 'Upstream connection closed');
  });

  gradiumWs.on('error', (error) => {
    console.error(`[${ts()}] [TTS] Gradium error:`, error);
    clientWs.close(1011, 'Proxy connection error.');
  });

  clientWs.on('message', (message) => {
    const messageStr = message.toString();
    const action = gradiumWs.readyState === WebSocket.OPEN ? 'Sending' : 'Queuing';
    console.log(`[${ts()}] [TTS] ${action} to Gradium:`, messageStr.substring(0, 200));

    if (gradiumWs.readyState === WebSocket.OPEN) {
      gradiumWs.send(messageStr);
    } else {
      pendingMessages.push(messageStr);
    }
  });

  clientWs.on('close', (code, reason) => {
    console.log(`[${ts()}] [TTS] Client closed: ${code} ${reason.toString()}`);
    if (gradiumWs.readyState === WebSocket.OPEN || gradiumWs.readyState === WebSocket.CONNECTING) {
      gradiumWs.close();
    }
  });
}

server.listen(PORT, () => {
  console.log(`[${ts()}] Proxy server started on port ${PORT} (STT: /asr, TTS: /tts)`);
});
