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

// --- Mock @google/genai ---
const mockUpload = vi.fn();
const mockGet = vi.fn();
const mockDelete = vi.fn();
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(function () {
    return {
      files: { upload: mockUpload, get: mockGet, delete: mockDelete },
      models: { generateContent: mockGenerateContent },
    };
  }),
  Type: {
    OBJECT: 'OBJECT',
    ARRAY: 'ARRAY',
    STRING: 'STRING',
    NUMBER: 'NUMBER',
  },
}));

import { buildRefineTranscriptHandler } from '../refineTranscript';

const fakeDownload = vi.fn(async () => ({
  buffer: Buffer.from('fake-audio'),
  mimeType: 'audio/webm',
}));

beforeEach(() => {
  vi.clearAllMocks();
  fakeDownload.mockResolvedValue({ buffer: Buffer.from('fake-audio'), mimeType: 'audio/webm' });
});

describe('buildRefineTranscriptHandler', () => {
  it('uploads audio, calls the model, and returns normalized utterances', async () => {
    mockUpload.mockResolvedValue({ name: 'files/abc', uri: 'gs://x/abc', state: 'ACTIVE' });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        utterances: [
          { speaker: 'model', start_time: 0, end_time: 3, text: 'Hi Andy.' },
          { speaker: 'user', start_time: 3.5, end_time: 8, text: 'I grew up on a farm.' },
        ],
      }),
    });

    const refine = buildRefineTranscriptHandler({ apiKey: 'k', downloadAudio: fakeDownload });
    const out = await refine('fam/dos/sess.webm');

    expect(fakeDownload).toHaveBeenCalledWith('fam/dos/sess.webm');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockGenerateContent).toHaveBeenCalledTimes(1);
    // fileData part references the uploaded uri
    const call = mockGenerateContent.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.8-flash');
    expect(call.contents[0].parts[0].fileData.fileUri).toBe('gs://x/abc');
    expect(call.config.responseMimeType).toBe('application/json');
    // returns normalized, sorted utterances
    expect(out).toEqual([
      { speaker: 'model', startTime: 0, endTime: 3, text: 'Hi Andy.' },
      { speaker: 'user', startTime: 3.5, endTime: 8, text: 'I grew up on a farm.' },
    ]);
    // uploaded file cleaned up
    expect(mockDelete).toHaveBeenCalledWith({ name: 'files/abc' });
  });

  it('polls until the uploaded file becomes ACTIVE', async () => {
    mockUpload.mockResolvedValue({ name: 'files/p', uri: 'u', state: 'PROCESSING' });
    mockGet
      .mockResolvedValueOnce({ name: 'files/p', uri: 'u', state: 'PROCESSING' })
      .mockResolvedValueOnce({ name: 'files/p', uri: 'u', state: 'ACTIVE' });
    mockGenerateContent.mockResolvedValue({ text: '{"utterances":[]}' });

    const refine = buildRefineTranscriptHandler({ apiKey: 'k', downloadAudio: fakeDownload });
    const out = await refine('p.webm');

    expect(mockGet).toHaveBeenCalledTimes(2);
    expect(out).toEqual([]);
  });

  it('throws (and still cleans up) when the file never becomes ACTIVE', async () => {
    mockUpload.mockResolvedValue({ name: 'files/f', uri: 'u', state: 'FAILED' });
    const refine = buildRefineTranscriptHandler({ apiKey: 'k', downloadAudio: fakeDownload });
    await expect(refine('f.webm')).rejects.toThrow(/not ACTIVE/);
    expect(mockGenerateContent).not.toHaveBeenCalled();
    expect(mockDelete).toHaveBeenCalledWith({ name: 'files/f' });
  });

  it('drops malformed utterance rows', async () => {
    mockUpload.mockResolvedValue({ name: 'files/a', uri: 'u', state: 'ACTIVE' });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify({
        utterances: [
          { speaker: 'user', start_time: 1, end_time: 2, text: 'keep me' },
          { speaker: 'alien', start_time: 3, end_time: 4, text: 'bad speaker' },
          { speaker: 'user', start_time: 'x', end_time: 6, text: 'bad time' },
          { speaker: 'model', start_time: 7, end_time: 8, text: '   ' },
        ],
      }),
    });
    const refine = buildRefineTranscriptHandler({ apiKey: 'k', downloadAudio: fakeDownload });
    const out = await refine('a.webm');
    expect(out).toEqual([{ speaker: 'user', startTime: 1, endTime: 2, text: 'keep me' }]);
  });
});
