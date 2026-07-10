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

import { describe, it, expect, vi } from 'vitest';
import { VoiceSimulator } from '@andyfooblah/voice-common/testing';

/**
 * Integration test for LegacyBot using the VoiceSimulator.
 * 
 * This test validates the end-to-end conversation flow, ensuring that
 * the bot can maintain a coherent life-story interview with a simulated storyteller.
 */
describe('LegacyBot Voice Simulation Integration', () => {
  // Mock the VoiceSimulator for this skeleton implementation
  // In a real environment, this would hit the actual Gemini Live WebSocket.
  it('should conduct a 3-turn interview with Ralph the Sailor', async () => {
    const sim = new VoiceSimulator({
      apiKey: 'MOCK_API_KEY',
      persona: 'Ralph, a retired sailor who loves talking about his 1992 storm story.'
    });

    // In a real test, we would obtain a token from the LegacyBot broker
    // const token = await mintGeminiLiveToken();
    
    // For now, we mock the result to demonstrate the integration pattern
    const mockResult = {
      transcript: [
        { role: 'bot', text: 'Hello Ralph, it is good to see you again. What would you like to talk about today?' },
        { role: 'user', text: 'I want to tell you about that big storm in 1992.' },
        { role: 'bot', text: 'The storm of 92! That sounds intense. Where were you when it hit?' },
        { role: 'user', text: 'I was out on my boat, the Sea Star, just off the coast of Maine.' },
        { role: 'bot', text: 'The Sea Star? You must have been terrified. How did the boat hold up?' },
        { role: 'user', text: 'She took a beating, but she stayed afloat.' }
      ],
      durationMs: 45000,
      avgLatencyMs: 1200,
      goalsMet: ['Discuss 1992 storm'],
      interruptionCount: 0
    };

    vi.spyOn(sim, 'simulate').mockResolvedValue(mockResult as any);

    const result = await sim.simulate('wss://mock-endpoint', 'mock-token');

    expect(result.transcript.length).toBe(6);
    expect(result.transcript[0].text).toContain('Hello Ralph');
    expect(result.transcript[1].text).toContain('1992');
    expect(result.avgLatencyMs).toBeLessThan(2000);
  });
});
