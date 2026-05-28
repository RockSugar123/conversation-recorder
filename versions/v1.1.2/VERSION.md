# Version Snapshot: v1.1.2

Recorded at: 2026-05-28

Inline citation extraction now correctly captures non-`<a>` citation spans (e.g. Doubao's `span.container-WJm_Sj`) and matches them against sidebar reference links.

Changes since v1.1.0:
- `isLikelyInlineCitationLabel`: class-signature check moved before children check so known citation spans pass regardless of child elements
- `extractInlineCitations`: priority scan for known citation container classes (`container-WJm_Sj`, `inline-citation`, etc.) before generic span/button/div fallback
- `scoreReferenceMatch` / `findReferenceMatch`: matches inline citation labels against reference source/title/summary fields
- `referenceSource` / `referenceIndex` / `referenceSummary`: parses additional metadata from reference DOM nodes
- Reference model (`server/main.py`): added `source`, `index`, `summaryText` fields
- Debug logging: capture flow logs detailed reference and inline citation data to console

Copied code:
- `extension/`
- `server/`
- `requirements.txt`
