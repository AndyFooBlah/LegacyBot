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
 * Authentication hook for LegacyBot.
 *
 * Wraps Firebase Auth state in a React hook that provides:
 *   - user:     The currently signed-in Firebase user (or null)
 *   - loading:  Whether the auth state is still being determined
 *   - signInWithGoogle:  Trigger Google OAuth popup sign-in
 *   - signInWithEmail:   Sign in with email/password
 *   - signUpWithEmail:   Register a new account with email/password
 *   - signOut:           Sign the user out and clear local state
 *
 * On first login, a user profile document is created in Firestore at
 * users/{uid} with the user's email and display name.
 *
 * References: design.md §3.1 | GitHub Issue #2
 */

import { useState, useEffect } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signOut as firebaseSignOut,
  User,
} from 'firebase/auth';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';
import { auth, db } from '../services/firebase';
import { UserProfile } from '../types';

const googleProvider = new GoogleAuthProvider();

async function ensureUserProfile(user: User): Promise<void> {
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!snapshot.exists()) {
    const profile: UserProfile = {
      email: user.email ?? '',
      displayName: user.displayName ?? user.email ?? 'Anonymous',
      createdAt: Timestamp.now(),
      familyIds: [],
    };
    await setDoc(userRef, { ...profile, timezone });
  } else {
    const existing = snapshot.data();
    if (existing.timezone !== timezone) {
      await setDoc(userRef, { timezone }, { merge: true });
    }
  }
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isSuperadmin, setIsSuperadmin] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
      if (firebaseUser) {
        ensureUserProfile(firebaseUser).catch((err) =>
          console.error('[Auth] ensureUserProfile error:', err)
        );
        // Read the isSuperadmin custom claim from the ID token. The claim is
        // written by the onUserProfileWritten Cloud Function when the flag
        // is set directly in the Firestore console. A user promoted while
        // signed in must sign out and back in (or refresh the token) to
        // pick up the new claim — documented in the README.
        firebaseUser.getIdTokenResult()
          .then((result) => setIsSuperadmin(result.claims.isSuperadmin === true))
          .catch((err) => console.error('[Auth] Failed to read token claims:', err));
      } else {
        setIsSuperadmin(false);
      }
    });
    return unsubscribe;
  }, []);

  async function signInWithGoogle(): Promise<void> {
    await signInWithPopup(auth, googleProvider);
  }

  async function signInWithEmail(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function signUpWithEmail(email: string, password: string): Promise<void> {
    const credential = await createUserWithEmailAndPassword(auth, email, password);
    // Firestore rules gate invitation acceptance on email_verified — anyone
    // can create an account claiming any email address, so the address must
    // be proven before it grants access to invitations sent to it.
    // Best-effort: a send failure must not break account creation.
    try {
      await sendEmailVerification(credential.user);
    } catch (err) {
      console.error('[Auth] Failed to send verification email:', err);
    }
  }

  async function signOut(): Promise<void> {
    await firebaseSignOut(auth);
  }

  return {
    user,
    loading,
    isSuperadmin,
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    signOut,
  };
}
