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
 * Dossier management hook for LegacyBot.
 *
 * Provides CRUD operations for Dossiers stored in Firestore at
 * families/{familyId}/dossiers/{dossierId}. Each Dossier represents the full
 * context for interviewing one Storyteller.
 *
 * Key design decisions:
 *   - Dossier updates are debounced (500ms) to avoid excessive Firestore writes
 *   - Questions are stored as a subcollection (not an array) for real-time updates
 *   - Hook exposes a flat API — no knowledge of Firestore paths needed
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  where,
  Timestamp,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import { Dossier, InterviewQuestion } from '../types';

// ---------------------------------------------------------------------------
// Dossier List — used by the DossierList screen after login
// ---------------------------------------------------------------------------

/**
 * Subscribes to Dossiers for a given family.
 * If storytellerUid is provided, filters to only dossiers assigned to that user
 * (used for storyteller-only view).
 */
export function useDossierList(
  familyId: string | undefined,
  storytellerUid?: string,
) {
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!familyId) return;

    const colRef = collection(db, 'families', familyId, 'dossiers');
    const q = storytellerUid
      ? query(colRef, where('storytellerUid', '==', storytellerUid), orderBy('updatedAt', 'desc'))
      : query(colRef, orderBy('updatedAt', 'desc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        })) as Dossier[];
        setDossiers(items);
        setLoading(false);
      },
      (err) => {
        console.error('useDossierList snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [familyId, storytellerUid]);

  /** Create a new Dossier with a Storyteller name. Returns the new document ID. */
  async function createDossier(storytellerName: string, context = ''): Promise<string> {
    if (!familyId) throw new Error('No family selected');
    const colRef = collection(db, 'families', familyId, 'dossiers');
    const now = Timestamp.now();
    const newDossier: Omit<Dossier, 'id'> = {
      storytellerUid: null,
      storytellerName,
      storytellerContext: context,
      historicalContext: '',
      familyTree: [],
      selectedVoice: 'Zephyr',
      personality: 'empathetic',
      interviewerNotes: '',
      createdAt: now,
      updatedAt: now,
    };
    const docRef = await addDoc(colRef, newDossier);
    return docRef.id;
  }

  /** Permanently delete a Dossier. */
  async function deleteDossier(dossierId: string): Promise<void> {
    if (!familyId) throw new Error('No family selected');
    await deleteDoc(doc(db, 'families', familyId, 'dossiers', dossierId));
  }

  return { dossiers, loading, createDossier, deleteDossier };
}

/**
 * Link an existing dossier to a family member (set storytellerUid).
 * Used when granting the storyteller role to a member who already exists.
 */
export async function setDossierStoryteller(
  familyId: string,
  dossierId: string,
  uid: string,
): Promise<void> {
  const dossierRef = doc(db, 'families', familyId, 'dossiers', dossierId);
  await updateDoc(dossierRef, { storytellerUid: uid, updatedAt: Timestamp.now() });
}

// ---------------------------------------------------------------------------
// Single Dossier — used when editing or running a session
// ---------------------------------------------------------------------------

/**
 * Subscribes to a single Dossier and its questions subcollection.
 * Provides update functions with built-in debouncing for Dossier fields
 * and immediate writes for question status changes.
 */
export function useDossier(familyId: string | undefined, dossierId: string | undefined) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to the Dossier document
  useEffect(() => {
    if (!familyId || !dossierId) return;

    const docRef = doc(db, 'families', familyId, 'dossiers', dossierId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          setDossier({ ...snapshot.data(), id: snapshot.id } as Dossier);
        } else {
          setDossier(null);
        }
        setLoading(false);
      },
      (err) => {
        console.error('useDossier snapshot error:', err);
        setLoading(false);
      },
    );

    return unsubscribe;
  }, [familyId, dossierId]);

  // Subscribe to the questions subcollection
  useEffect(() => {
    if (!familyId || !dossierId) return;

    const colRef = collection(db, 'families', familyId, 'dossiers', dossierId, 'questions');
    const q = query(colRef, orderBy('order', 'asc'));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const items = snapshot.docs.map((doc) => ({
          ...doc.data(),
          id: doc.id,
        })) as InterviewQuestion[];
        setQuestions(items);
      },
      (err) => {
        console.error('useDossier questions snapshot error:', err);
      },
    );

    return unsubscribe;
  }, [familyId, dossierId]);

  // Clean up the debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  /**
   * Update Dossier fields (debounced 500ms).
   */
  const updateDossier = useCallback(
    (updates: Partial<Dossier>) => {
      if (!familyId || !dossierId) return;

      // Update local state immediately for responsive UI
      setDossier((prev) => (prev ? { ...prev, ...updates } : prev));

      // Debounce the Firestore write
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(async () => {
        const docRef = doc(db, 'families', familyId, 'dossiers', dossierId);
        await updateDoc(docRef, { ...updates, updatedAt: Timestamp.now() });
      }, 500);
    },
    [familyId, dossierId],
  );

  /** Add a new question to the Story Queue. */
  async function addQuestion(text: string): Promise<void> {
    if (!familyId || !dossierId) return;
    const colRef = collection(db, 'families', familyId, 'dossiers', dossierId, 'questions');
    const now = Timestamp.now();
    await addDoc(colRef, {
      text,
      status: 'Unasked',
      findings: '',
      order: questions.length,
      createdAt: now,
      updatedAt: now,
    });
  }

  /** Remove a question from the Story Queue. */
  async function removeQuestion(questionId: string): Promise<void> {
    if (!familyId || !dossierId) return;
    await deleteDoc(doc(db, 'families', familyId, 'dossiers', dossierId, 'questions', questionId));
  }

  /**
   * Update a question's fields (text, status, findings, order).
   * Writes are immediate (not debounced) since the bot needs real-time state.
   *
   * The question must exist in the loaded Story Queue. The Gemini interviewer
   * occasionally invents question IDs when calling `updateQuestionStatus`; a
   * write against a non-existent doc throws `FirebaseError: No document to
   * update`, which previously surfaced as an uncaught promise rejection during
   * live sessions. We validate against the loaded `questions` list and no-op
   * (with a warning) for unknown IDs instead. Returns `true` if a write was
   * issued, `false` if the ID was unknown.
   */
  async function updateQuestion(
    questionId: string,
    updates: Partial<InterviewQuestion>,
  ): Promise<boolean> {
    if (!familyId || !dossierId) return false;
    if (!questions.some((q) => q.id === questionId)) {
      console.warn(
        `[useDossier] updateQuestion: no Story Queue question with id "${questionId}"; skipping write.`,
      );
      return false;
    }
    const docRef = doc(db, 'families', familyId, 'dossiers', dossierId, 'questions', questionId);
    await updateDoc(docRef, { ...updates, updatedAt: Timestamp.now() });
    return true;
  }

  /** Reorder all questions by writing new `order` values in a batch. */
  async function reorderQuestions(orderedIds: string[]): Promise<void> {
    if (!familyId || !dossierId) return;
    const batch = writeBatch(db);
    orderedIds.forEach((id, index) => {
      const docRef = doc(db, 'families', familyId, 'dossiers', dossierId, 'questions', id);
      batch.update(docRef, { order: index, updatedAt: Timestamp.now() });
    });
    await batch.commit();
  }

  return {
    dossier,
    questions,
    loading,
    updateDossier,
    addQuestion,
    removeQuestion,
    updateQuestion,
    reorderQuestions,
  };
}
