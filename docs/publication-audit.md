# Publication audit

## Scope

LearnFlow is an independent sanitized snapshot with fresh Git history. It does not import the predecessor repository's commits or Git configuration. The predecessor project is kept as a separate private archive.

## Sanitized material

- Replaced the assessment statement, other course-derived prompts and answer choices with original synthetic text.
- Replaced course item IDs, captured recording filenames, durations and source metadata.
- Rebuilt the nested-table fixture as synthetic-two-choice.html and its test as two-choice.test.mjs, preserving the same structural associations and rejection tests.
- Replaced captured audio metadata with synthetic-audio-source.json on a reserved .test domain. Removed the captured download size/hash entirely. No recording is included.
- Removed private-development acceptance narratives from documentation and documented the actual limits of mocked tests.
- Updated user-facing branding; runtime JavaScript/HTML/CSS differs from the predecessor only by branding strings and trailing blank-line cleanup. Permissions and parser/provider behavior remain unchanged.

## Deliberately retained public integration identifiers

The manifest, sender validation and media allowlist still refer to api.openai.com and cnow.apps.ng.cengage.com. The hb1ml06h/hb2ml06h directory rules and platform DOM selectors are necessary for the existing adapter; they are not credentials or captured assessment URLs. Worker/routing tests use invented MP3 names under these public allowlist rules with mocked fetches. Parser-only fixtures use reserved example domains. These identifiers are an explicit compatibility exception, not overlooked private data.

## Audit method and results

The actual file contents, not just ignore rules, were inspected for key/token patterns, credentials, email addresses, absolute local paths, original assessment wording/IDs, recording names, and captured metadata. The included file inventory contains only source, synthetic tests, documentation, manifest, license and Git hygiene files. No recordings, browser exports, cookies, logs, private keys or dependencies are included.

Credential-like test strings (such as sk-test-placeholder and user:password) are deliberate dummy values used to test authorization handling and redaction. No real credential or personal email was found. This manual/pattern audit is not a guarantee against every possible undiscovered secret.

The new repository uses a GitHub noreply identity verified from authenticated account settings, configured locally for this repository only. The fresh root commit must be checked before publication for its author, committer, tree and absence of parents. No signing key or Git configuration is included in tracked files.

## Verification

All 71 tests pass with synthetic fixtures. Runtime comparison confirms branding-only changes (ignoring trailing whitespace) across 20 JavaScript/HTML/CSS/module files. Manifest entry points, local UI references and JavaScript syntax are checked separately. Permissions remain storage, activeTab, scripting, sidePanel and contextMenus, with the two host permissions above.

The MIT license uses 2026 and the GitHub identity yuxiang-liu-lab. Live Chrome acceptance and real API/audio quality have not been rerun for this sanitized snapshot; follow the manual checklists before relying on a new installation.

The repository is intended to remain PRIVATE until the owner explicitly approves public visibility after reviewing the final commit and remote verification report.
