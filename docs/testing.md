# Testing

Run with Node.js 24; no dependency installation, real API key, or external request is required:

```sh
node --test --test-isolation=none tests/*.test.mjs
```

The sanitized snapshot passes all **71 tests**. No test or meaningful assertion was removed for publication. Assessment text, identifiers, recording names, durations and captured metadata were replaced with invented values.

| Test file | Coverage |
| --- | --- |
| api | Text contracts, sender validation, credentials/settings, cache and cancellation |
| audio | Both supported directory rules, bounded MP3 retrieval, redirects, diagnostics, both models, abstention and malformed output |
| messaging | Context loss, stale versions, retry and reconnection |
| parser | Scoped prompt/player association, relative/nested/currentSrc delivery, fingerprint stability and redaction |
| parser-diagnostics | Local candidate relationships, acceptance/rejection reasons and final parsed object |
| two-choice | Synthetic nested-table layout with declarative True/False, other two-choice, interrogative and four-choice cases; unrelated radio areas rejected |
| practice-robustness | Scoped choices and ordered/labelled multi-audio associations |
| panel | Rendering, stale-answer rejection, duplicate suppression and complete audio identity checks |
| routing | Parser → worker → mocked provider → displayed result for text, global unrelated player, listening and missing clips |
| understand | Selection validation, three actions, shared transport, sender checks and popup flow |
| study | Temporary sessions, explicit replacement, contextual requests, context menus, Side Panel copying/keyboard/error behavior |

## Synthetic fixtures

`fixtures/synthetic-two-choice.html` is an inert structural fixture with original tree terminology and synthetic IDs. It contains nested .problemTypes containers, a matching submitForm scope, and two explicitly associated radios. The test constructs a small DOM mock using the statement from this fixture; it is not a full browser HTML parser test.

`fixtures/synthetic-audio-source.json` uses invented metadata and a reserved .test source URL. Worker tests separately exercise the unchanged production allowlist with synthetic filenames and 256-byte mock MP3-signature data. No recording or captured course metadata is included. The tests never fetch those URLs.

## Manual acceptance

Automated Chrome/DOM mocks do not establish installed-browser compatibility, real account access, audio reasoning accuracy, or calibrated confidence. No new live API or installed-Chrome test is claimed for this snapshot.

1. Load LearnFlow separately from the root directory and configure its own key. Disable an older copy on the same page to avoid duplicate requests.
2. Select an original paragraph; try Explain, Explain simply and Summarize. Open the Side Panel, ask a follow-up, copy the response, and explicitly replace the context with a new selection.
3. Close/reopen the panel; the context should remain. Reload the extension; temporary conversations should clear.
4. Refresh a supported Practice page. Confirm Connected: v0.6.1. Check two- and four-choice text detection, including text beside a global audio player.
5. Check the question's own single MP3 and, where available, two/three-clip comparisons. Compare every label/source/hash with the native players. Unsupported or failed media must show no answer and never fall back to text.
6. Change questions and confirm stale results disappear. Playback alone must not repeatedly call the API. Drag/collapse the panel and refresh.
7. Confirm LearnFlow never selects, saves, advances, or submits assessment answers.

See [Side Panel acceptance](manual-test-v0.6.0.md), [Practice checks](practice-v0.6.1.md), and [paired audio evaluation](audio-benchmark.md). Keep raw captures, recordings, and benchmark results out of Git.
