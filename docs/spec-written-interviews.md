# Spec: written interviews (chat in the app, or by email)

Status: **chat is built and live (2026-11-19); email is deferred.** Tracks issue #210.

## What exists as of 2026-11-19

Owner, 2026-11-19: "Let's implement both email and chat interview mechanisms if they're both easy. If
either requires me to take manual steps then that can be deferred."

**Chat is shipped.** A storyteller presses "I'd rather write" on their home screen (or opens the session
page with `?mode=chat`) and has the same interview in writing.

**It was built more simply than this spec proposed, and the difference matters for email.** The spec
below puts the interviewer on the server ("The shared engine"). Chat did not need that: the voice session
hook's contract with its transport is seven fields, so chat is a second transport behind the same hook
(`src/hooks/useTextSession.ts`, with the pure turn loop in `src/services/textInterview.ts`). The
interviewer's instruction, its tools and their handlers, and the post-session analysis are the existing
ones, untouched; only a short "this conversation is typed" section is appended to the instruction. The
model is reached through the existing broker, which now accepts function declarations and rebuilds them
rather than forwarding the caller's array.

What that bought: chat in a day, with nothing about the interviewer duplicated. What it did not buy:
the interviewer still lives in the browser, and email has no browser. **Email still needs the server-side
engine described below**, and the instruction builder and tool handlers moved to where a function can run
them. That is the larger half of the email work and it is not started.

Differences from the chat section below, as built:

- Leaving the screen ends the session, as it does for voice. "Continue later" and saved drafts are not built.
- A message that cannot be answered goes back into the box with a plain notice; nothing is lost or sent twice.
- Lookup tools (encyclopedia, maps, weather) work in chat exactly as in voice, since the handlers are shared.
- Session records carry `mode: 'chat'` and typed turns carry `source: 'typed'`. History shows "written".
  There is no recording, and the server skips audio refinement for a session without one.

Tested: 20 unit tests on the turn loop and the transport, 8 on the screen, and a live suite
(`src/__tests__/live/chatInterview.live.test.ts`) that holds a real written interview with the fictional
Teo Furtado, using the production instruction and tools and the Cloud Functions copy of the SDK: the
interviewer opens in writing, takes his preferred name through a tool call, keeps going across turns with
tool calls in the history, drops a declined topic, and ends when he says he is tired.

**Not yet exercised:** the callable itself with a signed-in family member typing in a browser. The first
real session is that test.

**Email is deferred** because it needs things only the owner can do: a mailbox on the domain, DNS records
for signing mail, and a decision about storytellers who never sign in. Those are explained in plain terms
in the session notes of 2026-11-19 and in "Decisions for the owner" below.

Owner, in #210: "extend biographybot with written interactive interview style (chat in app or via email)
for people who don't like spoken dialog." And on 2026-11-15: "doing email-based or text chat based
interviews with family members who aren't comfortable talking to a voice AI. I'd like to spec that out
soon and get it up and running and tested with some family members ASAP."

## Summary

Some relatives will never talk to a voice AI and will happily answer a thoughtful question in writing.
This adds two written ways to be interviewed, on one shared engine:

- **Chat**: a typed conversation in the app, one question at a time.
- **Email**: one question per email. The storyteller replies whenever they like, from any mail program,
  with no app and no password. The reply becomes the next turn.

Written answers land in the same place spoken ones do (story queue, events, memoir, family view), marked
as written. Everything downstream already works on transcripts and does not care how the words arrived.

**Recommendation: build chat first, then email on the same engine.** Chat needs no new infrastructure
and can be in a relative's hands within days. Email is what the relatives who dislike apps actually
need, but it depends on three things only the owner can set up (a mailbox, DNS records, a decision about
account-less storytellers), so it should start in parallel and land second.

## Who it is for

| Person | Today | With this |
|---|---|---|
| Comfortable talking, has the app | Voice session | Unchanged |
| Dislikes talking to a machine, fine with the app | Nothing | Chat |
| Will not install or sign in to anything, reads email daily | Nothing | Email |
| Hard of hearing, or speech the recogniser handles badly | A frustrating voice session | Either |
| Wants time to think before answering | Feels rushed | Email |

## What stays the same

- One dossier per storyteller, one story queue, one interviewer personality and set of notes.
- The interviewer's rules: one question at a time, follow the storyteller's lead, never press on a
  declined topic, never invent.
- Transcript, events, engagement, gap analysis, memoir, citations, family view, export, deletion.
- A storyteller can use all three modes. The interviewer knows what was said in any of them.

## The shared engine

Today the interviewer lives in the browser: the client builds the system instruction and holds a live
audio connection. Email has no browser, so written interviews need the interviewer on the server. Build
that once and let chat use it too.

**`interviewTurn`** (server): given a dossier, a session and the storyteller's new text, it

1. loads the dossier, the story queue, the profile summary and this session's turns so far;
2. builds the interviewer instruction;
3. calls the model with the conversation and the interviewer's tools;
4. runs any tool calls on the server (record a fact, update a question, look something up, note an
   emotional observation) and feeds results back, to a fixed small limit of rounds;
5. appends the storyteller's turn, the tool entries and the interviewer's reply to the transcript;
6. returns the reply text.

Design points:

- **One prompt, not two.** The instruction builder moves out of `src/services/gemini.ts` into a small
  shared module compiled into both the app and the functions, with a `mode` argument (`voice`, `chat`,
  `email`). A second hand-kept copy of the interviewer's rules would drift, and the rules are the
  product. The written modes add a short section: you are writing, not speaking; ask one question; keep
  it under about 120 words; in email, quote one thing they said last time so they know they were read.
- **Model.** `REASONING_MODEL` (`gemini-3.8-flash` today), with function calling. No live audio model is
  involved. Verify the id against the provider's pages when building; that is the standing rule.
- **Tools run on the server with the server's checks.** The client never names a tool or passes tool
  configuration. This matters because the model broker deliberately refuses client-supplied tools.
- **Output limits are explicit.** Set a generous output ceiling and check the finish reason: a reply cut
  off mid-sentence must be retried, not sent.
- **Idempotent.** A turn carries a client- or message-derived id. The same id twice produces one turn.
  Email delivers duplicates and people double-click Send.

## Data model changes

Small, and additive. Existing voice sessions need no migration.

| Where | Change |
|---|---|
| `SessionMetadata` | `mode: 'voice' \| 'chat' \| 'email'` (absent means voice). `audioUrl` is empty for written sessions. |
| `TranscriptEntry` | `source?: 'spoken' \| 'typed' \| 'email'` (absent means spoken). For email, `emailMessageId` for de-duplication and audit. |
| `Dossier` | `writtenInterview?: { enabled, channel: 'chat' \| 'email', email?, cadence, quietHours, pausedUntil?, consentAt? }` |
| New: `…/dossiers/{id}/emailThreads/{threadId}` | Server-only. Outbound message ids, state (`awaiting-reply`, `closed`, `paused`), counters, last activity. No message bodies: those live in the transcript. |
| New: `…/dossiers/{id}/quarantine/{id}` | Server-only. Inbound mail that failed a check, held for the admin to approve or discard. |

Rules: the two new collections are readable by family admins and writable by nobody but the server.
Written sessions follow the existing session rules unchanged.

**When is a written session "complete"?** The post-session pipeline (events, engagement, story-queue
updates, family notification) runs when a session completes. For chat: when the storyteller ends it, or
after 30 minutes idle. For email: a thread is one session; it completes after the interviewer wraps up
a topic, or 48 hours after the last reply. Transcript refinement is skipped: there is no audio and the
storyteller's own spelling is the truth.

## Chat

A session screen without the microphone: the transcript feed that exists today, a text box, Send, and
End. The interviewer's reply appears as it does now.

- Enter sends; Shift+Enter makes a new line. Large type and high contrast by default, since the people
  this is for are often older.
- A typing indicator while the server works. If a reply takes more than ten seconds, say so plainly.
- Drafts survive a refresh (kept on the device only, cleared on send).
- "Continue later" is the normal way to leave. Coming back shows the conversation and the interviewer
  picks up from it.
- A storyteller chooses voice or writing each time from their dashboard; the dossier remembers the last
  choice. An admin can set the default.
- No recording, so no recording indicator. The screen says "Your words are saved as you send them."

Chat needs an account, as voice does. It reuses sign-in, roles and rules as they are.

## Email

### The experience

1. **Invitation.** The admin turns on email interviews for a dossier and confirms the address. The
   storyteller gets one message, from a person they know by name: who asked for this, that the
   questions are written by an AI interviewer working for the family, what happens to their answers and
   who can read them, and that replying **YES** starts it and **STOP** ends it at any time.
2. **Consent.** Nothing further is sent until they reply YES. That reply is recorded as the dossier's
   consent, in their own words, with the date. (No dossier has a consent record today; this flow
   creates one as a matter of course.)
3. **A question.** One email, one question, a few warm sentences. It quotes a line from their last
   answer when there is one.
4. **A reply.** They answer in their own time, at any length. Photos may be attached.
5. **A follow-up, or a rest.** The interviewer replies within a few minutes with one follow-up, at most
   two in a row; then it thanks them and waits until the next scheduled question. Nobody should feel
   they have opened a tap.
6. **Rhythm.** Default: a new question on Tuesday and Friday mornings in their time zone, never at
   night, never a second question while one is unanswered. One gentle reminder after five days, then
   silence until they write. The admin can change the rhythm; the storyteller can change it by asking
   ("could you write only on Sundays?"), which the interviewer records as a preference.
7. **Stopping.** STOP, "please stop", or the unsubscribe link ends it immediately and tells the admin.
   PAUSE holds it for a month.

### No account needed

The point of email is that the storyteller does nothing but read and reply. So an email storyteller is
identified by their verified address, not by a sign-in. The dossier's `storytellerUid` may be empty, as
it already may be. If they later want the app, the existing invitation links the same dossier.

This is the one real change to the product's model of who a storyteller is, and it is flagged as an
owner decision below.

### How a reply finds its conversation

Every outbound message gets a random, unguessable message id. Mail programs put that id in the reply's
`In-Reply-To` and `References` headers. The server looks the id up, finds the thread, and checks the
sender. A short reference code in the subject line is the fallback for mail programs that drop the
headers. No per-person reply address is needed, so nothing secret sits in an address book.

### Receiving mail

Two workable designs. Both end in the same `ingestEmail` function.

| | A. A mailbox on the domain, polled | B. An inbound-mail service that calls a webhook |
|---|---|---|
| How | A mailbox such as `stories@` at the domain's current mail host. A scheduled function reads new mail over IMAP every few minutes. | The domain's mail for a subdomain is routed to a service that parses each message and posts it to a function. |
| New vendor | None; the domain's mail is already hosted | Yes |
| Delay | Up to the polling interval | Seconds |
| Credentials | One mailbox password in the secret store. No token that silently expires. | A webhook signing secret |
| Risk | Polling code to maintain; mailbox quota | Another company holds every reply in transit; webhook must be authenticated |

**Recommendation: A for the pilot.** It adds no vendor to the list of companies that see a relative's
memories, it needs no new DNS for receiving, and a few minutes' delay is invisible in email. It also
avoids the failure the sibling car app has had since September, where a mail integration built on an
expiring authorisation token stopped working and stayed stopped. Revisit B if volume or delay ever
matters. Either way the provider's current documentation is checked when building, not assumed.

### Sending mail

Today mail goes out from a personal mailbox under the product's old name. Interview mail should come
from the domain, from the same address replies go to, signed so that it is delivered and cannot be
forged:

- sender `BiographyBot for the <Family> family <stories@…>`, with the admin's name in the first line;
- SPF tightened, DKIM signing on, and a DMARC record published (there is none today), starting in
  report-only mode and tightened once reports are clean;
- `List-Unsubscribe` headers, and a plain footer saying who asked for this and how to stop;
- plain text first, with a simple HTML alternative. No tracking pixels, no remote images, no link
  tracking. These are letters, not marketing.

### Turning a raw email into a turn

1. **Is it a person?** Drop automatic replies (out-of-office, delivery reports, mailing-list mail) by
   their headers, and never answer them. This is what prevents two machines writing to each other all
   night.
2. **Which thread?** By message id, else by subject code. Unknown: quarantine, no reply.
3. **Is it them?** The sender must be the address on the dossier, and the receiving server's
   authentication result must say the message really came from that address's domain. A mismatch is
   quarantined for the admin with a one-line reason, and nothing is sent back to the sender.
4. **What did they write?** Take the plain-text part, or convert HTML to text on the server. Strip the
   quoted earlier message and the signature. Keep the original, unstripped, in case the stripping was
   wrong; an admin can see both.
5. **Limits.** Reject over a size limit; cap turns per thread per day; cap total model spend per
   dossier per day.
6. **Attachments.** Images only, re-encoded on the server before storage, size-capped, saved to the
   dossier's media with the sentence that accompanied them as the caption. Everything else is dropped
   and the interviewer says so kindly.
7. **Commands.** STOP, PAUSE, YES and "change the day" are handled before the interviewer sees the text.
8. Then `interviewTurn`, and the reply goes out in the same thread.

## Safety and privacy

Inbound email is the first place the product accepts content from the open internet without a sign-in,
so this section is not optional reading.

| Risk | Control |
|---|---|
| Someone else writes "memories" into a relative's story | Unguessable thread id, plus sender address match, plus sender-domain authentication. Failures go to quarantine, never into the transcript. |
| A message tries to instruct the interviewer ("ignore your instructions and…") | The reply is data, framed as the storyteller's words. The interviewer has no tool that sends, shares or deletes. The hostile cases in `evals/family/adversarial.json` are run against this path. |
| The interviewer leaks one relative's words to another | The engine loads one dossier. It quotes only that storyteller's own earlier answers. Cross-dossier lookup is off in email mode. |
| Markup or scripts in a message | Mail is converted to text on the server and stored as text. It is never rendered as HTML anywhere. |
| Mail loops, floods, runaway cost | Automatic-reply detection, per-thread and per-day caps, a daily spend ceiling per dossier, and a single switch that stops all outbound interview mail. |
| Forged mail claiming to be the interviewer | DKIM and DMARC on the sending domain. The first message says the interviewer will never ask for money, passwords or identity numbers, and the interviewer's instructions forbid asking. |
| A distressing memory, answered alone at a keyboard | The existing emotional-observation tool. In writing the interviewer slows down, does not probe, and the admin is told the same day. Crisis language gets a human-written response template and an immediate note to the admin, not a model's improvisation. |
| Email is not private | Said plainly in the invitation: email passes through and rests at their mail provider. Questions never repeat anything another family member said, and never include sensitive details the storyteller did not themselves write in that thread. |
| Message bodies in logs | Logged: ids, sizes, outcomes. Never bodies, subjects or addresses. |
| A wrong address | The admin confirms the address; the invitation requires an explicit YES; a bounce pauses the thread and tells the admin. |

Deletion and export already cover transcripts and media, and written sessions are transcripts and
media. The two new collections are added to the purge and export lists.

## What the family sees

- Session history shows a small "written" or "by email" label, and the date range for an email thread.
- The transcript view is the same. Written turns are not marked as machine-transcribed and offer no
  "listen" control.
- The memoir cites written answers exactly as it cites spoken ones. A written answer is the
  storyteller's own sentence, so citations of it are, if anything, more exact.
- The admin's dossier page gains: the switch, the address, the rhythm, the thread's state ("waiting for
  Graciete since Tuesday"), and the quarantine list.
- The existing "session completed" notification is sent once per completed written session, not per
  email.

## Testing

The fictional Furtado family already supplies the material.

| Test | How |
|---|---|
| The engine behaves like the voice interviewer | Feed the storyteller turns of `teo-02` and `teo-03` to `interviewTurn` as typed text. The planted cases must come out the same: 1978 not 1979, the declined topic dropped, no history invented for the cordage works. |
| Reply parsing | A folder of raw messages: a plain reply, a top-posted reply with the quoted original, HTML only, a long signature, a phone's "Sent from my…", non-English quoting markers, an out-of-office, a bounce, a duplicate delivery. Each has the text that should be extracted. Unit tests, no network. |
| Rejection | Wrong sender, right thread. Right sender, failed authentication. Unknown thread. Oversized. A non-image attachment. Each must end in quarantine or a drop, with nothing written to the transcript and nothing sent back. |
| Hostile content | The injection, markup and header cases from `adversarial.json`, sent as email bodies, subjects and display names. |
| Loops and limits | An automatic reply to the interviewer's message produces no further mail. The eleventh message of a day is held. |
| Access rules | The new collections in the role-by-path matrix (see the testing plan, T2). |
| Round trip | Weekly, automated: send a question to a test inbox, reply from it, confirm the turn appears and the follow-up arrives signed and with working links. |
| Chat screen | Browser test: type, send, refresh, continue, end; a second role cannot open it. |

## Rollout

| Phase | What | Needs from the owner | Effort |
|---|---|---|---|
| 0 | Shared prompt module; `interviewTurn` on the server; data model fields; engine tests on the fictional family | Nothing | 3 days |
| 1 | **Chat** in the app, behind a per-dossier switch | One relative with an account to try it | 2 days |
| 2 | **Email, private pilot**: mailbox, sending from the domain, ingest, consent flow, quarantine, admin controls | The mailbox, DNS records, the account-less decision, two relatives | 4 to 5 days |
| 3 | Photos by email; the storyteller changing their own rhythm; reminders | Feedback from phase 2 | 2 days |
| 4 | Family-submitted questions into threads (#117); scheduled sessions sharing the same plumbing (#119) | | later |

Phases 0 and 1 can start immediately and put something in a relative's hands in about a week. Phase 2
can be built in parallel up to the point where it needs the mailbox.

### What to learn from the pilot

Decide these before it starts, so the pilot answers something:

- Do they reply at all, and how soon? (Reply rate; hours to reply.)
- Do they write more or less than people say? (Words per answer. Spoken turns in the real sessions have
  a median of 29 words.)
- Does the follow-up help or annoy? (Share of follow-ups answered.)
- Does it yield stories? (Events extracted per week, against voice.)
- Did anything feel wrong? (Ask them, in person. This is the one that matters.)

## Decisions for the owner

1. **Chat first, then email?** Recommended. The alternative is email first, which serves the stated
   audience sooner but waits on items 2 to 4.
2. **Account-less email storytellers.** Recommended yes: it is the point of the email mode. It means a
   storyteller can exist who has never signed in, identified by a verified address.
3. **The mailbox and the sending address.** A mailbox on the domain (`stories@` or similar), and
   permission to add the DKIM and DMARC records.
4. **Receiving design.** A (polled mailbox) is recommended for the pilot.
5. **Rhythm defaults.** Tuesday and Friday mornings, one reminder after five days, at most two
   follow-ups in a row.
6. **Who pilots.** Two relatives for email, one for chat.
7. **A name on the mail.** Whose name appears in the first line as the person who asked.
8. **Spend ceiling** per dossier per day for written interviews.

## Out of scope for now

Text messages (SMS) and messaging apps; group threads where several relatives answer together;
languages other than English; voice notes attached to email; the interviewer starting a thread with
someone the admin has not confirmed.
