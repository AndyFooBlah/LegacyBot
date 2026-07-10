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
 * Migration script: Single-user model → Family-based model
 *
 * For each user in users/{uid}:
 *   1. Create a family document
 *   2. Add the user as the admin member
 *   3. Copy all dossiers from users/{uid}/dossiers/ to families/{familyId}/dossiers/
 *   4. Copy all subcollections (questions, sessions, transcripts)
 *   5. Move GCS files from {uid}/... to {familyId}/...
 *   6. Update users/{uid}.familyIds
 *
 * Idempotent: checks for existing family before creating. Safe to re-run.
 *
 * Usage:
 *   npx ts-node --esm scripts/migrate-to-families.ts
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a service account key
 *   - Or run from a GCE instance with appropriate permissions
 */

import * as admin from 'firebase-admin';

admin.initializeApp();

const db = admin.firestore();
const storage = admin.storage().bucket();

async function migrate() {
  console.log('Starting migration to family-based model...\n');

  const usersSnapshot = await db.collection('users').get();
  console.log(`Found ${usersSnapshot.size} users to migrate.\n`);

  for (const userDoc of usersSnapshot.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data();
    console.log(`\n--- Migrating user: ${userData.displayName ?? userData.email} (${uid}) ---`);

    // Check if user already has families (idempotent check)
    if (userData.familyIds && userData.familyIds.length > 0) {
      console.log(`  User already has families: ${userData.familyIds.join(', ')}. Skipping.`);
      continue;
    }

    // 1. Create family
    const familyRef = await db.collection('families').add({
      name: `${userData.displayName ?? userData.email}'s Family`,
      createdAt: admin.firestore.Timestamp.now(),
      createdBy: uid,
    });
    const familyId = familyRef.id;
    console.log(`  Created family: ${familyId}`);

    // 2. Add user as admin member
    await db.collection('families').doc(familyId).collection('members').doc(uid).set({
      roles: ['admin'],
      email: userData.email ?? '',
      displayName: userData.displayName ?? '',
      joinedAt: admin.firestore.Timestamp.now(),
      invitedBy: uid,
    });
    console.log(`  Added user as admin member`);

    // 3. Copy dossiers
    const dossiersSnapshot = await db
      .collection('users')
      .doc(uid)
      .collection('dossiers')
      .get();

    console.log(`  Found ${dossiersSnapshot.size} dossiers to copy`);

    for (const dossierDoc of dossiersSnapshot.docs) {
      const dossierId = dossierDoc.id;
      const dossierData = dossierDoc.data();

      // Write dossier to new path with storytellerUid: null
      await db
        .collection('families')
        .doc(familyId)
        .collection('dossiers')
        .doc(dossierId)
        .set({
          ...dossierData,
          storytellerUid: null,
        });
      console.log(`    Copied dossier: ${dossierData.storytellerName} (${dossierId})`);

      // Copy questions subcollection
      const questionsSnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('dossiers')
        .doc(dossierId)
        .collection('questions')
        .get();

      for (const qDoc of questionsSnapshot.docs) {
        await db
          .collection('families')
          .doc(familyId)
          .collection('dossiers')
          .doc(dossierId)
          .collection('questions')
          .doc(qDoc.id)
          .set(qDoc.data());
      }
      if (questionsSnapshot.size > 0) {
        console.log(`      Copied ${questionsSnapshot.size} questions`);
      }

      // Copy sessions subcollection
      const sessionsSnapshot = await db
        .collection('users')
        .doc(uid)
        .collection('dossiers')
        .doc(dossierId)
        .collection('sessions')
        .get();

      for (const sessionDoc of sessionsSnapshot.docs) {
        const sessionId = sessionDoc.id;
        const sessionData = sessionDoc.data();

        // Add storytellerUid to session data
        await db
          .collection('families')
          .doc(familyId)
          .collection('dossiers')
          .doc(dossierId)
          .collection('sessions')
          .doc(sessionId)
          .set({
            ...sessionData,
            storytellerUid: uid,
          });

        // Copy transcript subcollection
        const transcriptSnapshot = await db
          .collection('users')
          .doc(uid)
          .collection('dossiers')
          .doc(dossierId)
          .collection('sessions')
          .doc(sessionId)
          .collection('transcript')
          .get();

        for (const tDoc of transcriptSnapshot.docs) {
          await db
            .collection('families')
            .doc(familyId)
            .collection('dossiers')
            .doc(dossierId)
            .collection('sessions')
            .doc(sessionId)
            .collection('transcript')
            .doc(tDoc.id)
            .set(tDoc.data());
        }
      }
      if (sessionsSnapshot.size > 0) {
        console.log(`      Copied ${sessionsSnapshot.size} sessions with transcripts`);
      }

      // 5. Move GCS files
      const oldPrefix = `${uid}/${dossierId}/`;
      const newPrefix = `${familyId}/${dossierId}/`;

      try {
        const [files] = await storage.getFiles({ prefix: oldPrefix });
        for (const file of files) {
          const newPath = file.name.replace(oldPrefix, newPrefix);
          await file.copy(storage.file(newPath));
          console.log(`      Moved GCS: ${file.name} → ${newPath}`);
        }
      } catch (err) {
        console.log(`      No GCS files found for ${oldPrefix} (or error): ${err}`);
      }
    }

    // 6. Update user's familyIds
    await db.collection('users').doc(uid).update({
      familyIds: admin.firestore.FieldValue.arrayUnion(familyId),
    });
    console.log(`  Updated user.familyIds`);
  }

  console.log('\n\nMigration complete!');
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
