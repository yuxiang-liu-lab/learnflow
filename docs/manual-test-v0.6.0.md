# v0.6.0 manual acceptance plan

Status: automated checks pass; the installed Chrome Side Panel and real API conversation still need these manual checks. These instructions are not a claim that live tests have already passed.

## Setup

Use Chrome 116 or later. In chrome://extensions, reload this same unpacked extension directory. Check that version 0.6.1 is shown. Refresh the Cengage tab. An update in the same directory retains settings; a separate LearnFlow installation needs its own settings. No key needs to be pasted into a chat. API actions may incur charges.

## A. Side Panel

Select an educational paragraph on a regular webpage. Open the toolbar popup, click Open learning workspace, then dismiss the popup. Verify the panel remains visible while you scroll/click the webpage. Check the pending passage preview. Opening alone must not start an AI request. Close and reopen the panel; the temporary context should remain. A new browser window should start with its own empty session.

## B. Explain

Click Use new selection · Explain. Verify the exact source remains in Context, the loading indicator appears, and a concise AI response is displayed. Copy response should copy the text. Alternatively click Explain for the current context.

## C. Explain simply

Click Explain simply for the same source. Verify a new exchange appears with simpler language and the original source stays visible. The configured Text Model should be reported.

## D. Summarize

Click Summarize. Check that the answer focuses on the passage's main points, and the previous exchanges remain scrollable.

## E. Follow-up conversation

Ask “Can you give me an example?” then “Explain the second sentence.” Verify answers refer to the original passage and earlier explanation. Use Ctrl+Enter / Command+Enter to submit; Enter should add a line. Check loading prevents duplicate submissions. Try an empty follow-up: expect a useful error, no new message pair, and existing conversation preserved. With a missing key or network problem, expect an error and a usable retry path.

## F. New selection

Select a different passage. Click Get current selection (or reopen the popup launcher if Chrome needs fresh access). Verify New selection ready shows it without clearing the existing conversation or sending it to OpenAI. Keep current context should dismiss it. Offer it again and click Use new selection · Explain: verify the previous conversation clears and the new explanation uses the new passage. Selecting text by itself must do nothing.

## G. Right-click context menu

On selected webpage text, choose LearnFlow → Explain, Explain simply, or Summarize. Test all three. With an empty session, the panel should open and run that action. With an active session, it should offer the new selection and indicated action for explicit replacement. Unsupported/oversized selections should show guidance, never silently alter the active source. Editable fields are intentionally excluded.

## H. Practice text question

On CengageNOW, confirm Connected: v0.6.0. A normal text-only question (even beside an unrelated global player) must show No — text question, use the configured Text Model, and display answer, answer text, explanation and confidence. Change questions: the old answer should disappear. Test dragging and position persistence.

## I. Practice audio question

Use one supported native question-specific MP3. Check Audio debug against that player's source and verify the configured Audio Model is used. Confirm answer/explanation/confidence appear on success. An unavailable clip or insufficient evidence must abstain, with no text fallback. Playback-only changes should not trigger repeated analysis. Confirm the extension never selects answers or activates Next, Save or Submit.

## Additional lifetime/privacy checks

Changing settings during an active request should cancel it without appending a late result. Closing the browser window removes that window's temporary session. Reloading the extension clears all study sessions while retaining saved settings. The popup's original quick actions should still work independently. No telemetry, history database or automatic browsing capture is present.
