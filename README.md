# UQTxNova
A modern study productivity dashboard featuring task management, syllabus tracking, spaced repetition revision, analytics, and calendar planning.
https://mindspark2026.github.io/uqtxnova/

## Tests section
The **Tests** tab tracks scores, questions, voice notes and a manual mistake analysis per test.
- **Questions** have two separate workflows: *Upload Question Photo* (one image per question) and *Extract Test from Image* (OCR → editable text questions; the source photos are not stored).
- **Chapters** are multi-select, searched from the Syllabus data (same search as Study Schedule).
- Mobile uses tab navigation (details page and the Add/Edit sheet).
- Test data syncs through the existing `tests` key (localStorage + Firestore). Question photos, earlier image uploads and audio live in this device's IndexedDB (like Notes attachments). OCR uses Tesseract.js, loaded on first use.

## Question Timer, custom date range, pending-task rollover
- **Q-Timer** tab: per-question timing (timestamp-based, survives tab switches/refresh), correct / incorrect / unattempted, history cards, CSV export and analytics. Finished tests sync via the `qtt` key; the unfinished session is device-local.
- **CUSTOM DATE** on the Mission Dashboard: From/To range applied to hours, problems, focus, revision due, tasks, schedule and charts.
- **Pending-task rollover**: unfinished tasks move to today automatically (once per missed day, no duplicates), keeping `originalDate`, `carried`, `rolloverLog` and the real completion date.


## Upgrade build (November 2026)
- Mission task chapter entry is now free text and supports multiple chapter labels; task/test name, scheduled date and time are stored with the task.
- Added the `TEST` task type and a Mission Dashboard TEST-task selector in Add Test to prefill test name, subject, chapters, date, time and description while retaining the task link.
- Added a responsive Weekly / Monthly / Custom Progress view with recorded-entry-only totals, subject breakdowns (including General), and daily/subject charts.
- Test details include an Edit tab for the existing per-test mistake editor; the separate Questions tab was removed from the Add Test form (saved question data and detail-page question tools remain).
- Test full-size image assets now retain the original uploaded file; only the preview thumbnail is generated.
- Automatic pending-task rollover was already present and remains enabled.

Note: this build does not yet implement shared-record synchronization between the Test mistake editor and the standalone Errors notebook, nor image/voice attachments and subject/chapter assignment inside that editor. Review these before treating the requested Errors integration as complete.
