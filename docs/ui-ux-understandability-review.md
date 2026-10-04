# UI understandability review

Date: 2026-10-04

Scope: first-use navigation, image editing, task discovery, and the phone-sized interface.

## Method and limits

This review traces the current source-defined flows, checks the existing UX contracts, and inspects the open phone preview. The open preview is an older loaded build: its accessibility tree does not include the current task-search button. A fresh preview previously stopped at workspace setup, so it is not reliable visual evidence for the current source. Browser smoke remains deferred until the feature batch is complete, as requested. This is a heuristic review, not a moderated usability study; it cannot establish that new users will find or complete tasks unaided.

## Direct answer: can a new user figure out how to crop?

There is no separate Crop icon. Cropping is a contextual image action. For a photo layer, the current source gives a clear sequence:

1. Choose **Add image** from the empty Layers or Properties state, or from the new empty-canvas start card.
2. Select the photo with **Move / Select**. The image action bar shows **Crop image** and explains that the user should drag across the part to keep.
3. In crop mode, the on-canvas instructions explain edge/corner adjustment, **Undo crop**, and **Finish crop**. A crosshair now signals that the canvas is in crop mode.
4. If the user asks **? Help** “How do I crop an image?”, the action search returns the crop flow. If no image is selected, it explains the prerequisite and offers **Add image**.

That flow is understandable in the source and tests, but has not been validated with first-time users. A photo used as a shape fill is a different task: select the shape, choose **Fill**, then **Position image** to move or zoom the photo inside the shape. Help now exposes **Crop image inside shape** for that selection and explains when the fill must first be changed to **Fill**.

## Changes made during this review

- Empty pages now show an actionable start card with **Add image**, **Draw a frame**, and **Add text**. Choosing a drawing tool dismisses the card so it does not cover the canvas gesture.
- Page/frame wording now defines a **Page** as an open workspace and a **frame** as a fixed-size area. The same explanation appears in the empty start card and Properties.
- Task search now distinguishes cropping a photo layer from positioning a photo fill inside a shape. Numeric crop controls are labeled as visible source edges, with a short explanation of the percentages.
- Crop mode changes the desktop canvas cursor to a crosshair. Phone panel toggles display **Layers** and **Properties** labels; active Multi-select mode now shows its tap instructions in the Layers panel.
- The Assets image area labels page-placed layers **On this page** and the original-source library **Reusable images**. The batch speed slider now displays its memory trade-off beside the control, with the same hint connected to the slider for screen readers.
- Removed the old passive canvas hint so the actionable start card is the single empty-state instruction.
- Touch tool labels now appear across the full compact-device range (up to 820 px), including landscape phones and small tablets; “Image” and “Color” are now the actions “Add image” and “Pick color.”

## Task review

| Task | Current path | Assessment |
| --- | --- | --- |
| Add a photo | Empty-canvas card or empty Layers/Properties state → **Add image** | Direct and visible, including when phone side panels start closed. |
| Crop a photo layer | Select image → **Crop image** → drag area to keep → refine → **Finish crop** | Clearly named and guided in the canvas bar; first-time completion still needs observation. |
| Crop a photo inside a shape | Select shape → search **Crop image** → **Crop image inside shape**, or Properties → Fill → **Position image** | Now discoverable through both task search and the existing property control. Different behavior from cropping a standalone image should be checked with users. |
| Make a fixed-size design | Empty-canvas card → **Draw a frame**; use a preset in Properties or drag to draw | Page/frame distinction is now explained at first use. Preset discovery still depends on Properties. |
| Apply a recipe to multiple images | Open **Layers** → **Multi-select** → tap image layers → select recipe → **Apply to N images** | Help and active-mode instructions explain selection. The Layers drawer and row selection still need a phone usability check. |
| Export a PDF | Search PDF or use File → choose paper size → export page; editable vector PDF is a separate choice | Copy distinguishes paper size, image-based output, and editable vector output. Users still need to choose the intended result correctly. |
| Identify canvas tools | Desktop hover/focus tooltip; touch toolbar labels; **? Help** for task search | Every touch tool now has a visible label through 820 px, and ambiguous “Image”/“Color” labels were changed to “Add image”/“Pick color.” The long tool strip still needs a real-device check. |

## Remaining findings

1. **High — real task success is unverified.** Existing tests check copy, search matching, responsive rules, and event wiring; they do not show whether an unfamiliar person can find the controls. Run uncoached desktop and phone tasks before claiming the UI is easy to learn.
2. **Medium — advanced image controls are a long inspector run.** Crop/transform, basic adjustments, tonal controls, and local AI operations have different purposes. Keep the beginner path near the top and group less frequent controls so they do not read as one undifferentiated form.
3. **Medium — the mobile recipe bar needs visual validation.** The speed hint and controls have automated responsive coverage, but check phone portrait and landscape to confirm the bar does not cover too much canvas during real processing.
4. **Low — desktop still begins with icon-only tools.** Hover and keyboard-focus descriptions exist; touch screens have labels. Consider naming the most common tools directly or grouping the rest into a labeled overflow menu if user observation shows the desktop tooltips are not enough.

## Validation still needed

After feature implementation, ask 5–6 people who have not used Tiny Image Star to complete these tasks without coaching: crop a photo layer, crop a photo inside a shape, make a phone-sized frame, save and apply a recipe to several images, and export a page PDF. Record the first action, time to start, completion, wrong turns, and whether the person can explain the result before committing. Repeat on a narrow phone viewport. Browser automation can confirm layout and wiring; only observation can confirm whether people understand the interface.
