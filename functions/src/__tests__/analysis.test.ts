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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runGapAnalysis, saveGapAnalysis } from '../analysis';

// --- Mocks ---

const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function() {
    return {
      models: {
        generateContent: mockGenerateContent,
      },
    };
  }),
  ThinkingLevel: { HIGH: 'HIGH' }
}));

const mockGet = vi.fn();
const mockSet = vi.fn();
const mockDelete = vi.fn();
const mockUpdate = vi.fn();
const mockBatchCommit = vi.fn();

const mockBatch = {
  set: mockSet,
  delete: mockDelete,
  update: mockUpdate,
  commit: mockBatchCommit,
};

const mockFirestore = {
  collection: vi.fn().mockReturnThis(),
  doc: vi.fn().mockReturnThis(),
  get: mockGet,
  set: mockSet,
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  batch: vi.fn(() => mockBatch),
};

vi.mock('firebase-admin', () => ({
  firestore: Object.assign(() => mockFirestore, {
    Timestamp: {
      now: () => ({ toMillis: () => Date.now() }),
    },
  }),
}));

describe('analysis (gap analysis)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('runGapAnalysis', () => {
    it('runs analysis and returns parsed JSON from Gemini', async () => {
      // Mock Firestore data
      mockGet.mockResolvedValueOnce({ docs: [] }); // sessions
      mockGet.mockResolvedValueOnce({ docs: [] }); // events
      mockGet.mockResolvedValueOnce({ docs: [] }); // questions

      mockGenerateContent.mockResolvedValue({
        text: JSON.stringify({
          questions: [{ text: 'New Question', rationale: 'Gaps', priority: 'high' }],
          gaps: { timeline: ['1980s'], themes: ['Career'], implied: [] },
          narrativeSummary: 'I want to learn more about the 80s.'
        })
      });

      const result = await runGapAnalysis(
        'fam-1', 'dos-1', 'sess-1',
        { storytellerName: 'Ralph' },
        'test-key'
      );

      expect(result.questions[0].text).toBe('New Question');
      expect(result.narrativeSummary).toBe('I want to learn more about the 80s.');
      expect(mockGenerateContent).toHaveBeenCalled();
    });

    it('throws if Gemini returns invalid JSON', async () => {
      mockGet.mockResolvedValue({ docs: [] });
      mockGenerateContent.mockResolvedValue({ text: 'Not JSON' });

      await expect(runGapAnalysis(
        'fam-1', 'dos-1', 'sess-1',
        { storytellerName: 'Ralph' },
        'test-key'
      )).rejects.toThrow('Gap analysis returned no parseable JSON');
    });
  });

  describe('saveGapAnalysis', () => {
    it('saves metadata and syncs questions to Story Queue', async () => {
      const result: any = {
        questions: [{ text: 'Q1', rationale: 'R1', priority: 'high' }],
        gaps: { timeline: [], themes: [], implied: [] },
        narrativeSummary: 'Sum',
        sessionId: 'sess-1',
      };

      // Mock topSnap (current max order)
      mockGet.mockResolvedValueOnce({ empty: false, docs: [{ data: () => ({ order: 10 }) }] });
      // Mock prevSnap (stale gap questions)
      mockGet.mockResolvedValueOnce({ docs: [] });

      await saveGapAnalysis('fam-1', 'dos-1', result);

      expect(mockFirestore.batch).toHaveBeenCalled();
      expect(mockBatch.set).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ text: 'Q1', order: 11, source: 'gapAnalysis' })
      );
      expect(mockBatchCommit).toHaveBeenCalled();
    });
  });
});
