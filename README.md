# LearnFlow

A browser-native personal learning system for understanding and practicing technical material while studying online.

**Version 0.6.1 · Chrome 116+ · Manifest V3 · MIT**

## Overview

LearnFlow brings two learning tools alongside the page you are reading:

- **Understand:** explain selected text, explain it simply, or summarize it, then ask contextual follow-up questions in Chrome's Side Panel.
- **Practice:** read supported assessment content and display a suggested answer, explanation, and confidence estimate, including question-specific educational audio.

It does **not** automatically select answers, advance questions, save responses, or submit assignments. Practice is currently a focused CengageNOW adapter, not a universal question reader. This independent project is not affiliated with Cengage or OpenAI.

## Motivation

LearnFlow began as a small browser learning experiment. It is growing incrementally into a personal learning system: one useful feature at a time, with understandable architecture and regression tests. The goal is to connect explanations to the material being studied without repeatedly leaving the page.

## Features

- Three selected-text actions: Explain, Explain simply, and Summarize.
- Side Panel conversations retaining the original passage and successful follow-ups; copy responses and submit with Ctrl+Enter / Command+Enter.
- Explicit confirmation before replacing an existing conversation with a new selection.
- Toolbar popup with a quick one-shot explanation workflow and shared settings.
- Practice parsing for 2–26 visible radio choices, including structurally associated declarative True/False statements.
- Separate text and audio model settings; question-specific native MP3 resolution and ordered multi-clip input.
- Local response validation, insufficient-audio-evidence abstention, and no text fallback when required audio fails.
- Fingerprints and request generations that reject stale answers and suppress duplicate requests.
- Draggable, collapsible Practice panel and local diagnostics.

## Architecture

Understand and Practice share the service worker, settings, and text transport. Each retains its own input and output contracts. Audio retrieval and validation remain separate from text analysis.

```text
learnflow/
├── manifest.json              Extension entry points and permissions
├── LICENSE                    MIT license
├── background/                Worker, provider calls, audio, temporary study sessions
├── content/                   Practice parser, panel, messaging, dragging
├── sidepanel/                 Understand conversation workspace
├── popup/                     Module entry point and selection capture
├── options/                   API key and model settings
├── docs/                      Architecture, testing, benchmark and publication notes
└── tests/                     Node tests and synthetic fixtures
```

Understand: selection → explicit action → worker → shared text provider → validated response → Side Panel.

Practice: supported question → scoped parser → text/audio routing → worker → validated suggestion → floating panel.

See [Architecture](docs/architecture.md) for component responsibilities and state lifetimes. Technologies: JavaScript/ES modules, HTML/CSS, Chrome extension APIs, Shadow DOM, Fetch, Web Crypto, and Node's built-in test runner. There are no third-party runtime dependencies or build tools.

## Installation

1. Download and extract this repository or clone it.
2. Open `chrome://extensions` in Chrome 116 or newer.
3. Enable **Developer mode**, choose **Load unpacked**, and select the directory containing `manifest.json`.
4. Open LearnFlow's settings and configure your own OpenAI API key.
5. Select text on a regular webpage, then right-click → **LearnFlow** → an action, or open the toolbar popup.

For Practice, refresh a supported CengageNOW assignment page. When updating files, reload the extension and refresh the full page so embedded frames receive new scripts. This separate snapshot has separate extension storage: do not copy credentials or browser exports into the repository. Disable any older copy on the same quiz page to avoid duplicate panels and requests.

## Configuration and basic usage

The Text Model defaults to `gpt-5.4-mini`; the Audio Model defaults to `gpt-audio`, with `gpt-audio-1.5` available for paired comparison. These are configured identifiers, not a guarantee of account availability or accuracy. API usage requires your own account and may incur charges.

A blank API-key field preserves the saved key. **Remove saved key** deletes it and cancels active requests. Keys are entered only in the extension settings page.

In Understand, use a selection action to start a conversation. Ask follow-ups in the Side Panel. A new passage is offered as a preview; use **Use new selection** to replace the old context. Opening the popup or capturing a selection alone does not call the model.

In Practice, a newly detected supported question is analyzed **automatically** once a key is configured. **Analyze again** makes an explicit new attempt. Review the answer text and explanation critically; confidence is the model's estimate, not a calibrated probability. Audio debug helps verify that the correct question-specific clips were used.

## Privacy

- The key, model settings, and Practice panel position live in local extension storage, restricted to trusted extension contexts. The key is not synced or returned to the content panel. Local storage is not an encrypted vault.
- Understand sends selected text and successful conversation turns to OpenAI only for explicit study actions. Page title and redacted URL are local display metadata, not part of the provider payload.
- Practice sends detected prompt and choices to OpenAI; listening requests also send the question's MP3 bytes. Requests specify `store: false`; this is not a promise about all provider retention policies.
- Temporary per-window conversations use Chrome session storage. They survive panel closure and worker suspension, but clear on browser restart or extension reload; closing the window removes its session. There is no durable learning history or telemetry.
- Media retrieval includes browser credentials for the permitted Cengage host. OpenAI credentials are never attached to media requests. Diagnostics redact sensitive URL components; inspect copied diagnostics before sharing them.

| Permission | Purpose |
| --- | --- |
| `storage` | Settings and temporary sessions |
| `activeTab`, `scripting` | Read a selection following user interaction |
| `sidePanel` | Understand workspace |
| `contextMenus` | Selection actions |
| `https://api.openai.com/*` | Model requests |
| `https://cnow.apps.ng.cengage.com/*` | Existing Practice integration and bounded audio retrieval |

Content scripts run only in the configured CengageNOW assignment path, including matching frames. There is no all-sites background observer.

## Testing

With Node.js 24, run:

```sh
node --test --test-isolation=none tests/*.test.mjs
```

The 71 tests cover provider contracts, sender validation, sessions, Side Panel behavior, text/audio routing, two-choice parsing, ordered multi-audio handling, stale results, and diagnostics. Fixtures contain invented assessment text and synthetic media metadata. Network calls and audio bytes are mocked; no real key or recording is needed.

See [Testing](docs/testing.md), [Practice checks](docs/practice-v0.6.1.md), and [Side Panel checks](docs/manual-test-v0.6.0.md). Automated mocks do not establish live browser compatibility or model accuracy. [Audio benchmark](docs/audio-benchmark.md) describes a paired evaluation protocol; no benchmark accuracy is claimed.

## Limitations

Practice depends on a specific DOM adapter and a narrow MP3 allowlist: the `hb1ml06h` and `hb2ml06h` directories on the supported host. Other products, hosts, blob media, ambiguous associations, or missing clips are unsupported. The public integration rules are retained to preserve behavior; no captured recording URLs or course assessment fixtures are included.

Understand reads selections, not entire pages, images, or audio. Browser-internal pages, PDF viewers, editable fields, and inaccessible frames may not expose a selection. Conversations have size/turn limits. AI explanations and suggestions can be wrong. Live multi-audio quality and account-specific model access require manual evaluation.

## Roadmap

Improve Understand and Practice through small, tested iterations. Future possibilities include Capture (saved concepts and notes) and Review (learning and mistake review). These are directions, not implemented features: there are no accounts, databases, learning history, or spaced review yet.

## License

[MIT](LICENSE), copyright 2026 yuxiang-liu-lab. Third-party websites, course content, and provider services are not licensed by this project. See [Reference review](docs/reference-review.md) and [Publication audit](docs/publication-audit.md).
