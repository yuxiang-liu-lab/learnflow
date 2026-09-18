# Practice regression coverage — v0.6.1

## Structural prompt association

The parser supports two visible layouts. The legacy layout has one scoped prompt and named radio group. The nested-table layout can contain several .problemTypes elements and no .choiceTable: a visible prompt with ID <item>_question is paired with submitForm_<item> inside the same wrapper. Its single named radio group must explicitly reference the prompt through aria-describedby. Existing label and choice validation still applies.

The synthetic statement is: “Every tree in this synthetic example has a root node.” True and False are read from actual visible labels; their semantics are not inferred. The fixture also tests two non-True/False choices, interrogative wording, four choices, and rejection of unrelated radio areas. No course question or real item identifier is retained.

## Audio representation

The normalized question has an ordered audioSources array. IDs, labels and choice associations travel with separate audio inputs; clips are never concatenated. All required clips must be retrieved and validated before requesting an answer. Every source participates in fingerprints and result verification. Playback state does not.

Limits: six clips, 12 MiB each, 24 MiB combined. The existing narrow production URL rules remain unchanged. Unsupported sources, unmatched required excerpts, incomplete retrieval and ambiguous mappings abstain without a text fallback. Multi-audio behavior is covered by mocks; live multi-audio accuracy remains an evaluation task.

## Local diagnostics

Practice debug shows candidate containers, exact option text/count, prompt candidates and DOM relationships, reasons for acceptance/rejection, and parsedQuestion when available. Audio debug shows source resolution, readiness, per-clip HTTP outcomes and failure stages with sensitive URL components redacted. These are local troubleshooting outputs, not telemetry.

## Manual checks

Reload LearnFlow and refresh the full supported page. Expect Connected: v0.6.1. Verify the detected statement exactly matches the page and optionCount matches its visible choices. Confirm text-only items route to the Text Model even beside an unrelated player. For listening items, compare each native player against the ordered sources, hashes, and labels in Audio debug. Verify old results disappear on question/clip changes, playback does not duplicate calls, and dragging still works. Never use answer selection or submission as a test action.
