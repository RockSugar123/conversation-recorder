# Version Snapshot: v1.1.1-inline-citation-fix

Recorded at: 2026-05-28

Fixes inline citation link extraction for non-`<a>` citation spans (e.g. Doubao's `span.container-WJm_Sj`).

Changes:
- `isLikelyInlineCitationLabel`: moved class-signature check before children check so known citation spans pass regardless of child elements
- `extractInlineCitations`: added priority scan for known citation container classes before the generic span/button/div fallback

Copied code:
- `extension/`
- `server/`
- `requirements.txt`
