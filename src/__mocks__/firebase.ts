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
 * Firebase module mocks for testing.
 *
 * Mocks all Firebase services (Auth, Firestore, Storage) so that unit tests
 * never make real network calls. Each mock provides controllable behavior
 * via vi.fn() — tests can override return values per-test with mockResolvedValue.
 *
 * Usage in tests:
 *   import { mockFirestore } from '../../__mocks__/firebase';
 *   mockFirestore.getDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({...}) });
 */

import { vi } from 'vitest';

// --- Firestore mocks ---

export const mockFirestore = {
  doc: vi.fn((..._args: any[]) => ({ path: _args.join('/') })),
  collection: vi.fn((..._args: any[]) => ({ path: _args.join('/') })),
  getDoc: vi.fn().mockResolvedValue({ exists: () => false, data: () => null }),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  setDoc: vi.fn().mockResolvedValue(undefined),
  addDoc: vi.fn().mockResolvedValue({ id: 'mock-doc-id' }),
  updateDoc: vi.fn().mockResolvedValue(undefined),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  onSnapshot: vi.fn((_query: any, callback: any) => {
    // Immediately invoke with empty result, return unsubscribe fn
    callback({ docs: [] });
    return vi.fn(); // unsubscribe
  }),
  query: vi.fn((..._args: any[]) => ({})),
  where: vi.fn(),
  orderBy: vi.fn(),
  writeBatch: vi.fn(() => ({
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn().mockResolvedValue(undefined),
  })),
  arrayUnion: vi.fn((..._args: any[]) => _args),
  Timestamp: {
    now: () => ({ toDate: () => new Date(), seconds: Date.now() / 1000, nanoseconds: 0 }),
    fromDate: (d: Date) => ({ toDate: () => d, seconds: d.getTime() / 1000, nanoseconds: 0 }),
  },
};

vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({})),
  doc: mockFirestore.doc,
  collection: mockFirestore.collection,
  getDoc: mockFirestore.getDoc,
  getDocs: mockFirestore.getDocs,
  setDoc: mockFirestore.setDoc,
  addDoc: mockFirestore.addDoc,
  updateDoc: mockFirestore.updateDoc,
  deleteDoc: mockFirestore.deleteDoc,
  onSnapshot: mockFirestore.onSnapshot,
  query: mockFirestore.query,
  where: mockFirestore.where,
  orderBy: mockFirestore.orderBy,
  writeBatch: mockFirestore.writeBatch,
  arrayUnion: mockFirestore.arrayUnion,
  Timestamp: mockFirestore.Timestamp,
}));

// --- Auth mocks ---

export const mockAuth = {
  onAuthStateChanged: vi.fn((_auth: any, callback: any) => {
    // Default: no user signed in
    callback(null);
    return vi.fn(); // unsubscribe
  }),
  signInWithPopup: vi.fn().mockResolvedValue({
    user: { uid: 'mock-uid', email: 'mock@example.com', displayName: 'Mock User' },
  }),
  signInWithEmailAndPassword: vi.fn().mockResolvedValue({
    user: { uid: 'mock-uid', email: 'mock@example.com', displayName: null },
  }),
  createUserWithEmailAndPassword: vi.fn().mockResolvedValue({
    user: { uid: 'new-uid', email: 'new@example.com', displayName: null },
  }),
  sendEmailVerification: vi.fn().mockResolvedValue(undefined),
  signOut: vi.fn().mockResolvedValue(undefined),
  GoogleAuthProvider: vi.fn(),
};

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: mockAuth.onAuthStateChanged,
  signInWithPopup: mockAuth.signInWithPopup,
  signInWithEmailAndPassword: mockAuth.signInWithEmailAndPassword,
  createUserWithEmailAndPassword: mockAuth.createUserWithEmailAndPassword,
  sendEmailVerification: mockAuth.sendEmailVerification,
  signOut: mockAuth.signOut,
  GoogleAuthProvider: mockAuth.GoogleAuthProvider,
}));

// --- Storage mocks ---

export const mockStorage = {
  ref: vi.fn((_storage: any, path: string) => ({ fullPath: path })),
  uploadBytes: vi.fn().mockResolvedValue({ ref: { fullPath: 'mock-path' } }),
  getDownloadURL: vi.fn().mockResolvedValue('https://storage.example.com/mock-audio.webm'),
};

vi.mock('firebase/storage', () => ({
  getStorage: vi.fn(() => ({})),
  ref: mockStorage.ref,
  uploadBytes: mockStorage.uploadBytes,
  getDownloadURL: mockStorage.getDownloadURL,
}));

// --- Firebase app mock ---

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({})),
}));

// --- Firebase service module mock (our own wrapper) ---

vi.mock('../services/firebase', () => ({
  auth: {},
  db: {},
  storage: {},
  default: {},
}));
