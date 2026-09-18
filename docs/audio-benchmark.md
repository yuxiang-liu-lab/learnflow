# Listening A/B benchmark — v0.6.1

Status: ready for user-run paired evaluation; no accuracy measurements yet. Mocked tests establish integration behavior, not listening accuracy. Do not promote a model based on confidence or plausible explanations alone.

## Fixed comparison

- A: `gpt-audio` (unchanged default)
- B: `gpt-audio-1.5` (opt-in)
- Same extension 0.6.1, prompt `listening-evidence-v3`, prompt text, choices in the same order, ordered MP3 bytes/labels and API settings for both.
- Choose a fixed set of questions before starting, including examples that previously failed. Use independently known correct answers; do not use either model as the answer key. Record answer text as well as letter in case quiz order changes.
- For each question, save Audio Model A in Settings, return and Analyze again once; record the result. Switch to B, save and Analyze again on the SAME question before navigating. Saving a model alone does not analyze. Alternate A/B order on successive questions if practical.
- Do not refresh or navigate between paired runs. Expand Audio debug to record every MP3 URL, full SHA-256, and prompt version. Matching URL alone is weaker than matching bytes. If one run abstains/fails, record that outcome; do not retry selectively or exclude it from the table. If both succeed but hashes differ, that is not a valid pair.
- Each run is independent, without the other model's answer in its input. Do not modify the prompt halfway through the benchmark. Any deliberate repeated trial should repeat BOTH models and be recorded separately.

## Record one row per question

| Question / prompt + ordered choices | MP3 URL / SHA-256 | Known correct answer + source | A answer / confidence / evidence | B answer / confidence / evidence | A outcome | B outcome |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Outcomes: correct, incorrect, insufficient_audio_evidence, API error, invalid output. Keep screenshot records if copying text is inconvenient. On abstention/error there is no suggestion; record the exact status and available Audio debug details. Do not silently count these as wrong guesses or omit them.

## Compare

Report per model: total paired questions N; correct C; wrong W; abstentions U; errors E (including invalid output), with C+W+U+E=N.

- Correct / all questions: C/N (does not reward abstaining on every item).
- Accuracy among answered questions: C/(C+W), undefined if none answered.
- Answer coverage: (C+W)/N.
- Abstention and error counts separately.
- Paired wins: questions A got right and B wrong, and vice versa; list abstention differences separately.

A small set is a pilot, not proof of general accuracy. Examine audible evidence behind confident errors, and consider both correctness and coverage before changing the default. Real API/model access remains account-dependent. Neither model is automatically substituted if a call fails.

Keep completed benchmark records local (for example under the ignored work/ directory). Do not commit course wording, answer keys, recording URLs, or recordings. The table above is an empty protocol, not collected data.
