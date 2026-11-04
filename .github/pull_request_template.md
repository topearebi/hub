## Summary

<!-- What changed and why, in one or two sentences. -->

## Spec and gap references

- Spec sections: <!-- e.g. PRD §5.5, DESIGN §4.1, accessibility.md §3.2 -->
- Gap IDs closed: <!-- e.g. G-57; or "none" -->
- Feature spec (if new feature): <!-- plans/<feature>.md, completed with docs/spec-checklist.md §3 -->

## Verification

- [ ] `npm run typecheck`, `npm run lint`, `npm run test` and `npm run build` pass; gzip bundle stays under 60 KB
- [ ] New behaviour has tests (unit/component, plus automated accessibility or target-size checks where applicable)
- [ ] Specs updated in this PR if behaviour, tokens or data changed (`PRD.md`, `DESIGN.md`, `docs/accessibility.md`, `SCHEMAS.md`)

## Quality gates

Tick each one, or write "n/a" with a reason.

- [ ] **Touch:** works by touch alone; hit areas ≥ 44 px on coarse pointers; nothing is hover-only, right-click-only or drag-only
- [ ] **Keyboard and screen reader:** reachable by keyboard, visible focus, correct roles/states/names, focus managed on open/close
- [ ] **Contrast and preferences:** tokens only (no new raw literals); text ≥ 4.5:1 and controls/focus ≥ 3:1; checked with `prefers-contrast: more`, forced-colors and reduced motion
- [ ] **Responsive:** checked at 320, 390, 768, 1280 and 1920 px, portrait and landscape; safe areas and `dvh` respected
- [ ] **Offline and safety:** works offline; deletes are undoable or confirmed; dirty forms are guarded; async actions always end in a visible success or error
- [ ] **Network and privacy:** adds no request except same-origin or `api.github.com`; token never logged, exported or synced
- [ ] **Data:** no new schema fields except those approved in `SCHEMAS.md`
- [ ] **Forbidden patterns** in `AGENTS.md` §2 checked

## Evidence

<!-- Screenshots or recordings at phone and desktop sizes, the devices/assistive technology you tested on,
     and any Lighthouse, axe or contrast output. For UI changes, "tests pass" is not enough. -->

## Risks and follow-ups

<!-- Anything deferred, waived (with owner approval), or needing a decision. -->
