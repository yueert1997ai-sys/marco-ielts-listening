# Design QA — v2.13.0

## Evidence

- Source visual truth: `docs/design-qa/v2.13.0/reference-source.png` (853 × 1844).
- Normalized source: `docs/design-qa/v2.13.0/reference.png` (390 × 844).
- Browser-rendered implementation: `docs/design-qa/v2.13.0/implementation.png` (390 × 844 CSS px at device scale factor 1).
- Combined comparison, source left and implementation right: `docs/design-qa/v2.13.0/comparison.png`.
- Focused home-core comparison: `docs/design-qa/v2.13.0/comparison-home-core.png`.
- Comparison images are reproducible with `python scripts/build_design_comparison.py`.
- Browser verification used the repository Playwright wrapper at 390 × 844, 320 × 568, 375 × 844, and 430 × 844. The final browser console contained no errors or warnings.

## Findings

- No actionable P0, P1, or P2 differences remain.
- Visual hierarchy matches the selected light iOS reference: large product title and date, one grouped daily-progress card, one system-blue primary action, grouped task rows, quiet streak state, and a single collapsed settings row.
- The implementation deliberately reflects live state rather than the static reference. High-frequency review is muted when the queue is empty; dates and counts come from the current day and saved progress.
- Tokens match the release contract: grouped background `#F2F2F7`, white surfaces, black primary text, `#6C6C70` secondary text, system blue `#007AFF`, success green `#34C759`, and error red `#FF3B30`.
- Touch targets are at least 44px on the primary flows. The 320 × 568 recognition state keeps all four choices, the skip control, and the result continue button fully visible.
- Local Phosphor Regular icons replace text glyphs for navigation, audio, direction, settings, favourites, and feedback. No CDN or placeholder assets are used.

## Comparison History

- Iteration 1: the version badge competed with compact titles on browse, direction, and inbox views (P2). Those modes now use a tight native-style navigation header and hide the product/version lockup.
- Iteration 1: the recognition success pill overlapped the skip row (P2). It now appears in the question card's open center area and leaves every control unobstructed.
- Iteration 2: the normalized side-by-side home comparison and focused crop were opened and inspected. Spacing, radius, typography, color, alignment, and content hierarchy had no remaining P0/P1/P2 mismatch.

## Primary Interactions Tested

- Start and pause daily training while preserving `#start` and the existing local session data.
- Submit an incorrect spelling answer, confirm the recovery copy `再来一次`, and continue with `#continue`.
- Complete a correct recognition answer, confirm green auto-advance feedback, reinforcement scheduling, and reduced-motion compatibility.
- Skip a question and confirm `已加入复习` plus the existing review rule and memory details.
- Enter direction practice, browse the vocabulary, open starred words, and use the wrong-word inbox and expanded settings.
- Activate the Service Worker and verify the light PWA theme, versioned assets, offline Phosphor font, vocabulary/audio resources, and all three generated app icons.

## Follow-up Polish

- P3: if future outdoor testing finds disabled review rows too quiet, raise disabled text opacity slightly without changing the selected hierarchy.

final result: passed
