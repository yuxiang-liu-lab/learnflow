# Architecture

## Modules

Understand is the growing study module. Practice retains the existing Cengage question assistant. No Capture, Review, account system, database, telemetry or analytics is implemented.

### Data flow

Selection (popup capture, panel capture, or context-menu selectionText) → explicit study action → service-worker sender validation → study workspace → session model → shared Understand provider → validated response → Side Panel conversation.

The existing popup's one-shot route remains available. It and the panel reuse background/understand.mjs and requestResponse from background/openai.mjs; there is no second provider implementation. Practice text continues through its own request schema and validator, and audio remains separate.

### Session responsibilities

- background/study-session.mjs: bounded source metadata, explicit pending selection, replacement, successful conversation turns and serialized storage updates per window.
- background/study-workspace.mjs: get/offer/replace/dismiss/run routes, 25-second request timeout, duplicate protection, cancellation, worker-restart recovery and context-menu installation.
- sidepanel/panel.js: renders source and conversation as text, requests user actions, copies responses and supports keyboard follow-ups. It receives state-change notifications containing only a window ID and retrieves current state from the worker.

The worker permits study messages only from the exact extension popup or Side Panel URLs with the matching extension ID. The existing quiz sender rules remain unchanged. Trusted extension contexts exclusively access local and session storage (Chrome session storage's default access level). No credentials are returned to the panel.

Each session has an ID, source (text/title/redacted URL/initial action), pending source, messages, busy/error state and the last model name. One session belongs to one browser window and is not automatically replaced on tab navigation. URLs omit query and fragment; metadata is not transmitted to OpenAI. Selected text and successful prior messages are sent on explicit actions. Selection detection alone never makes an API call.

A new selection is offered as pending. Existing context and messages remain readable until explicit replacement. On a fresh context-menu session, the menu click itself authorizes the initial action. The popup launcher only offers a selection; it does not call the model. Panel replacement is labelled with its action and explicitly states it will send the new context.

Conversation input is bounded to a 12,000-character source, 2,000-character follow-ups, 20 successful messages (10 exchanges) and a 60,000-character prior-message budget before starting another turn. The next response is additionally capped at 12,000 characters. The system refuses further turns at its limits instead of silently forgetting the original context.

### State lifetime

chrome.storage.local: API key, Text Model, Audio Model and Practice panel position, unchanged from v0.5.0.

chrome.storage.session: one temporary conversation per open browser window. It survives Side Panel closure and worker suspension, but clears on browser restart or extension reload. A window-close listener removes its session and cancels its active request. There is no durable learning history. If a worker disappears during analysis, the next read clears the interrupted busy state and offers a retry; no phantom answer is added.

Jobs are isolated from Practice jobs. Updating settings/removing the key cancels both. Failed requests preserve prior successful turns, and late cancelled results are rejected. Closing just the panel leaves an explicitly requested operation running until completion or timeout.

### Chrome integration

Requires Chrome 116+ for sidePanel.open. The manifest adds sidePanel and contextMenus, retaining activeTab, scripting and storage. No host permission is expanded. The panel path is sidepanel/panel.html. The toolbar popup remains configured. Context menus open the panel directly in the click callback before asynchronous operations, as required by [Chrome Side Panel documentation](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).

Selection capture remains an on-demand injected read-only function. No general page observer is installed. Get current selection may need a fresh toolbar/menu gesture after navigation because activeTab access is temporary. Browser pages, PDFs and inaccessible frames can be unavailable.

## Runtime components

| File | Responsibility |
| --- | --- |
| `popup/popup.html`, `popup/popup.css`, `popup/popup.js` | Understand actions and results, Practice guidance, shared Settings access. |
| `popup/selection.mjs` | Read-only selection capture and ambiguity/size checks. |
| `background/understand.mjs` | Understand input validation, three teaching prompts and output validation. |
| `sidepanel/panel.html`, `sidepanel/panel.css`, `sidepanel/panel.js` | Persistent Understand UI, pending context, follow-ups and copying. |
| `background/study-session.mjs` | Session state transitions and serialized session storage. |
| `background/study-workspace.mjs` | Study request lifecycle and context menus. |
| `manifest.json` | Manifest V3 metadata, permissions, module worker, settings page and ordered frame content scripts. |
| `background/service-worker.js` | Validates message senders and client version; owns credentials/settings, panel-position storage, request routing, cancellation, in-flight deduplication and text-result cache. |
| `background/openai.mjs` | Normalizes question input, builds strict-schema text requests, validates returned choices/explanations/confidence and sanitizes API failures. |
| `background/audio.mjs` | Validates media origin/path, downloads bounded MP3 content, computes SHA-256, builds the listening prompt, validates JSON and returns safe fetch diagnostics. |
| `content/messaging.js` | Wraps runtime messaging, performs version-aware communication and stops orphaned content scripts after context loss. |
| `content/parser.js` | Extracts the current question/labels, associates its native audio, resolves sources and builds stable question identity. |
| `content/drag.js` | Handles header pointer dragging, frame-viewport clamping and saved position. |
| `content/content.js` | Creates the closed Shadow DOM panel, watches question/media changes, coordinates requests and renders validated results/diagnostics. |
| `options/options.html` | API-key and separate text/audio-model settings form. |
| `options/options.css` | Settings-page presentation. |
| `options/options.js` | Reads public configuration and saves/removes credentials through worker messages. |

## Data flow

1. Declarative scripts run in matching CengageNOW frames and establish a version-checked worker connection.
2. The parser reads one visible question wrapper, prompt, and associated radio labels without changing quiz controls.
3. Ordinary questions without question-level audio take the text route. A native player or explicit missing-clip listening requirement takes the audio route.
4. The worker obtains settings from trusted local storage. Text uses Responses with strict Structured Outputs; audio uses Chat Completions with MP3 input and local JSON validation.
5. The panel checks request generation and re-reads question identity before showing an answer. Responses for old questions are discarded.

Question fingerprints include prompt identity, text, ordered choices and resolved audio identity. Input selection, playback position, readiness, event traces and transient input IDs do not trigger new analysis. MP3 URL changes invalidate the previous suggestion. Explicit retries are permitted; audio results are not cached after completion.

## Audio source handling

Every native audio element must be associated with the current prompt or one verified choice label. The resolver considers its declared src, nested sources and selected currentSrc. A new explicit src takes precedence over stale currentSrc. Ambiguous sources, blob delivery and unsupported URLs fail closed.

The worker currently accepts only HTTPS MP3s under `hb1ml06h` and `hb2ml06h` on the exact CengageNOW host. Downloads are limited to 12 MiB, checked for an MP3 signature and hashed. Final redirected URLs must pass the same allowlist. No OpenAI credentials accompany media fetches.

Each audio stage has a 25-second timeout; the worker has a 55-second total limit. Text requests have a 25-second worker limit. No automatic retry or text fallback is used for failed listening analysis.

## Diagnostics and safeguards

Audio debug includes redacted source URLs, media readiness/duration, bounded media-event history, HTTP status, content type, final URL and failure stage. Events before content-script injection cannot be reconstructed. Raw API errors, keys, cookies and authorization headers are not returned to the panel.

A model response must match an extracted choice and contain valid explanation/confidence fields. Audio additionally supports an explicit `insufficient_audio_evidence` outcome and optional short `audibleEvidence` observations. Missing evidence produces no suggestion.

The assistant does not select, advance, save or submit quiz answers. The only UI it modifies is its own panel; original question controls remain untouched.

## Source-delivery regression fixture

`tests/fixtures/synthetic-audio-source.json` contains invented source metadata on a reserved .test domain. It checks relative-source resolution and stable identity after playback. Separate worker tests use synthetic filenames under the public production allowlist and mocked bytes; no real recording is fetched or included.

## Practice representation in v0.6.1

The platform-specific DOM adapter stays in content/parser.js. The normalized question contains its prompt, 2–26 actual choices, and an ordered audioSources array. Each source has a deterministic DOM-order ID, label, kind, URL, and optional choiceAnswer when the player belongs to a choice label. Labels come from scoped aria-labelledby text, visible figure captions, accessible player labels, or the owning choice; otherwise they are Excerpt 1, Excerpt 2, etc. Unrecognized nearby prose is not guessed as a label.

The former audio field remains a compatibility indicator for existing routing, but retrieval and identity verification use audioSources for every clip count, including one. Legacy single-audio inputs are normalized at the worker boundary. Single-clip API payloads retain their original shape; multiple clips receive separate input_audio parts, each preceded by its ID/label/order/choice association. They are never concatenated. The listening prompt is listening-evidence-v3.

Fingerprints include the full ordered source array, labels and choice associations alongside prompt/choices; metadata readiness and playback are excluded. The worker retrieves every source with the existing allowlist and MP3 validation. All retrievals must succeed; partial failures report accessible versus required count and never call a text model. Limits are six clips, 12 MiB each, 24 MiB combined, with the existing request timeouts.

Every returned source carries URL, ID/label, SHA-256 and byte count. The panel checks the entire ordered list before displaying an answer. Duplicate identities, unmatched explicit excerpt references and model-reported ambiguous_audio_mapping abstain. Explicit counts/references in the prompt can mark missing players as required; counts cannot be inferred reliably from arbitrary language.

Two choices are legal in the validator and request schema. The legacy adapter permits one scoped prompt and one named radio group with unambiguous visible labels even without redundant ARIA; conflicting explicit references fail. The alternate nested-table adapter matches a prompt ID ending in _question to submitForm_<item> in the same wrapper, then requires one named radio group whose explicit aria-describedby values reference that prompt. This resolves nested .problemTypes ambiguity without guessing from nearby prose. Synthetic fixtures test both layouts.

Practice debug and Audio debug display local counts, association, source readiness and per-clip fetch failures. These diagnostics are neither transmitted to OpenAI nor stored as telemetry. Understand, Side Panel and session implementation are unchanged by v0.6.1.
