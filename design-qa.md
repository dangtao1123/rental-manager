# Design QA — 办理入住（方案 2）

source visual truth path: `C:\Users\dangd\.codex\generated_images\019f5f7a-dffb-7cd1-ba2c-dfe856a95e55\exec-23cdf5aa-7575-4a4f-b027-89dbea2bc60c.png`
implementation URL: `https://fangchan.dylmkj.com/loan/zufang.html`
implementation screenshot path: unavailable — the local headless browser could render the base page but did not produce a stable modal capture after the iframe/auto-open step.
viewport: 982 × 842 CSS px target; source image 1354 × 1161 px; no density normalization applied to the generated source.
state: 办理入住 → 资料填写（方案 2：左侧基础信息、右侧费用聚焦、底部身份与备注）

## Comparison evidence

- Source visual was opened and inspected directly.
- The implementation was checked through the deployed HTML/CSS/JS response, matching SHA-256 hashes, and active service state.
- A same-viewport modal screenshot could not be captured in the available local browser environment, so visual pixel comparison is blocked.

## Findings

- [P1] Modal screenshot capture is unavailable.
  Location: QA evidence, not application code.
  Evidence: static assets and runtime service are reachable, but the headless browser did not return a stable capture of the auto-opened modal state.
  Impact: typography, exact spacing, responsive wrapping, and footer visibility cannot be verified from rendered pixels.
  Fix: capture the deployed modal at 982 × 842 in a browser and rerun this report before treating visual QA as passed.

## Implementation checklist

- [x] Reorganized step 1 into a two-column layout matching the selected design direction.
- [x] Kept existing field names, data collection, validation, room-change behavior, and step navigation.
- [x] Kept rent/property fee/deposit as the right-column emphasis blocks.
- [x] Kept identity uploads, tenant ID, and notes in a full-width bottom section.
- [x] Added responsive single-column collapse for narrow screens.
- [x] Ran JavaScript syntax checks and CSS brace validation.
- [x] Deployed static files and confirmed the service is active.
- [ ] Browser-rendered visual comparison at desktop and mobile widths.

## Follow-up polish

- Verify the generated source and browser capture side by side for text wrapping in the section helper copy and the fixed footer.

final result: blocked
