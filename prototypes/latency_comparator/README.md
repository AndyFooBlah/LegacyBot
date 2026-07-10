# Conversational AI Latency Comparator

This prototype is a web application designed to compare the real-world performance of two different architectures for building a conversational AI. It provides a hands-on way to measure and feel the difference in latency and response quality between an integrated, all-in-one service and a hybrid, multi-component service.

Tracked by GitHub Issue: [#67](https://github.com/AndyFooBlah/LegacyBot/issues/67)

## Architectures

The prototype allows you to switch between two distinct architectures:

1.  **Integrated (e.g., Gemini Live):** A single service that handles Speech-to-Text (STT), Large Language Model (LLM) processing, and Text-to-Speech (TTS) in one package. This architecture is simpler to implement but may have higher latency due to its "black box" nature.

2.  **Hybrid (e.g., Gradium + Gemini):** A combination of specialized, best-in-class services.
    *   **STT:** A dedicated real-time transcription service (e.g., Gradium).
    *   **LLM:** A powerful text-based language model (e.g., Gemini API).
    *   **TTS:** A dedicated real-time speech synthesis service (e.g., Gradium).
    This architecture is more complex to orchestrate but offers greater control and potentially lower latency.

## Key Performance Metrics

The application measures and displays two key metrics:

*   **Primary Latency (Bot Response):** The time from when the user stops speaking until the first audio chunk of the bot's response is played. This measures the perceived "thinking time."
*   **Secondary Latency (Transcription):** The time from when a speaker finishes talking until their speech is fully transcribed on the screen.

## Getting Started

### 1. Installation

Navigate to the prototype directory and install the dependencies:

```bash
cd legacybot/prototypes/latency_comparator
npm install
```

### 2. Environment Variables

Copy `.env.example` to `.env.local` and fill in your keys:

```bash
cp .env.example .env.local
```

| Variable | Where to get it | Required |
|----------|-----------------|----------|
| `VITE_GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/apikey) | Yes |
| `VITE_GRADIUM_API_KEY` | [Gradium dashboard](https://gradium.ai) | Yes |
| `VITE_GRADIUM_VOICE_ID` | `GET https://us.api.gradium.ai/api/voices` with your key | Recommended |

**Getting a Gradium voice ID:** Gradium TTS requires a specific voice ID from your account. Make a quick curl call once you have your API key:
```bash
curl -H "x-api-key: YOUR_KEY" https://us.api.gradium.ai/api/voices
```
Copy one of the returned IDs into `VITE_GRADIUM_VOICE_ID`. If the field is left blank the prototype will fall back to `"default"`, which may or may not be valid.

### 3. Running the Prototype

The prototype has a two-part startup: a **Node.js proxy** (forwards microphone audio to Gradium STT securely) and the **Vite frontend**. You need two terminals.

**Terminal 1 — Proxy server** (port 3001, relays to `wss://us.api.gradium.ai/api/speech/asr`):
```bash
npm run start-server
```
Expected output: `WebSocket proxy server started on port 3001`

**Terminal 2 — Frontend** (port 5173):
```bash
npm run dev
```
Open `http://localhost:5173` in your browser.

### 4. How to Test

1. Grant microphone permission when prompted.
2. Select **Hybrid (Gradium + Gemini)** from the architecture dropdown (Integrated is not yet implemented).
3. Click **Start Interview** — status changes to `listening`.
4. Speak as Dr. Eleanor Vance, then click the button again to stop.
5. Status will cycle through `thinking` → `speaking` → `listening`.
6. **Primary latency** (ms shown after each turn): time from stop-speaking to first audio byte.
7. **Secondary latency**: time from stop-speaking to final transcription appearing on screen.
8. Run multiple turns to collect a representative sample before drawing conclusions.

