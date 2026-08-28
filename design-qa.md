# Design QA — v2.12.0

## Evidence

- Source visual truth: `docs/design-qa/v2.12.0/reference.png`
- Browser-rendered implementation: `docs/design-qa/v2.12.0/implementation.png`
- Combined comparison (source left, implementation right): `docs/design-qa/v2.12.0/comparison.png`
- Viewport and state: 390 × 844 CSS px, daily home after one completed item; `1 / 50`, one high-frequency review item, streak 0.
- Source pixels: 853 × 1844. Implementation pixels: 780 × 1688 at device scale factor 2.
- Density normalization: both images resized to 390 × 844 before composing the 800 × 844 comparison board.
- Browser verification: local build opened in the Codex in-app browser at 390 × 844. Home, daily training, direction entry, browse entry, and active-session chrome were inspected. Browser console log was empty.
- Automated browser states: home, hard direction mode, spelling, recognition, browse, 320 × 568 short-screen controls, Service Worker activation, and offline cache were exercised by `tests/cdp_smoke.js`.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the implementation uses the requested Apple system stack (`-apple-system`, `SF Pro Text`, `PingFang SC`) with a deliberately stronger 32px product title and a subordinate 21px task title. This is intentionally more prominent than the generated reference because of the user's title-hierarchy feedback.
- Spacing and layout rhythm: 24px side margins, 52px primary action, 86px secondary tap rows, and the primary-before-secondary sequence match the selected direction. The implementation keeps all homepage content inside the 390 × 844 viewport without horizontal or vertical overflow.
- Colors and visual tokens: near-black `#0b0b0c`, off-white `#f5f5f7`, gray `#8e8e93`, and separator `#2c2c2e` match the approved monochrome direction. Correct/error colors appear only as semantic training feedback.
- Image quality and assets: the home screen contains no decorative raster assets. PWA icons are rendered from the existing source icon at 180, 192, and 512 pixels; no visible placeholder art remains.
- Copy and content: the daily count, remaining count, learning split, high-frequency review, direction practice, streak, and review-pool state are all driven by the existing application state. The date is intentionally aligned with the current-task heading rather than repeated as a standalone row.

## Comparison History

- Formal home comparison pass: no P0/P1/P2 issues. The larger product title and missing decorative chevrons are intentional changes: the former follows direct user feedback, and the latter keeps the dependency-free offline app focused on text and full-row tap targets.
- Supporting-screen inspection found the direction session was still carrying the large product identity header. It was changed to focused active-session chrome before the final browser run; the final hard-mode flow passed at 390 × 844.
- The spelling input focus ring was visually heavy in the first dark-theme pass. It was reduced to a 1px border plus a subtle 2px neutral halo before the final browser run.

## Primary Interactions Tested

- Start/continue daily training.
- Enter direction practice, switch to hard mode, start and exit.
- Open the browse screen and render 20 playable word rows.
- Submit a wrong spelling answer and return to the homepage with the review queue updated.
- Complete a recognition answer, verify reinforcement behavior, and preserve all five controls on a 320 × 568 screen.
- Activate the Service Worker and cache core files, 701 audio files, eight direction audio files, and the three PWA icon files.

## Follow-up Polish

- P3: if future use shows that disabled high-frequency review text is too subdued in bright environments, increase disabled opacity from `.5` to `.6` without changing the hierarchy.

final result: passed
