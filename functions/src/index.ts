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
 * Cloud Functions for LegacyBot (firebase-functions v2 API).
 *
 * onInvitationCreated:  Triggered on new invitation doc — sends invite email.
 * onMemberWritten:      Triggered on member write — syncs familyIds custom claims.
 * onSessionCompleted:   Triggered when session status → 'completed'.
 *                       Sends admin notification + runs deep gap analysis.
 * sendDailyDigest:      Scheduled hourly — emails storytellers who haven't
 *                       recorded in 2–7 days with upcoming topics.
 * updateMemberEmail:    Callable — update a family member's email (admin only).
 * resetMemberPassword:  Callable — generate a password reset link (admin only).
 * triggerDigestForDossier: Callable — manually send digest email (admin only).
 * generateMemoir:       Callable — generate a memoir via Gemini (admin only).
 *
 * Environment variables (set via functions/.env or Firebase Console):
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, APP_URL
 * Secrets (set via firebase functions:secrets:set):
 *   SMTP_PASS, GEMINI_API_KEY, GOOGLE_MAPS_API_KEY
 */

import { randomInt } from 'node:crypto';
import { defineString, defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { onCall, HttpsError, CallableRequest } from 'firebase-functions/v2/https';
import {
  onDocumentCreated,
  onDocumentUpdated,
  onDocumentWritten,
} from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import * as nodemailer from 'nodemailer';
import { runGapAnalysis, saveGapAnalysis, getGapAnalysis } from './analysis';
import { generateMemoirContent } from './memoir';
import {
  chunkProse,
  chunkTranscript,
  deleteChunksForSource,
  writeChunks,
  embedTexts,
} from './embeddings';
import { enforceRateLimit } from './rateLimit';
import { parseMediaPathFamilyId } from './mediaPath';
import { buildCacheWikipediaArticleHandler } from './cacheWikipedia';
import { buildMintGeminiLiveTokenHandler } from './liveToken';
import { buildInvokeGeminiHandler } from './invokeGemini';
import { buildEmbedGeminiHandler } from './embedGemini';
import { fetchWithTimeout, FetchTimeoutError, TIMEOUTS } from './httpTimeouts';

export { dailyStorageCleanup } from './scheduledCleanup';

admin.initializeApp();

/**
 * Escape a string for safe interpolation into HTML body content.
 *
 * Any field that originates from user input (displayName, familyName,
 * dossier fields, question topics) or from a Gemini response must pass
 * through this before being interpolated into an email's HTML — without
 * it, an account holder can set a field like `<img src=x onerror=...>`
 * and have the payload rendered in every recipient's email client.
 *
 * Escapes the five characters that have meaning in HTML body + attribute
 * contexts. Not safe for inline <script> or style contexts, but we don't
 * interpolate anywhere near those.
 */
function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Partially mask an email address for safe inclusion in logs.
 *
 * `jane@example.com` → `j***@e***.com` — enough to tell messages apart
 * when debugging, not enough to reconstruct the PII from log exports.
 */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at < 1) return '***';
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf('.');
  const domainHead = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : '';
  return `${local[0]}***@${domainHead[0] ?? '*'}***${tld}`;
}

const db = admin.firestore();

// Environment parameters
const smtpHost = defineString('SMTP_HOST', { default: '' });
const smtpPort = defineString('SMTP_PORT', { default: '587' });
const smtpUser = defineString('SMTP_USER', { default: '' });
const smtpPass = defineSecret('SMTP_PASS');
const geminiApiKey = defineSecret('GEMINI_API_KEY');
const appUrl = defineString('APP_URL', { default: 'https://your-app.web.app' });
const googleMapsApiKey = defineSecret('GOOGLE_MAPS_API_KEY');

// ---------------------------------------------------------------------------
// Invitation email
// ---------------------------------------------------------------------------

/**
 * Triggered when a new invitation document is created.
 * Sends an invitation email with a link to join the family.
 */
export const onInvitationCreated = onDocumentCreated(
  { document: 'invitations/{inviteId}', secrets: [smtpPass] },
  async (event) => {
    const snapshot = event.data;
    const inviteId = event.params.inviteId;
    const invitation = snapshot?.data();

    if (!invitation) {
      logger.error('No invitation data found');
      return;
    }

    const { email, familyId, roles, invitedBy } = invitation;

    let familyName = 'a family';
    try {
      const familyDoc = await db.collection('families').doc(familyId).get();
      if (familyDoc.exists) familyName = familyDoc.data()?.name ?? familyName;
    } catch (err) {
      logger.warn('Could not look up family name:', err);
    }

    let inviterName = 'A family member';
    try {
      const inviterDoc = await db.collection('users').doc(invitedBy).get();
      if (inviterDoc.exists) inviterName = inviterDoc.data()?.displayName ?? inviterName;
    } catch (err) {
      logger.warn('Could not look up inviter name:', err);
    }

    const inviteUrl = `${appUrl.value()}/invite?token=${inviteId}`;

    if (!smtpHost.value() || !smtpUser.value() || !smtpPass.value()) {
      logger.error('SMTP not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS.');
      return;
    }

    const port = parseInt(smtpPort.value(), 10);
    const transporter = nodemailer.createTransport({
      host: smtpHost.value(),
      port,
      secure: port === 465,
      auth: { user: smtpUser.value(), pass: smtpPass.value() },
    });

    const roleText = roles.join(' and ');
    const inviterNameSafe = escapeHtml(inviterName);
    const familyNameSafe = escapeHtml(familyName);
    const roleTextSafe = escapeHtml(roleText);

    try {
      await transporter.sendMail({
        from: `"LegacyBot" <${smtpUser.value()}>`,
        to: email,
        subject: `${inviterName} invited you to ${familyName} on LegacyBot`,
        html: `
          <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
            <h1 style="font-size: 24px; color: #1e293b;">You're Invited!</h1>
            <p style="color: #64748b; line-height: 1.6;">
              <strong>${inviterNameSafe}</strong> has invited you to join
              <strong>${familyNameSafe}</strong> on LegacyBot as a <strong>${roleTextSafe}</strong>.
            </p>
            <p style="color: #64748b; line-height: 1.6;">
              LegacyBot helps families preserve their stories through AI-guided
              oral history sessions.
            </p>
            <a href="${inviteUrl}"
               style="display: inline-block; margin-top: 16px; padding: 14px 28px;
                      background: #4f46e5; color: white; text-decoration: none;
                      border-radius: 12px; font-weight: bold; font-size: 16px;">
              Accept Invitation
            </a>
            <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
              If you didn't expect this email, you can safely ignore it.
            </p>
          </div>
        `,
      });
      logger.info(`Invitation email sent to ${maskEmail(email)} for family ${familyId}`);
    } catch (err) {
      logger.error('Failed to send invitation email:', err);
    }
  },
);

// ---------------------------------------------------------------------------
// Custom claims sync
// ---------------------------------------------------------------------------

/**
 * Triggered whenever a member document is created, updated, or deleted.
 *
 * This function is the SOLE, AUTHORITATIVE maintainer of both
 * `users/{uid}.familyIds` and the matching `familyIds` custom claim. Clients
 * are denied writes to that profile field (see firestore.rules), so the field
 * — and the claim `storage.rules` gates all access on — can only ever reflect
 * real membership: a member doc exists because the invitation rules admitted
 * the user to that specific family. This is what makes cross-family isolation
 * un-forgeable; a client cannot name a family it never joined.
 *
 * The member doc's presence/absence after the write tells us whether this is a
 * join (add the familyId) or a removal (drop it). arrayUnion/arrayRemove are
 * idempotent, so redundant/retried events are safe.
 */
export const onMemberWritten = onDocumentWritten(
  'families/{familyId}/members/{memberId}',
  async (event) => {
    const uid = event.params.memberId;
    const familyId = event.params.familyId;
    const isMember = event.data?.after?.exists ?? false;
    try {
      const userRef = db.collection('users').doc(uid);
      await userRef.set(
        {
          familyIds: isMember
            ? admin.firestore.FieldValue.arrayUnion(familyId)
            : admin.firestore.FieldValue.arrayRemove(familyId),
        },
        { merge: true },
      );

      const familyIds: string[] = (await userRef.get()).data()?.familyIds ?? [];
      const userRecord = await admin.auth().getUser(uid);
      await admin.auth().setCustomUserClaims(uid, {
        ...userRecord.customClaims,
        familyIds,
      });

      // On removal, revoke refresh tokens so the ejected member cannot silently
      // re-mint a token that still carries the family. Existing ID tokens stay
      // valid until they expire (≤1h) — the inherent Firebase revocation window.
      if (!isMember) {
        await admin.auth().revokeRefreshTokens(uid);
      }
      logger.info(
        `[Claims] ${uid} ${isMember ? 'added to' : 'removed from'} ${familyId}; ` +
        `familyIds now [${familyIds.join(', ')}]`,
      );
    } catch (err) {
      logger.error(`[Claims] Failed to update claims for ${uid}:`, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Admin helpers
// ---------------------------------------------------------------------------

async function verifyFamilyAdmin(request: CallableRequest, familyId: string): Promise<void> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  const memberDoc = await db
    .collection('families').doc(familyId)
    .collection('members').doc(request.auth.uid)
    .get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'Not a family member.');
  }
  const roles: string[] = memberDoc.data()?.roles ?? [];
  if (!roles.includes('admin')) {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
}

/**
 * Assert that `targetUid` is a member of `familyId`. Prevents a family admin
 * from operating on users outside their own family (e.g. resetting the
 * password or rewriting the email of an unrelated account by passing an
 * arbitrary uid).
 */
async function verifyMemberOfFamily(familyId: string, targetUid: string): Promise<void> {
  const memberDoc = await db
    .collection('families').doc(familyId)
    .collection('members').doc(targetUid)
    .get();
  if (!memberDoc.exists) {
    throw new HttpsError('permission-denied', 'Target user is not a member of this family.');
  }
}

/**
 * Assert that `targetUid` belongs to no family other than `familyId`.
 *
 * updateMemberEmail / resetMemberPassword mutate the target's *global*
 * Firebase Auth account, not just their membership in the caller's family.
 * If the target also belongs to other families, an admin of one family could
 * take over an account shared with families they have no authority over
 * (change the login email, then password-reset into it). Uses
 * `users/{uid}.familyIds` — the same source of truth `onMemberWritten` syncs
 * into Auth custom claims.
 */
async function verifyTargetOnlyInFamily(familyId: string, targetUid: string): Promise<void> {
  const userDoc = await db.collection('users').doc(targetUid).get();
  const familyIds: string[] = userDoc.data()?.familyIds ?? [];
  const otherFamilies = familyIds.filter((id) => id !== familyId);
  if (otherFamilies.length > 0) {
    throw new HttpsError(
      'permission-denied',
      'This member also belongs to other families, so their account can only be ' +
      'managed by the member themselves (e.g. via "Forgot password" on the sign-in screen).',
    );
  }
}

/**
 * Callable: update a family member's email address (admin only).
 */
export const updateMemberEmail = onCall(
  { secrets: [smtpPass] },
  async (request: CallableRequest) => {
  const { familyId, targetUid, newEmail } = request.data;
  if (!familyId || !targetUid || !newEmail) {
    throw new HttpsError('invalid-argument', 'familyId, targetUid, and newEmail are required.');
  }
  if (typeof newEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
    throw new HttpsError('invalid-argument', 'newEmail is not a valid email address.');
  }
  await verifyFamilyAdmin(request, familyId);
  await verifyMemberOfFamily(familyId, targetUid);
  await verifyTargetOnlyInFamily(familyId, targetUid);
  const previousEmail = (await admin.auth().getUser(targetUid)).email;
  const normalized = newEmail.toLowerCase();
  await admin.auth().updateUser(targetUid, { email: normalized });
  await db.collection('families').doc(familyId).collection('members').doc(targetUid)
    .update({ email: normalized });
  await db.collection('users').doc(targetUid).update({ email: normalized });

  // Notify the OLD address so the real owner learns about the change even if
  // it was unauthorized. Best-effort: a mail failure must not fail the call.
  if (previousEmail && previousEmail.toLowerCase() !== normalized) {
    const transporter = createTransporter();
    if (!transporter) {
      logger.warn('SMTP not configured — cannot notify old address of email change');
    } else {
      try {
        await transporter.sendMail({
          from: `"LegacyBot" <${smtpUser.value()}>`,
          to: previousEmail,
          subject: 'Your LegacyBot account email was changed',
          html: `
            <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
              <h1 style="font-size: 24px; color: #1e293b;">Account Email Changed</h1>
              <p style="color: #64748b; line-height: 1.6;">
                A family admin changed the sign-in email on your LegacyBot account
                from <strong>${escapeHtml(previousEmail)}</strong> to
                <strong>${escapeHtml(normalized)}</strong>.
              </p>
              <p style="color: #64748b; line-height: 1.6;">
                If you did not expect this change, contact your family admin
                immediately, or reply to this email.
              </p>
            </div>
          `,
        });
        logger.info(`Email-change notification sent to ${maskEmail(previousEmail)}`);
      } catch (err) {
        logger.error(`Failed to send email-change notification to ${maskEmail(previousEmail)}:`, err);
      }
    }
  }

  return { success: true };
});

/**
 * Callable: generate a password reset link for a family member (admin only).
 */
export const resetMemberPassword = onCall(async (request: CallableRequest) => {
  const { familyId, targetUid } = request.data;
  if (!familyId || !targetUid) {
    throw new HttpsError('invalid-argument', 'familyId and targetUid are required.');
  }
  await verifyFamilyAdmin(request, familyId);
  await verifyMemberOfFamily(familyId, targetUid);
  await verifyTargetOnlyInFamily(familyId, targetUid);
  const userRecord = await admin.auth().getUser(targetUid);
  if (!userRecord.email) {
    throw new HttpsError('not-found', 'User has no email address.');
  }
  const resetLink = await admin.auth().generatePasswordResetLink(userRecord.email);
  return { resetLink };
});

// ---------------------------------------------------------------------------
// Invitation codes
// ---------------------------------------------------------------------------

/**
 * Callable: validate an invitation code and, if valid, atomically create the
 * new family and record the redemption. Codes are multi-use and active by
 * default; a given user may redeem a given code at most once.
 *
 * Input:  { code: string, familyName: string }
 * Output: { familyId: string }
 *
 * Errors:
 *   unauthenticated — caller is not signed in
 *   invalid-argument — code or familyName missing
 *   not-found — code does not exist in invitationCodes
 *   failed-precondition — code is not active (deactivated, or legacy `used:true`)
 *   already-exists — caller has already redeemed this specific code
 */
export const redeemInvitationCode = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }

  const { code, familyName } = request.data;
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new HttpsError('invalid-argument', 'code is required.');
  }
  if (!familyName || typeof familyName !== 'string' || !familyName.trim()) {
    throw new HttpsError('invalid-argument', 'familyName is required.');
  }
  if (code.length > 64) {
    throw new HttpsError('invalid-argument', 'code is too long.');
  }
  if (familyName.length > 120) {
    throw new HttpsError('invalid-argument', 'familyName is too long.');
  }

  const uid = request.auth.uid;
  const email = (request.auth.token.email ?? '').toLowerCase();
  const displayName = request.auth.token.name ?? email ?? 'Anonymous';
  const normalizedCode = code.trim().toUpperCase();
  const codeRef = db.collection('invitationCodes').doc(normalizedCode);
  const redemptionRef = codeRef.collection('redemptions').doc(uid);

  let familyId: string;

  await db.runTransaction(async (tx) => {
    const [codeDoc, redemptionDoc] = await Promise.all([
      tx.get(codeRef),
      tx.get(redemptionRef),
    ]);

    if (!codeDoc.exists) {
      throw new HttpsError('not-found', 'Invitation code not found.');
    }
    const codeData = codeDoc.data() ?? {};
    // Legacy single-use codes had `used: true` and no `active` field.
    // Treat either a missing/false `active` flag OR legacy `used: true` as
    // "not redeemable" so an old, already-burned code never reactivates.
    const isActive = codeData.active === true && codeData.used !== true;
    if (!isActive) {
      throw new HttpsError('failed-precondition', 'Invitation code is not active.');
    }
    if (redemptionDoc.exists) {
      throw new HttpsError('already-exists', 'You have already redeemed this code.');
    }

    const familyRef = db.collection('families').doc();
    familyId = familyRef.id;
    const now = admin.firestore.Timestamp.now();

    tx.set(familyRef, {
      name: familyName.trim(),
      familyTree: [],
      createdAt: now,
      createdBy: uid,
    });

    const memberRef = familyRef.collection('members').doc(uid);
    tx.set(memberRef, {
      roles: ['admin'],
      email,
      displayName,
      joinedAt: now,
      invitedBy: uid,
    });
    // The user's familyIds profile field + custom claim are set by the
    // onMemberWritten trigger that fires on this member doc — the single
    // authoritative writer of that field, so it's not written here.

    tx.update(codeRef, {
      redemptionCount: admin.firestore.FieldValue.increment(1),
    });

    tx.set(redemptionRef, {
      redeemedAt: now,
      familyId,
      userEmail: email,
      userDisplayName: displayName,
    });
  });

  logger.info(`[InvitationCode] Code "${normalizedCode}" redeemed by ${uid}, family ${familyId!} created.`);
  return { familyId: familyId! };
});

// ---------------------------------------------------------------------------
// Superadmin invitation-code management
// ---------------------------------------------------------------------------

/**
 * Verify the caller's Firebase Auth token carries the `isSuperadmin` custom
 * claim. The claim is written by `onUserProfileWritten` when the superadmin
 * flag on the user's Firestore profile flips to true. Setting the flag is a
 * manual operation performed directly in the Firestore console (see README).
 */
function verifySuperadmin(request: CallableRequest): string {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in.');
  }
  if (request.auth.token.isSuperadmin !== true) {
    throw new HttpsError('permission-denied', 'Superadmin role required.');
  }
  return request.auth.uid;
}

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_LENGTH = 6;

function generateRandomCode(): string {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    // crypto.randomInt: CSPRNG-backed and uniform — Math.random() is neither,
    // and invitation codes are bearer credentials that gate family creation.
    out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * Callable (superadmin only): generate a new 6-character alphanumeric
 * invitation code and persist it as active with zero redemptions.
 *
 * Retries generation on collision with an existing code up to 20 times; at
 * 36^6 = ~2B codes this is negligible until the collection is truly huge.
 */
export const generateInvitationCode = onCall(async (request: CallableRequest) => {
  const uid = verifySuperadmin(request);
  const { description } = request.data ?? {};
  if (description !== undefined && (typeof description !== 'string' || description.length > 200)) {
    throw new HttpsError('invalid-argument', 'description must be a string ≤ 200 chars.');
  }

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = generateRandomCode();
    const codeRef = db.collection('invitationCodes').doc(candidate);
    const existing = await codeRef.get();
    if (existing.exists) continue;

    const now = admin.firestore.Timestamp.now();
    await codeRef.set({
      createdBy: uid,
      createdAt: now,
      active: true,
      redemptionCount: 0,
      ...(description ? { description } : {}),
    });
    logger.info(`[InvitationCode] Superadmin ${uid} generated code "${candidate}".`);
    return { code: candidate };
  }

  throw new HttpsError('internal', 'Failed to generate a unique code after 20 attempts.');
});

/**
 * Callable (superadmin only): flip a code's `active` flag to false. Existing
 * redemptions are preserved; the code can be reactivated later by setting
 * `active: true` again via `reactivateInvitationCode`.
 */
export const deactivateInvitationCode = onCall(async (request: CallableRequest) => {
  const uid = verifySuperadmin(request);
  const { code } = request.data ?? {};
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new HttpsError('invalid-argument', 'code is required.');
  }
  const normalized = code.trim().toUpperCase();
  const codeRef = db.collection('invitationCodes').doc(normalized);
  const snapshot = await codeRef.get();
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'Invitation code not found.');
  }
  await codeRef.update({
    active: false,
    deactivatedAt: admin.firestore.Timestamp.now(),
    deactivatedBy: uid,
  });
  logger.info(`[InvitationCode] Superadmin ${uid} deactivated code "${normalized}".`);
  return { code: normalized, active: false };
});

/**
 * Callable (superadmin only): set `active` back to true on a previously
 * deactivated code. Kept as a separate verb to keep the UI actions explicit.
 */
export const reactivateInvitationCode = onCall(async (request: CallableRequest) => {
  const uid = verifySuperadmin(request);
  const { code } = request.data ?? {};
  if (!code || typeof code !== 'string' || !code.trim()) {
    throw new HttpsError('invalid-argument', 'code is required.');
  }
  const normalized = code.trim().toUpperCase();
  const codeRef = db.collection('invitationCodes').doc(normalized);
  const snapshot = await codeRef.get();
  if (!snapshot.exists) {
    throw new HttpsError('not-found', 'Invitation code not found.');
  }
  await codeRef.update({
    active: true,
    deactivatedAt: admin.firestore.FieldValue.delete(),
    deactivatedBy: admin.firestore.FieldValue.delete(),
  });
  logger.info(`[InvitationCode] Superadmin ${uid} reactivated code "${normalized}".`);
  return { code: normalized, active: true };
});

/**
 * Triggered when a user profile document is written. Mirrors the
 * `isSuperadmin` boolean into the user's Firebase Auth custom claims so the
 * client UI and Cloud Functions can gate behavior on the token without an
 * extra Firestore read on every call. Preserves existing claims like
 * `familyIds` that `onMemberWritten` writes separately.
 */
export const onUserProfileWritten = onDocumentWritten(
  'users/{uid}',
  async (event) => {
    const uid = event.params.uid;
    const after = event.data?.after;
    if (!after?.exists) return; // profile deleted — nothing to sync
    const isSuperadmin = after.data()?.isSuperadmin === true;
    try {
      const userRecord = await admin.auth().getUser(uid);
      const existing = userRecord.customClaims ?? {};
      // Coerce a missing claim to false so this no-ops for ordinary users.
      // Without it, the first profile write for a new user (including the
      // familyIds write from onMemberWritten) would spuriously re-set claims
      // and could race with onMemberWritten's own claim update.
      if ((existing.isSuperadmin ?? false) === isSuperadmin) return;
      await admin.auth().setCustomUserClaims(uid, { ...existing, isSuperadmin });
      logger.info(`[Claims] Set isSuperadmin=${isSuperadmin} for ${uid}`);
    } catch (err) {
      logger.error(`[Claims] Failed to sync isSuperadmin for ${uid}:`, err);
    }
  },
);

// ---------------------------------------------------------------------------
// geoProxy — server-side proxy for Google Maps Geocoding + Weather APIs (#110)
//
// Keeps the Maps API key off the client bundle. Called in parallel with the
// direct client-side fetch during the diagnostic phase so we can compare
// latency and correctness before committing to one architecture.
// ---------------------------------------------------------------------------

/** Haversine great-circle distance in miles (duplicated from client externalSearch.ts). */
function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

interface GeoResult {
  formattedAddress: string;
  lat: number;
  lng: number;
}

async function geocodeServer(query: string, key: string): Promise<GeoResult | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query.trim())}&key=${key}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, TIMEOUTS.mapsGeocode);
  } catch (err) {
    if (err instanceof FetchTimeoutError) {
      logger.warn('[geoProxy] geocode timed out', { query, timeoutMs: err.timeoutMs });
      return null;
    }
    throw err;
  }
  if (!resp.ok) return null;
  const data = await resp.json() as any;
  if (data.status !== 'OK' || !data.results?.length) return null;
  const r = data.results[0];
  return {
    formattedAddress: r.formatted_address,
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
  };
}

export const geoProxy = onCall(
  { secrets: [googleMapsApiKey] },
  async (request: CallableRequest) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await enforceRateLimit(request.auth.uid, 'geoProxy');

  const key = googleMapsApiKey.value();
  if (!key) throw new HttpsError('internal', 'GOOGLE_MAPS_API_KEY not configured on server.');

  const { type, query, queryB } = request.data as {
    type: 'geocode' | 'distance' | 'weather';
    query: string;
    queryB?: string; // second place for distance
  };

  if (!type || !query) throw new HttpsError('invalid-argument', 'type and query are required.');
  if (typeof query !== 'string' || query.length > 500) {
    throw new HttpsError('invalid-argument', 'query is too long.');
  }
  if (queryB !== undefined && (typeof queryB !== 'string' || queryB.length > 500)) {
    throw new HttpsError('invalid-argument', 'queryB is too long.');
  }

  // --- Geocode ---
  if (type === 'geocode') {
    const geo = await geocodeServer(query, key);
    if (!geo) return { result: `No location found for "${query}".` };
    return {
      result: `${geo.formattedAddress} (coordinates: ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})`,
    };
  }

  // --- Distance ---
  if (type === 'distance') {
    if (!queryB) throw new HttpsError('invalid-argument', 'queryB required for distance.');
    const [geoA, geoB] = await Promise.all([
      geocodeServer(query, key),
      geocodeServer(queryB, key),
    ]);
    if (!geoA) return { result: `Could not find location for "${query}".` };
    if (!geoB) return { result: `Could not find location for "${queryB}".` };
    const miles = haversineDistanceMiles(geoA.lat, geoA.lng, geoB.lat, geoB.lng);
    const km = miles * 1.60934;
    return {
      result: `${geoA.formattedAddress} to ${geoB.formattedAddress}: approximately ${Math.round(miles)} miles (${Math.round(km)} km) as the crow flies.`,
    };
  }

  // --- Weather ---
  if (type === 'weather') {
    const geo = await geocodeServer(query, key);
    if (!geo) return { result: `Could not find location "${query}" for weather lookup.` };

    const locParams = `location.latitude=${geo.lat}&location.longitude=${geo.lng}&unitsSystem=IMPERIAL`;

    let currentRes: Response;
    let forecastRes: Response;
    try {
      [currentRes, forecastRes] = await Promise.all([
        fetchWithTimeout(`https://weather.googleapis.com/v1/currentConditions:lookup?key=${key}&${locParams}`, TIMEOUTS.mapsWeather),
        fetchWithTimeout(`https://weather.googleapis.com/v1/forecast/days:lookup?key=${key}&${locParams}&days=3`, TIMEOUTS.mapsWeather),
      ]);
    } catch (err) {
      if (err instanceof FetchTimeoutError) {
        logger.warn('[geoProxy] weather lookup timed out', { query, timeoutMs: err.timeoutMs });
        return { result: `Weather lookup for "${query}" took too long. Try again in a moment.` };
      }
      throw err;
    }

    if (!currentRes.ok && !forecastRes.ok) {
      logger.warn(`[geoProxy] Weather API failed for "${query}" — current: ${currentRes.status}, forecast: ${forecastRes.status}`);
      return { result: `Weather data unavailable for "${query}" at this time.` };
    }

    let summary = `Weather for ${geo.formattedAddress}:`;

    if (currentRes.ok) {
      const current = await currentRes.json() as any;
      const tempF = current.temperature?.degrees;
      const feelsF = current.feelsLikeTemperature?.degrees;
      const condition = current.weatherCondition?.description?.text ?? '';
      if (tempF != null) {
        const tempC = Math.round((tempF - 32) * 5 / 9);
        const feelsC = feelsF != null ? Math.round((feelsF - 32) * 5 / 9) : null;
        summary += ` Currently ${Math.round(tempF)}°F (${tempC}°C)`;
        if (feelsC != null && Math.abs(feelsF! - tempF) >= 3) {
          summary += `, feels like ${Math.round(feelsF!)}°F (${feelsC}°C)`;
        }
        if (condition) summary += `, ${condition.toLowerCase()}`;
        summary += '.';
      }
    }

    if (forecastRes.ok) {
      const forecast = await forecastRes.json() as any;
      const days: any[] = forecast.forecastDays ?? [];
      if (days.length > 0) {
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const dayParts = days.slice(0, 3).map((d: any) => {
          const dd = d.displayDate;
          const label = dd ? dayNames[new Date(dd.year, dd.month - 1, dd.day).getDay()] : '?';
          const hi = d.maxTemperature?.degrees;
          const lo = d.minTemperature?.degrees;
          const cond = d.daytimeForecast?.weatherCondition?.description?.text ?? '';
          let part = label;
          if (hi != null && lo != null) part += ` ${Math.round(hi)}/${Math.round(lo)}°F`;
          if (cond) part += ` ${cond.toLowerCase()}`;
          return part;
        });
        summary += ` Next 3 days: ${dayParts.join(', ')}.`;
      }
    }

    return { result: summary };
  }

  throw new HttpsError('invalid-argument', `Unknown type: ${type}`);
});

// ---------------------------------------------------------------------------
// Session completion — admin notification + gap analysis
// ---------------------------------------------------------------------------

function createTransporter(): nodemailer.Transporter | null {
  if (!smtpHost.value() || !smtpUser.value() || !smtpPass.value()) return null;
  const port = parseInt(smtpPort.value(), 10);
  return nodemailer.createTransport({
    host: smtpHost.value(),
    port,
    secure: port === 465,
    auth: { user: smtpUser.value(), pass: smtpPass.value() },
  });
}

/**
 * Triggered when a session document is updated to status 'completed'.
 * Sends admin notification email and runs gap analysis via Gemini.
 */
export const onSessionCompleted = onDocumentUpdated(
  {
    document: 'families/{familyId}/dossiers/{dossierId}/sessions/{sessionId}',
    secrets: [smtpPass, geminiApiKey],
    timeoutSeconds: 300,
    maxInstances: 5,
  },
  async (event) => {
    const before = event.data?.before.data();
    const after = event.data?.after.data();

    if (!before || !after) return;
    if (before.status === 'completed' || after.status !== 'completed') return;

    const { familyId, dossierId, sessionId } = event.params;

    let dossierData: Record<string, any> = {};
    try {
      const dossierDoc = await db
        .collection('families').doc(familyId)
        .collection('dossiers').doc(dossierId)
        .get();
      if (dossierDoc.exists) dossierData = dossierDoc.data() ?? {};
    } catch (err) {
      logger.warn('Could not look up dossier:', err);
    }

    const storytellerName: string = dossierData.storytellerName ?? 'a storyteller';
    const durationMins = Math.round((after.durationSeconds ?? 0) / 60);

    await Promise.allSettled([
      // Admin notification email
      (async () => {
        const membersSnap = await db
          .collection('families').doc(familyId)
          .collection('members')
          .where('roles', 'array-contains', 'admin')
          .get();

        const recipients: string[] = [];
        for (const memberDoc of membersSnap.docs) {
          const mData = memberDoc.data();
          if (mData.notifyOnSessionComplete && mData.email) {
            recipients.push(mData.email);
          }
        }

        if (recipients.length === 0) {
          logger.info('No admins opted in for session notifications');
          return;
        }

        const transporter = createTransporter();
        if (!transporter) {
          logger.error('SMTP not configured — cannot send session notification');
          return;
        }

        const sessionUrl =
          `${appUrl.value()}/family/${familyId}/dossier/${dossierId}/history/${sessionId}`;

        const storytellerNameSafe = escapeHtml(storytellerName);

        for (const email of recipients) {
          try {
            await transporter.sendMail({
              from: `"LegacyBot" <${smtpUser.value()}>`,
              to: email,
              subject: `${storytellerName} completed a recording session`,
              html: `
                <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px;">
                  <h1 style="font-size: 24px; color: #1e293b;">Session Complete</h1>
                  <p style="color: #64748b; line-height: 1.6;">
                    <strong>${storytellerNameSafe}</strong> just completed a
                    ${durationMins}-minute recording session on LegacyBot.
                  </p>
                  <a href="${sessionUrl}"
                     style="display: inline-block; margin-top: 16px; padding: 14px 28px;
                            background: #4f46e5; color: white; text-decoration: none;
                            border-radius: 12px; font-weight: bold; font-size: 16px;">
                    View Transcript
                  </a>
                  <p style="margin-top: 24px; font-size: 12px; color: #94a3b8;">
                    You're receiving this because you opted in to session notifications.
                  </p>
                </div>
              `,
            });
            logger.info(`Session notification sent to ${maskEmail(email)}`);
          } catch (err) {
            logger.error(`Failed to send notification to ${maskEmail(email)}:`, err);
          }
        }
      })(),

      // Gap analysis
      (async () => {
        const apiKey = geminiApiKey.value();
        if (!apiKey) {
          logger.warn('GEMINI_API_KEY not set — skipping gap analysis');
          return;
        }
        try {
          logger.info(`[GapAnalysis] Starting for dossier ${dossierId} after session ${sessionId}`);
          const result = await runGapAnalysis(
            familyId, dossierId, sessionId,
            {
              storytellerName: dossierData.storytellerName ?? '',
              preferredName: dossierData.preferredName,
              storytellerContext: dossierData.storytellerContext,
              historicalContext: dossierData.historicalContext,
            },
            apiKey,
          );
          await saveGapAnalysis(familyId, dossierId, result);
          logger.info(
            `[GapAnalysis] Complete: ${result.questions.length} suggestions, ` +
            `${result.gaps.timeline.length} timeline gaps, ` +
            `${result.gaps.themes.length} theme gaps`,
          );
        } catch (err) {
          logger.error('[GapAnalysis] Failed:', err);
        }

        // Embed session transcript for semantic search (#108)
        try {
          const transcriptSnap = await db
            .collection('families').doc(familyId)
            .collection('dossiers').doc(dossierId)
            .collection('sessions').doc(sessionId)
            .collection('transcript')
            .orderBy('timestamp', 'asc')
            .get();

          const turns = transcriptSnap.docs.map((d) => ({
            role: d.data().role as string,
            text: d.data().text as string,
          }));

          const chunks = chunkTranscript(turns);
          if (chunks.length > 0) {
            await deleteChunksForSource(familyId, dossierId, 'transcript', sessionId);
            await writeChunks(familyId, dossierId, sessionId, 'transcript', sessionId, chunks, apiKey);
            logger.info(`[Embeddings] Embedded ${chunks.length} transcript chunks for session ${sessionId}`);
          }
        } catch (err) {
          logger.error('[Embeddings] Transcript embedding failed:', err);
        }
      })(),
    ]);
  },
);

// ---------------------------------------------------------------------------
// Digest email helpers
// ---------------------------------------------------------------------------

function getLocalHour(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    return parseInt(formatter.format(new Date()), 10);
  } catch {
    return -1;
  }
}

interface DigestOptions {
  force?: boolean;
}

async function sendDigestForDossier(
  familyId: string,
  dossierId: string,
  transporter: nodemailer.Transporter,
  options: DigestOptions = {},
): Promise<boolean> {
  const { force = false } = options;
  const now = Date.now();
  const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

  const dossierDoc = await db
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .get();

  if (!dossierDoc.exists) return false;
  const dossierData = dossierDoc.data()!;

  const storytellerUid: string | null = dossierData.storytellerUid ?? null;
  const preferredName: string = dossierData.preferredName ?? dossierData.storytellerName ?? 'there';

  if (!storytellerUid) return false;

  if (!force) {
    const lastDigestMs: number = dossierData.lastDigestSentAt?.toMillis?.() ?? 0;
    if (now - lastDigestMs < TWO_DAYS_MS) return false;
  }

  const recentSessionSnap = await db
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .collection('sessions')
    .where('status', '==', 'completed')
    .orderBy('startTime', 'desc')
    .limit(1)
    .get();

  if (recentSessionSnap.empty) return false;

  const lastSessionMs: number =
    recentSessionSnap.docs[0].data().startTime?.toMillis?.() ?? 0;
  const daysSince = (now - lastSessionMs) / (24 * 60 * 60 * 1000);

  if (!force) {
    if (daysSince < 2 || daysSince > 7) return false;

    let storytellerTimezone: string | undefined;
    try {
      const userDoc = await db.collection('users').doc(storytellerUid).get();
      storytellerTimezone = userDoc.data()?.timezone;
    } catch {
      // user doc not found
    }
    if (!storytellerTimezone) storytellerTimezone = 'America/Los_Angeles';
    const localHour = getLocalHour(storytellerTimezone);
    if (localHour !== 7) return false;
  }

  let storytellerEmail: string | undefined;
  try {
    const userRecord = await admin.auth().getUser(storytellerUid);
    storytellerEmail = userRecord.email;
  } catch {
    // user deleted or no email
  }
  if (!storytellerEmail) return false;

  const questionsSnap = await db
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .collection('questions')
    .where('status', '==', 'Unasked')
    .orderBy('order', 'asc')
    .limit(4)
    .get();

  const allTopics: string[] = questionsSnap.docs.map((d) => d.data().text as string);
  if (allTopics.length === 0) return false;

  const daysText =
    daysSince < 3 ? 'a couple of days' :
    daysSince < 5 ? 'a few days' :
    'about a week';

  const gapAnalysis = await getGapAnalysis(familyId, dossierId);
  const introText = gapAnalysis?.narrativeSummary
    ?? `It's been ${daysText} since we last spoke, and I've been looking forward to our next conversation.`;

  const topicListHtml = allTopics
    .map((t) => `<li style="margin-bottom: 8px; color: #475569; line-height: 1.5;">${escapeHtml(t)}</li>`)
    .join('');

  const sessionUrl = `${appUrl.value()}/family/${familyId}`;
  const preferredNameSafe = escapeHtml(preferredName);
  const introTextSafe = escapeHtml(introText);

  await transporter.sendMail({
    from: `"LegacyBot" <${smtpUser.value()}>`,
    to: storytellerEmail,
    subject: `I've been thinking about what to ask you next, ${preferredName}`,
    html: `
      <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px;">
        <h1 style="font-size: 22px; color: #1e293b; margin-bottom: 8px;">
          Ready when you are, ${preferredNameSafe}
        </h1>
        <p style="color: #64748b; line-height: 1.6;">${introTextSafe} Here are a few things I'd love to explore with you:</p>
        <ul style="padding-left: 20px; margin: 16px 0;">
          ${topicListHtml}
        </ul>
        <a href="${sessionUrl}"
           style="display: inline-block; margin-top: 20px; padding: 14px 28px;
                  background: #4f46e5; color: white; text-decoration: none;
                  border-radius: 12px; font-weight: bold; font-size: 16px;">
          Continue My Story
        </a>
        <p style="margin-top: 28px; font-size: 12px; color: #94a3b8; line-height: 1.5;">
          You're receiving this because you have an active story archive on LegacyBot.
          There's no obligation to record — whenever you're ready, I'll be here.
        </p>
      </div>
    `,
  });

  await db
    .collection('families').doc(familyId)
    .collection('dossiers').doc(dossierId)
    .update({ lastDigestSentAt: admin.firestore.Timestamp.now() });

  logger.info(
    `[Digest] Sent to ${maskEmail(storytellerEmail)} for dossier ${dossierId}` +
    ` (${allTopics.length} topics, ${daysText} since last session, force=${force})`,
  );
  return true;
}

// ---------------------------------------------------------------------------
// Hourly digest sweep
// ---------------------------------------------------------------------------

export const sendDailyDigest = onSchedule(
  { schedule: '0 * * * *', timeZone: 'UTC', secrets: [smtpPass], timeoutSeconds: 540, maxInstances: 2 },
  async (_event) => {
    const transporter = createTransporter();
    if (!transporter) {
      logger.warn('[Digest] SMTP not configured — skipping digest run');
      return;
    }

    const familiesSnap = await db.collection('families').get();
    let sent = 0;

    for (const familyDoc of familiesSnap.docs) {
      const familyId = familyDoc.id;
      const dossiersSnap = await db
        .collection('families').doc(familyId)
        .collection('dossiers')
        .get();

      for (const dossierDoc of dossiersSnap.docs) {
        try {
          const didSend = await sendDigestForDossier(familyId, dossierDoc.id, transporter);
          if (didSend) sent++;
        } catch (err) {
          logger.error(`[Digest] Error for dossier ${dossierDoc.id}:`, err);
        }
      }
    }

    logger.info(`[Digest] Run complete — ${sent} email(s) sent`);
  },
);

// ---------------------------------------------------------------------------
// Manual digest trigger
// ---------------------------------------------------------------------------

export const triggerDigestForDossier = onCall(
  { secrets: [smtpPass, geminiApiKey], timeoutSeconds: 300 },
  async (request: CallableRequest) => {
    const { familyId, dossierId } = request.data as { familyId: string; dossierId: string };
    if (!familyId || !dossierId) {
      throw new HttpsError('invalid-argument', 'familyId and dossierId are required.');
    }

    await verifyFamilyAdmin(request, familyId);
    await enforceRateLimit(request.auth!.uid, 'triggerDigestForDossier');

    const transporter = createTransporter();
    if (!transporter) {
      throw new HttpsError('internal', 'SMTP is not configured on this server.');
    }

    const existingGap = await getGapAnalysis(familyId, dossierId);
    if (!existingGap) {
      const apiKey = geminiApiKey.value();
      if (apiKey) {
        try {
          logger.info(`[triggerDigest] No gap analysis found — running now for dossier ${dossierId}`);
          const dossierDoc = await db
            .collection('families').doc(familyId)
            .collection('dossiers').doc(dossierId)
            .get();
          const dossierData = dossierDoc.data() ?? {};
          const result = await runGapAnalysis(
            familyId, dossierId, 'manual-trigger',
            {
              storytellerName: dossierData.storytellerName ?? '',
              preferredName: dossierData.preferredName,
              storytellerContext: dossierData.storytellerContext,
              historicalContext: dossierData.historicalContext,
            },
            apiKey,
          );
          await saveGapAnalysis(familyId, dossierId, result);
          logger.info(`[triggerDigest] Gap analysis complete: ${result.questions.length} questions generated`);
        } catch (err) {
          logger.warn('[triggerDigest] Gap analysis failed — will send without topics:', err);
        }
      }
    }

    const sent = await sendDigestForDossier(familyId, dossierId, transporter, { force: true });
    if (!sent) {
      throw new HttpsError(
        'failed-precondition',
        'Could not send digest — storyteller may have no linked email or no upcoming topics.',
      );
    }
    return { sent: true };
  },
);

// ---------------------------------------------------------------------------
// Memoir generation
// ---------------------------------------------------------------------------

/**
 * Callable: generate a memoir from all interview transcripts and events.
 * Requires admin role. Creates a placeholder doc, runs the two-pass Gemini
 * pipeline server-side, then updates to 'draft' on completion.
 */
export const generateMemoir = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, maxInstances: 3 },
  async (request: CallableRequest) => {
    const { familyId, dossierId } = request.data as { familyId: string; dossierId: string };
    if (!familyId || !dossierId) {
      throw new HttpsError('invalid-argument', 'familyId and dossierId are required.');
    }

    await verifyFamilyAdmin(request, familyId);
    await enforceRateLimit(request.auth!.uid, 'generateMemoir');

    const apiKey = geminiApiKey.value();
    if (!apiKey) {
      throw new HttpsError('internal', 'GEMINI_API_KEY is not configured on this server.');
    }

    const now = admin.firestore.Timestamp.now();
    const memoirRef = await db
      .collection('families').doc(familyId)
      .collection('dossiers').doc(dossierId)
      .collection('memoirs')
      .add({
        title: 'Generating memoir...',
        status: 'generating',
        generatedBy: request.auth!.uid,
        chapters: [],
        createdAt: now,
        updatedAt: now,
      });

    try {
      await generateMemoirContent(familyId, dossierId, memoirRef.id, apiKey);
      logger.info(`[Memoir] Generated for dossier ${dossierId}, doc ${memoirRef.id}`);
    } catch (err) {
      await memoirRef.update({
        status: 'error' as any,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      logger.error(`[Memoir] Generation failed for dossier ${dossierId}:`, err);
      throw new HttpsError('internal', 'Memoir generation failed. Please try again.');
    }

    return { memoirId: memoirRef.id };
  },
);

// ---------------------------------------------------------------------------
// Embedding triggers (#108)
//
// These functions keep the contextChunks vector index up to date as new
// content is created or modified.  All use GEMINI_API_KEY (same secret used
// by other Cloud Functions).
// ---------------------------------------------------------------------------

/**
 * Re-embed biography, historicalContext, and adminNotes whenever the dossier
 * document changes.  Only re-embeds the fields that actually changed.
 */
export const onDossierUpdatedEmbed = onDocumentUpdated(
  { document: 'families/{familyId}/dossiers/{dossierId}', secrets: [geminiApiKey] },
  async (event) => {
    const before = event.data?.before.data() ?? {};
    const after = event.data?.after.data() ?? {};
    const { familyId, dossierId } = event.params;

    const apiKey = geminiApiKey.value();
    if (!apiKey) return;

    const fieldsToEmbed: Array<{ field: string; source: 'biography' | 'historicalContext' | 'adminNotes' }> = [
      { field: 'storytellerContext', source: 'biography' },
      { field: 'historicalContext', source: 'historicalContext' },
      { field: 'adminNotes', source: 'adminNotes' },
    ];

    for (const { field, source } of fieldsToEmbed) {
      if (before[field] === after[field]) continue;
      const text: string = after[field] ?? '';
      try {
        await deleteChunksForSource(familyId, dossierId, source, dossierId);
        const chunks = chunkProse(text);
        if (chunks.length > 0) {
          await writeChunks(familyId, dossierId, null, source, dossierId, chunks, apiKey);
          logger.info(`[Embeddings] Re-embedded ${source} (${chunks.length} chunks) for dossier ${dossierId}`);
        }
      } catch (err) {
        logger.error(`[Embeddings] Failed to embed ${source} for dossier ${dossierId}:`, err);
      }
    }
  },
);

/**
 * Upsert a contextChunk whenever a family-level event is created or updated.
 */
export const onEventWrittenEmbed = onDocumentWritten(
  { document: 'families/{familyId}/events/{eventId}', secrets: [geminiApiKey] },
  async (event) => {
    const { familyId, eventId } = event.params;
    const apiKey = geminiApiKey.value();
    if (!apiKey) return;

    const after = event.data?.after;
    if (!after?.exists) {
      // Deletion — remove any existing chunk
      await deleteChunksForSource(familyId, null, 'event', eventId);
      return;
    }

    const data = after.data() ?? {};
    const title: string = data.title ?? '';
    const summary: string = data.summary ?? data.description ?? '';
    const text = summary ? `${title}: ${summary}` : title;

    try {
      await deleteChunksForSource(familyId, null, 'event', eventId);
      if (text.length >= 20) {
        await writeChunks(familyId, null, null, 'event', eventId, [text], apiKey);
        logger.info(`[Embeddings] Embedded event ${eventId} for family ${familyId}`);
      }
    } catch (err) {
      logger.error(`[Embeddings] Failed to embed event ${eventId}:`, err);
    }
  },
);

/**
 * Embed a misc fact when it is first created in a talk session.
 */
export const onMiscFactCreatedEmbed = onDocumentCreated(
  { document: 'families/{familyId}/dossiers/{dossierId}/miscFacts/{factId}', secrets: [geminiApiKey] },
  async (event) => {
    const { familyId, dossierId, factId } = event.params;
    const apiKey = geminiApiKey.value();
    if (!apiKey) return;

    const text: string = event.data?.data()?.text ?? '';
    if (text.length < 20) return;

    try {
      await writeChunks(familyId, dossierId, null, 'miscFact', factId, [text], apiKey);
      logger.info(`[Embeddings] Embedded miscFact ${factId} for dossier ${dossierId}`);
    } catch (err) {
      logger.error(`[Embeddings] Failed to embed miscFact ${factId}:`, err);
    }
  },
);

/**
 * Re-embed a question when its findings field changes.
 */
export const onQuestionUpdatedEmbed = onDocumentUpdated(
  { document: 'families/{familyId}/dossiers/{dossierId}/questions/{questionId}', secrets: [geminiApiKey] },
  async (event) => {
    const before = event.data?.before.data() ?? {};
    const after = event.data?.after.data() ?? {};
    if (before.findings === after.findings && before.text === after.text) return;

    const { familyId, dossierId, questionId } = event.params;
    const apiKey = geminiApiKey.value();
    if (!apiKey) return;

    const questionText: string = after.text ?? '';
    const findings: string = after.findings ?? '';
    const text = findings ? `${questionText} — ${findings}` : questionText;

    try {
      await deleteChunksForSource(familyId, dossierId, 'question', questionId);
      if (text.length >= 20) {
        await writeChunks(familyId, dossierId, null, 'question', questionId, [text], apiKey);
        logger.info(`[Embeddings] Re-embedded question ${questionId} for dossier ${dossierId}`);
      }
    } catch (err) {
      logger.error(`[Embeddings] Failed to embed question ${questionId}:`, err);
    }
  },
);

// ---------------------------------------------------------------------------
// Backfill (#108 Phase 2)
//
// One-shot callable that processes all existing family data and generates
// context chunks.  Run once per family via the Firebase console after the
// embedding triggers are deployed.
// ---------------------------------------------------------------------------

export const backfillContextChunks = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 540, maxInstances: 1 },
  async (request: CallableRequest) => {
    const { familyId } = request.data as { familyId: string };
    if (!familyId) throw new HttpsError('invalid-argument', 'familyId is required.');

    await verifyFamilyAdmin(request, familyId);
    await enforceRateLimit(request.auth!.uid, 'backfillContextChunks');

    const apiKey = geminiApiKey.value();
    if (!apiKey) throw new HttpsError('internal', 'GEMINI_API_KEY not configured.');

    let chunksWritten = 0;

    const dossiersSnap = await db.collection('families').doc(familyId).collection('dossiers').get();

    for (const dossierDoc of dossiersSnap.docs) {
      const dossierId = dossierDoc.id;
      const data = dossierDoc.data();

      // Prose fields
      for (const [field, source] of [
        ['storytellerContext', 'biography'],
        ['historicalContext', 'historicalContext'],
        ['adminNotes', 'adminNotes'],
      ] as const) {
        const text: string = data[field] ?? '';
        const chunks = chunkProse(text);
        if (chunks.length > 0) {
          await deleteChunksForSource(familyId, dossierId, source, dossierId);
          await writeChunks(familyId, dossierId, null, source, dossierId, chunks, apiKey);
          chunksWritten += chunks.length;
        }
      }

      // Completed transcripts
      const sessionsSnap = await db
        .collection('families').doc(familyId)
        .collection('dossiers').doc(dossierId)
        .collection('sessions')
        .where('status', '==', 'completed')
        .get();

      for (const sessionDoc of sessionsSnap.docs) {
        const sessionId = sessionDoc.id;
        const transcriptSnap = await db
          .collection('families').doc(familyId)
          .collection('dossiers').doc(dossierId)
          .collection('sessions').doc(sessionId)
          .collection('transcript')
          .orderBy('timestamp', 'asc')
          .get();

        const turns = transcriptSnap.docs.map((d) => ({
          role: d.data().role as string,
          text: d.data().text as string,
        }));
        const chunks = chunkTranscript(turns);
        if (chunks.length > 0) {
          await deleteChunksForSource(familyId, dossierId, 'transcript', sessionId);
          await writeChunks(familyId, dossierId, sessionId, 'transcript', sessionId, chunks, apiKey);
          chunksWritten += chunks.length;
        }
      }

      // MiscFacts
      const miscFactsSnap = await db
        .collection('families').doc(familyId)
        .collection('dossiers').doc(dossierId)
        .collection('miscFacts')
        .get();

      for (const factDoc of miscFactsSnap.docs) {
        const text: string = factDoc.data().text ?? '';
        if (text.length >= 20) {
          await deleteChunksForSource(familyId, dossierId, 'miscFact', factDoc.id);
          await writeChunks(familyId, dossierId, null, 'miscFact', factDoc.id, [text], apiKey);
          chunksWritten++;
        }
      }

      // Questions
      const questionsSnap = await db
        .collection('families').doc(familyId)
        .collection('dossiers').doc(dossierId)
        .collection('questions')
        .get();

      for (const qDoc of questionsSnap.docs) {
        const qData = qDoc.data();
        const qText: string = qData.text ?? '';
        const findings: string = qData.findings ?? '';
        const text = findings ? `${qText} — ${findings}` : qText;
        if (text.length >= 20) {
          await deleteChunksForSource(familyId, dossierId, 'question', qDoc.id);
          await writeChunks(familyId, dossierId, null, 'question', qDoc.id, [text], apiKey);
          chunksWritten++;
        }
      }
    }

    // Family-level events
    const eventsSnap = await db.collection('families').doc(familyId).collection('events').get();
    for (const eventDoc of eventsSnap.docs) {
      const eData = eventDoc.data();
      const title: string = eData.title ?? '';
      const summary: string = eData.summary ?? eData.description ?? '';
      const text = summary ? `${title}: ${summary}` : title;
      if (text.length >= 20) {
        await deleteChunksForSource(familyId, null, 'event', eventDoc.id);
        await writeChunks(familyId, null, null, 'event', eventDoc.id, [text], apiKey);
        chunksWritten++;
      }
    }

    logger.info(`[Backfill] Wrote ${chunksWritten} context chunks for family ${familyId}`);
    return { chunksWritten };
  },
);

// ---------------------------------------------------------------------------
// searchContext callable (#108 Phase 3)
//
// Semantic + keyword hybrid search over a family's contextChunks collection.
// Uses Firestore findNearest() for vector search and range queries for keyword
// matching; results are merged with Reciprocal Rank Fusion (RRF, k=60).
// ---------------------------------------------------------------------------

async function verifyFamilyMember(
  request: CallableRequest,
  familyId: string,
): Promise<{ roles: string[] }> {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Must be signed in.');
  const memberDoc = await db
    .collection('families').doc(familyId)
    .collection('members').doc(request.auth.uid)
    .get();
  if (!memberDoc.exists) throw new HttpsError('permission-denied', 'Not a family member.');
  return { roles: (memberDoc.data()?.roles ?? []) as string[] };
}

export const cacheWikipediaArticle = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 60 },
  buildCacheWikipediaArticleHandler({
    apiKey: () => geminiApiKey.value(),
    enforceRateLimit: (uid) => enforceRateLimit(uid, 'cacheWikipediaArticle'),
  }),
);

export const mintGeminiLiveToken = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 30 },
  buildMintGeminiLiveTokenHandler({ apiKey: () => geminiApiKey.value() }),
);

export const invokeGemini = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 120 },
  buildInvokeGeminiHandler({ apiKey: () => geminiApiKey.value() }),
);

export const embedGemini = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 60 },
  buildEmbedGeminiHandler({ apiKey: () => geminiApiKey.value() }),
);

/**
 * getMediaUrl — mint a short-lived (2h) signed read URL for a Storage object,
 * for a caller who is a member of the family that owns it.
 *
 * Replaces persisted getDownloadURL() tokens, which were permanent bearer
 * capabilities that bypassed Storage rules forever. Now clients store only the
 * object PATH and fetch a fresh, expiring URL on demand; access is re-checked
 * against live family membership on every mint.
 */
export const getMediaUrl = onCall(
  { timeoutSeconds: 30 },
  async (request: CallableRequest): Promise<{ url: string }> => {
    const { path } = (request.data ?? {}) as { path?: string };
    const familyId = parseMediaPathFamilyId(path);
    const objectPath = path as string;

    // Membership is the family boundary — a member may access any object under
    // their family's prefix (within-family access is intentionally open).
    await verifyFamilyMember(request, familyId);
    await enforceRateLimit(request.auth!.uid, 'getMediaUrl');

    try {
      const [url] = await admin.storage().bucket().file(objectPath).getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 2 * 60 * 60 * 1000, // 2 hours
      });
      return { url };
    } catch (err) {
      logger.error('[getMediaUrl] failed to sign URL', err);
      throw new HttpsError('internal', 'Could not generate a media URL.');
    }
  },
);

export const searchContext = onCall(
  { secrets: [geminiApiKey], timeoutSeconds: 60 },
  async (request: CallableRequest) => {
    const { familyId, query, topK = 4 } = request.data as {
      familyId: string;
      query: string;
      topK?: number;
    };

    if (!familyId || !query) {
      throw new HttpsError('invalid-argument', 'familyId and query are required.');
    }
    if (typeof query !== 'string' || query.length > 1000) {
      throw new HttpsError('invalid-argument', 'query is too long.');
    }
    if (typeof topK !== 'number' || topK < 1 || topK > 20) {
      throw new HttpsError('invalid-argument', 'topK must be between 1 and 20.');
    }

    const { roles } = await verifyFamilyMember(request, familyId);
    const callerIsAdmin = roles.includes('admin');
    await enforceRateLimit(request.auth!.uid, 'searchContext');

    const apiKey = geminiApiKey.value();
    if (!apiKey) throw new HttpsError('internal', 'GEMINI_API_KEY not configured.');

    const chunksRef = db.collection('families').doc(familyId).collection('contextChunks');
    const fetchCount = Math.max(topK * 3, 12);

    // 1. Embed the query
    let queryVector: number[];
    try {
      [queryVector] = await embedTexts([query], 'RETRIEVAL_QUERY', apiKey);
    } catch (err) {
      logger.error('[searchContext] Embedding failed:', err);
      throw new HttpsError('internal', 'Failed to embed query.');
    }

    // 2. Vector search
    let vectorHits: admin.firestore.QueryDocumentSnapshot[] = [];
    try {
      const vectorSnap = await chunksRef.findNearest({
        vectorField: 'embedding',
        queryVector: admin.firestore.FieldValue.vector(queryVector),
        limit: fetchCount,
        distanceMeasure: 'COSINE',
      }).get();
      vectorHits = vectorSnap.docs ?? [];
    } catch (err: any) {
      if (err?.code === 9 || String(err).includes('FAILED_PRECONDITION')) {
        logger.warn('[searchContext] Vector index not ready — returning empty results');
        return { results: [] };
      }
      logger.error('[searchContext] findNearest error:', err);
      throw err;
    }

    // Build a map of docId → vector rank
    const vectorRankMap = new Map<string, number>();
    vectorHits.forEach((doc, idx) => vectorRankMap.set(doc.id, idx + 1));

    // 3. Keyword search — one range query per meaningful word
    const stopwords = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'have', 'was', 'are']);
    const keywords = query
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !stopwords.has(w));

    const keywordRankMap = new Map<string, number>();
    let keywordRank = 1;

    for (const word of keywords.slice(0, 5)) { // cap at 5 keyword queries
      try {
        const kwSnap = await chunksRef
          .where('text', '>=', word)
          .where('text', '<=', word + '\uf8ff')
          .limit(20)
          .get();
        for (const doc of kwSnap.docs) {
          if (!keywordRankMap.has(doc.id)) {
            keywordRankMap.set(doc.id, keywordRank++);
          }
        }
      } catch {
        // keyword query failed — skip this word
      }
    }

    // 4. RRF merge (k=60)
    const K = 60;
    const allDocIds = new Set([...vectorRankMap.keys(), ...keywordRankMap.keys()]);

    // Gather all docs we need to return text for (vector hits already loaded)
    const docCache = new Map<string, admin.firestore.DocumentData>();
    vectorHits.forEach((doc) => docCache.set(doc.id, doc.data()));

    // Fetch keyword-only hits we don't have yet
    const missingIds = [...keywordRankMap.keys()].filter((id) => !docCache.has(id));
    if (missingIds.length > 0) {
      const fetched = await Promise.all(missingIds.map((id) => chunksRef.doc(id).get()));
      fetched.forEach((doc) => { if (doc.exists) docCache.set(doc.id, doc.data()!); });
    }

    const scored = [...allDocIds]
      // adminNotes are the admin's private notes, not shared family history —
      // exclude them for non-admin callers (e.g. storytellers). Filtering here,
      // before the topK slice, means a storyteller still gets a full topK of
      // allowed chunks rather than a short list with admin content removed.
      .filter((id) => callerIsAdmin || docCache.get(id)?.source !== 'adminNotes')
      .map((id) => {
        const vRank = vectorRankMap.get(id) ?? (fetchCount + 1);
        const kRank = keywordRankMap.get(id) ?? (keywordRank + 1);
        const score = 1 / (K + vRank) + 1 / (K + kRank);
        return { id, score };
      });

    scored.sort((a, b) => b.score - a.score);
    const topDocs = scored.slice(0, topK);
    logger.info(`[searchContext] query="${query}" vectorHits=${vectorHits.length} keywordHits=${keywordRankMap.size} returning=${topDocs.length}`);

    // 5. Format results
    const results = topDocs
      .map(({ id }) => {
        const data = docCache.get(id);
        if (!data) return null;
        return {
          text: data.text as string,
          source: data.source as string,
          dossierId: (data.dossierId ?? null) as string | null,
          sessionId: (data.sessionId ?? null) as string | null,
        };
      })
      .filter(Boolean);

    return { results };
  },
);
