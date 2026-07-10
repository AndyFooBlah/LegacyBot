# Project Plan: Conversational AI Latency Comparator

This document outlines the plan to develop a prototype application to compare the latency and subjective quality of two different conversational AI architectures.

### 1. Foundational Setup

*   **Directory Structure:** A new, self-contained sub-project will be created at `legacybot/prototypes/latency_comparator`.
*   **Project Initialization:** A new React + TypeScript project will be initialized within this directory using Vite, mirroring the stack of the main project.
*   **README:** A `README.md` file will be created inside the prototype's directory explaining its purpose, architecture, and instructions on how to install and run it.

### 2. Fictional Context Generation

To provide the LLM with rich, realistic context, three new files will be created:

*   **`src/context/backstory.ts`:** Will export a detailed backstory for a fictional subject, "Dr. Eleanor Vance," a retired astrophysicist.
*   **`src/context/conversation_history.ts`:** Will export a substantial, pre-filled conversation history of at least 50 turns.
*   **`src/context/interview_plan.ts`:** Will export the AI's objectives for the conversation.

### 3. Core Application and UI

The user interface will be built in React to provide the necessary controls and feedback.

*Note: A web-based UI has been chosen as it significantly simplifies development by leveraging the browser's native Web Audio APIs for real-time microphone input and audio playback.*

*   **Main Component (`App.tsx`):**
    *   **Architecture Selector:** Dropdown to switch between "Integrated: Gemini Live" and "Hybrid: Gradium + Gemini".
    *   **Configuration:** Section to specify models for STT, LLM, and TTS.
    *   **Controls:** "Start/Stop Interview" button.
    *   **Real-time Transcription:** A live, scrolling view of the conversation.
    *   **Latency Log:** A display that updates after each turn with the measured end-to-end latency in milliseconds.

### 4. Architecture Implementation

Two distinct, swappable services will be implemented.

*   **`IntegratedService.ts` (Gemini Live):**
    *   Manages the connection to the Gemini Live API.
    *   Streams user microphone audio to the service.
    *   Receives and processes transcription text and the bot's audio response.

*   **`HybridService.ts` (Gradium + Gemini):**
    *   Orchestrates three separate services.
    *   **STT (e.g., Gradium):** Streams microphone audio to a WebSocket endpoint.
    *   **LLM (Gemini API):** Sends transcripts and full context to the standard Gemini text API.
    *   **TTS (e.g., Gradium):** Streams the text response from the LLM to a TTS endpoint and plays the resulting audio.

### 5. Key Performance Metrics

A precise timing mechanism will be implemented to measure and log key performance indicators.

*   **Primary Metric: End-to-End Latency**
    *   This measures the perceived "thinking time" of the bot.
    *   **`T_START`**: Captured the moment the system detects the user has finished speaking.
    *   **`T_END`**: Captured the moment the very first audio packet from the bot's response is received.
    *   **Calculation**: `Primary Latency = T_END - T_START`.

*   **Secondary Metric: Transcription Latency**
    *   This measures how quickly speech is converted to text on the screen.
    *   **`T_SPEECH_END`**: Captured the moment a speaker (user or bot) finishes a phrase.
    *   **`T_TRANSCRIPT_READY`**: Captured the moment the final transcript for that phrase is received.
    *   **Calculation**: `Transcription Latency = T_TRANSCRIPT_READY - T_SPEECH_END`.

### 6. GitHub Integration

A GitHub issue will be created to track the development of this prototype, and all commits will be associated with it.
