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
 * Tests for the storage service (Firestore + GCS operations).
 * Now uses familyId instead of uid for family-based paths.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mockFirestore, mockStorage } from '../../__mocks__/firebase';
import {
  createSession,
  finalizeSession,
  archiveAudioToGCS,
  syncTranscriptToFirestore,
  updateQuestionStateInFirestore,
  saveFamilyEvents,
  saveMessageEdit,
  saveMiscFact,
  getMiscFacts,
} from '../../services/storage';

beforeEach(() => {
  Object.values(mockFirestore).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
  });
  Object.values(mockStorage).forEach((fn) => {
    if (typeof fn === 'function' && 'mockClear' in fn) fn.mockClear();
  });
});

describe('createSession', () => {
  it('creates a session document and returns the ID', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'session-123' });

    const id = await createSession('family-1', 'dossier-1', 'storyteller-uid');

    expect(id).toBe('session-123');
    expect(mockFirestore.addDoc).toHaveBeenCalledTimes(1);
  });

  it('creates the session with status=active, storytellerUid, and no endTime', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'session-123' });

    await createSession('family-1', 'dossier-1', 'storyteller-uid');

    const sessionData = mockFirestore.addDoc.mock.calls[0][1];
    expect(sessionData.status).toBe('active');
    expect(sessionData.endTime).toBeNull();
    expect(sessionData.audioUrl).toBe('');
    expect(sessionData.durationSeconds).toBe(0);
    expect(sessionData.storytellerUid).toBe('storyteller-uid');
  });

  it('sets a startTime timestamp', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'session-123' });

    await createSession('family-1', 'dossier-1', 'storyteller-uid');

    const sessionData = mockFirestore.addDoc.mock.calls[0][1];
    expect(sessionData.startTime).toBeDefined();
  });
});

describe('finalizeSession', () => {
  it('updates the session with completed status', async () => {
    await finalizeSession('family-1', 'dossier-1', 'session-1', 'completed', 3600);

    expect(mockFirestore.updateDoc).toHaveBeenCalledTimes(1);
    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.status).toBe('completed');
    expect(updateData.durationSeconds).toBe(3600);
    expect(updateData.endTime).toBeDefined();
  });

  it('updates the session with interrupted status', async () => {
    await finalizeSession('family-1', 'dossier-1', 'session-1', 'interrupted', 120);

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.status).toBe('interrupted');
  });

  it('includes audioUrl when provided', async () => {
    await finalizeSession('family-1', 'dossier-1', 'session-1', 'completed', 3600, 'https://audio.url');

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.audioUrl).toBe('https://audio.url');
  });

  it('omits audioUrl when not provided', async () => {
    await finalizeSession('family-1', 'dossier-1', 'session-1', 'completed', 3600);

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData).not.toHaveProperty('audioUrl');
  });
});

describe('archiveAudioToGCS', () => {
  it('uploads a blob and returns the download URL', async () => {
    mockStorage.getDownloadURL.mockResolvedValueOnce('https://storage.example.com/audio.webm');
    const blob = new Blob(['audio-data'], { type: 'audio/webm' });

    const url = await archiveAudioToGCS(blob, 'family-1', 'dossier-1', 'session-1');

    expect(url).toBe('https://storage.example.com/audio.webm');
    expect(mockStorage.uploadBytes).toHaveBeenCalledTimes(1);
  });

  it('uses the correct GCS path convention: {familyId}/{dossierId}/{sessionId}.webm', async () => {
    const blob = new Blob(['audio-data']);

    await archiveAudioToGCS(blob, 'family-1', 'dossier-1', 'session-1');

    expect(mockStorage.ref).toHaveBeenCalledWith(
      expect.anything(),
      'family-1/dossier-1/session-1.webm',
    );
  });

  it('sets the correct content type on upload', async () => {
    const blob = new Blob(['audio-data']);

    await archiveAudioToGCS(blob, 'family-1', 'dossier-1', 'session-1');

    const uploadOptions = mockStorage.uploadBytes.mock.calls[0][2];
    expect(uploadOptions.contentType).toBe('audio/webm;codecs=opus');
  });
});

describe('syncTranscriptToFirestore', () => {
  it('writes transcript entries to the correct path', async () => {
    const entries = [
      { role: 'bot' as const, text: 'Hello!', timestamp: mockFirestore.Timestamp.now() },
      { role: 'user' as const, text: 'Hi there.', timestamp: mockFirestore.Timestamp.now() },
    ] as any;

    await syncTranscriptToFirestore('family-1', 'dossier-1', 'session-1', entries);

    expect(mockFirestore.setDoc).toHaveBeenCalledTimes(1);
    const writtenData = mockFirestore.setDoc.mock.calls[0][1];
    expect(writtenData.entries).toHaveLength(2);
    expect(writtenData.entries[0].role).toBe('bot');
    expect(writtenData.entries[1].role).toBe('user');
  });

  it('overwrites previous entries (merge: false)', async () => {
    const entries = [{ role: 'bot' as const, text: 'Hello!', timestamp: mockFirestore.Timestamp.now() }] as any;

    await syncTranscriptToFirestore('family-1', 'dossier-1', 'session-1', entries);

    const mergeOption = mockFirestore.setDoc.mock.calls[0][2];
    expect(mergeOption).toEqual({ merge: false });
  });
});

describe('updateQuestionStateInFirestore', () => {
  it('upserts the question document with status and findings', async () => {
    await updateQuestionStateInFirestore('family-1', 'dossier-1', 'q1', 'InProgress', 'User mentioned a farm.');

    expect(mockFirestore.setDoc).toHaveBeenCalledTimes(1);
    const updateData = mockFirestore.setDoc.mock.calls[0][1];
    expect(updateData.status).toBe('InProgress');
    expect(updateData.findings).toBe('User mentioned a farm.');
    expect(updateData.updatedAt).toBeDefined();
    expect(mockFirestore.setDoc.mock.calls[0][2]).toEqual({ merge: true });
  });
});

describe('saveFamilyEvents', () => {
  const baseEvent = {
    familyId: 'family-1',
    title: 'Marriage of Ralph and Margaret',
    date: 'June 15, 1952',
    description: 'They married in a small ceremony in Ohio.',
    storytellerUids: ['storyteller-uid'] as string[],
    sessionIds: ['session-1'] as string[],
    createdBy: 'storyteller-uid',
  };

  it('calls addDoc once per event', async () => {
    await saveFamilyEvents('family-1', [baseEvent]);

    expect(mockFirestore.addDoc).toHaveBeenCalledTimes(1);
  });

  it('calls addDoc for each event in the array', async () => {
    const events = [baseEvent, { ...baseEvent, title: 'Birth of Margaret' }];

    await saveFamilyEvents('family-1', events);

    expect(mockFirestore.addDoc).toHaveBeenCalledTimes(2);
  });

  it('saves event data with createdAt and updatedAt timestamps', async () => {
    await saveFamilyEvents('family-1', [baseEvent]);

    const data = mockFirestore.addDoc.mock.calls[0][1];
    expect(data.title).toBe('Marriage of Ralph and Margaret');
    expect(data.description).toBe('They married in a small ceremony in Ohio.');
    expect(data.storytellerUids).toEqual(['storyteller-uid']);
    expect(data.sessionIds).toEqual(['session-1']);
    expect(data.createdAt).toBeDefined();
    expect(data.updatedAt).toBeDefined();
  });

  it('writes to the family-level events collection path', async () => {
    await saveFamilyEvents('family-1', [baseEvent]);

    // collection() is called with db, 'families', familyId, 'events'
    expect(mockFirestore.collection).toHaveBeenCalledWith(
      expect.anything(),
      'families',
      'family-1',
      'events',
    );
  });

  it('does nothing when given an empty array', async () => {
    await saveFamilyEvents('family-1', []);

    expect(mockFirestore.addDoc).not.toHaveBeenCalled();
  });
});

describe('saveMessageEdit', () => {
  const baseEntry = {
    role: 'user' as const,
    text: 'Original transcription',
    timestamp: mockFirestore.Timestamp.now(),
    messageIndex: 1,
  };

  it('updates the entry text in editedEntries', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ entries: [baseEntry] }),
    });

    await saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'Corrected text', 'user-uid', 'Alice');

    expect(mockFirestore.updateDoc).toHaveBeenCalledTimes(1);
    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.editedEntries[0].text).toBe('Corrected text');
  });

  it('sets originalText to the pre-edit text on first edit', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ entries: [baseEntry] }),
    });

    await saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'Corrected text', 'user-uid', 'Alice');

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.editedEntries[0].originalText).toBe('Original transcription');
  });

  it('does not overwrite originalText on subsequent edits', async () => {
    const alreadyEditedEntry = {
      ...baseEntry,
      text: 'First edit',
      originalText: 'Original transcription',
      editHistory: [{ text: 'First edit', editedBy: 'user-uid', editedByName: 'Alice', editedAt: mockFirestore.Timestamp.now() }],
    };
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ editedEntries: [alreadyEditedEntry] }),
    });

    await saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'Second edit', 'user-uid', 'Alice');

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.editedEntries[0].originalText).toBe('Original transcription');
    expect(updateData.editedEntries[0].editHistory).toHaveLength(2);
  });

  it('appends a history entry with editor metadata', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ entries: [baseEntry] }),
    });

    await saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'Corrected text', 'user-uid', 'Alice');

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    const historyItem = updateData.editedEntries[0].editHistory[0];
    expect(historyItem.text).toBe('Corrected text');
    expect(historyItem.editedBy).toBe('user-uid');
    expect(historyItem.editedByName).toBe('Alice');
    expect(historyItem.editedAt).toBeDefined();
  });

  it('uses editedEntries as base when they already exist', async () => {
    const editedEntry = { ...baseEntry, text: 'Previous edit', originalText: 'Original transcription' };
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ entries: [baseEntry], editedEntries: [editedEntry] }),
    });

    await saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'New edit', 'user-uid', 'Alice');

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.editedEntries[0].originalText).toBe('Original transcription');
  });

  it('only modifies the targeted message index, leaving others unchanged', async () => {
    const entries = [
      { role: 'bot' as const, text: 'Bot message', timestamp: mockFirestore.Timestamp.now(), messageIndex: 0 },
      baseEntry,
    ];
    mockFirestore.getDoc.mockResolvedValueOnce({
      exists: () => true,
      data: () => ({ entries }),
    });

    await saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'Corrected text', 'user-uid', 'Alice');

    const updateData = mockFirestore.updateDoc.mock.calls[0][1];
    expect(updateData.editedEntries[0].text).toBe('Bot message');
    expect(updateData.editedEntries[1].text).toBe('Corrected text');
  });

  it('throws when transcript document does not exist', async () => {
    mockFirestore.getDoc.mockResolvedValueOnce({ exists: () => false });

    await expect(
      saveMessageEdit('family-1', 'dossier-1', 'session-1', 1, 'Corrected', 'user-uid', 'Alice'),
    ).rejects.toThrow('Transcript not found');
  });
});

describe('saveMiscFact', () => {
  it('saves a new fact and returns its ID', async () => {
    mockFirestore.addDoc.mockResolvedValueOnce({ id: 'fact-abc' });

    const id = await saveMiscFact('family-1', 'dossier-1', {
      text: 'Margaret was born in 1934, not 1936.',
      isCorrection: true,
      correctionNote: 'Prior sessions recorded birth year as 1936.',
      source: 'talk',
    });

    expect(id).toBe('fact-abc');
    expect(mockFirestore.addDoc).toHaveBeenCalledTimes(1);
  });

  it('writes to the miscFacts subcollection path', async () => {
    await saveMiscFact('family-1', 'dossier-1', {
      text: 'Arthur worked at the mill until 1960.',
      isCorrection: false,
      source: 'talk',
    });

    expect(mockFirestore.collection).toHaveBeenCalledWith(
      expect.anything(),
      'families',
      'family-1',
      'dossiers',
      'dossier-1',
      'miscFacts',
    );
  });

  it('includes a createdAt timestamp', async () => {
    await saveMiscFact('family-1', 'dossier-1', {
      text: 'Some fact.',
      isCorrection: false,
      source: 'talk',
    });

    const data = mockFirestore.addDoc.mock.calls[0][1];
    expect(data.createdAt).toBeDefined();
    expect(data.text).toBe('Some fact.');
    expect(data.isCorrection).toBe(false);
    expect(data.source).toBe('talk');
  });

  it('persists correctionNote when provided', async () => {
    await saveMiscFact('family-1', 'dossier-1', {
      text: 'Corrected fact.',
      isCorrection: true,
      correctionNote: 'Explains what it corrects.',
      source: 'talk',
    });

    const data = mockFirestore.addDoc.mock.calls[0][1];
    expect(data.correctionNote).toBe('Explains what it corrects.');
  });
});

describe('getMiscFacts', () => {
  it('returns an empty array when no facts exist', async () => {
    mockFirestore.getDocs.mockResolvedValueOnce({ docs: [] });

    const facts = await getMiscFacts('family-1', 'dossier-1');

    expect(facts).toEqual([]);
  });

  it('maps Firestore docs to MiscFact objects with id', async () => {
    mockFirestore.getDocs.mockResolvedValueOnce({
      docs: [
        { id: 'fact-1', data: () => ({ text: 'Fact one', isCorrection: false, source: 'talk', createdAt: mockFirestore.Timestamp.now() }) },
        { id: 'fact-2', data: () => ({ text: 'Fact two', isCorrection: true, correctionNote: 'Corrects something.', source: 'talk', createdAt: mockFirestore.Timestamp.now() }) },
      ],
    });

    const facts = await getMiscFacts('family-1', 'dossier-1');

    expect(facts).toHaveLength(2);
    expect(facts[0].id).toBe('fact-1');
    expect(facts[0].text).toBe('Fact one');
    expect(facts[1].id).toBe('fact-2');
    expect(facts[1].isCorrection).toBe(true);
    expect(facts[1].correctionNote).toBe('Corrects something.');
  });

  it('queries the miscFacts subcollection ordered by createdAt', async () => {
    await getMiscFacts('family-1', 'dossier-1');

    expect(mockFirestore.collection).toHaveBeenCalledWith(
      expect.anything(),
      'families',
      'family-1',
      'dossiers',
      'dossier-1',
      'miscFacts',
    );
    expect(mockFirestore.orderBy).toHaveBeenCalledWith('createdAt', 'asc');
  });
});
