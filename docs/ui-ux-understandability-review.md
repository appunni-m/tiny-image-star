# UI understandability review

Date: 2026-10-04

Scope: first-use navigation, image editing, task discovery, recipes, export, collaboration, and the phone-sized interface.

## Method and limits

This review traces the current source-defined flows, user-facing copy, responsive rules, and existing UX tests. I also inspected the open local preview's accessibility tree and compared its served HTML with the checked-out source. The loaded tab does not list the current **? Help** or crop toolbar, while the server response includes them; this mismatch makes the tab inconclusive as a view of the current source. Browser smoke remains deferred until the feature batch is complete, as requested. Source and automated tests establish that instructions and routes exist; they cannot establish that unfamiliar users notice them or complete tasks unaided.

## Direct answer: can a new user figure out how to crop?

There is no separate Crop icon. Cropping is a contextual image action. For a photo layer, the current source gives a clear sequence:

1. Choose **Add image** from the empty Layers or Properties state, or from the new empty-canvas start card.
2. Select the photo with **Move / Select**. The image action bar shows **Crop image** and explains that the user should drag across the part to keep.
3. In crop mode, the on-canvas instructions explain edge/corner adjustment, **Undo crop**, and **Finish crop**. A crosshair now signals that the canvas is in crop mode.
4. If the user asks **? Help** “How do I crop an image?”, the action search returns the crop flow. If no image is selected, it explains the prerequisite and offers **Add image**.

That flow is explicit in the source and UX tests, but has not been validated with first-time users. A photo used as a shape fill is a different task: select the shape, choose **Fill**, then **Crop / position image** to move or zoom the photo inside the shape. Help also exposes **Crop image inside shape** for that selection and explains when the fill must first be changed to **Fill**. The control now uses the word “crop” as well as “position” so the visible label matches the way users are likely to describe the task.

In this run, all 35 tests in `action-search.test.mjs`, `image-context-actions.test.mjs`, and `image-crop-geometry.test.mjs` passed. They verify natural-language crop queries, the crop gesture instructions, separate photo-fill guidance, crop coordinate behavior, and the direct PDF export entry. This confirms that the route and instructions are wired; it does not prove users understand them without help.

## Changes made during this review

- Empty pages now show an actionable start card with **Add image**, **Draw a frame**, and **Add text**. Choosing a drawing tool dismisses the card so it does not cover the canvas gesture.
- Page/frame wording now defines a **Page** as an open workspace and a **frame** as a fixed-size area. The same explanation appears in the empty start card and Properties.
- Task search now distinguishes cropping a photo layer from positioning a photo fill inside a shape. Numeric crop controls are labeled as visible source edges, with a short explanation of the percentages.
- Crop mode changes the desktop canvas cursor to a crosshair. Phone panel toggles display **Layers** and **Properties** labels; active multiple-selection mode shows click/tap and recipe instructions in the Layers panel.
- The Assets image area labels page-placed layers **On this page** and the original-source library **Reusable images**. The batch speed slider now displays its memory trade-off beside the control, with the same hint connected to the slider for screen readers.
- Removed the old passive canvas hint so the actionable start card is the single empty-state instruction.
- Touch tool labels now appear across the full compact-device range (up to 820 px), including landscape phones and small tablets; “Image” and “Color” are now the actions “Add image” and “Pick color.”
- A shape’s photo-fill control now reads **Crop / position image**, and its accessible label describes both actions. This closes a vocabulary gap where Help called the task “Crop image inside shape” but the visible control only said “Position image.”
- The Layers control now says **Select multiple** instead of the jargon **Multi-select**. Once active, its visible instructions explain click/tap selection and the remaining steps to apply one saved recipe to the selected images.
- On phones, entering the Frame tool with nothing selected opens Properties to the frame-size presets; its instruction says to close Properties before drawing a custom frame.
- The Inspector export group now gives **Export image** (which changes to **Export ZIP** or **Export selection** when appropriate) and **Export PDF** separate, visible buttons. **Export PDF** opens the page-size and orientation controls. A saved recipe is explicitly described as a reusable image preset.

## Task review

| Task | Current path | Assessment |
| --- | --- | --- |
| Add a photo | Empty-canvas card or empty Layers/Properties state → **Add image** | Direct and visible, including when phone side panels start closed. |
| Crop a photo layer | Select image → **Crop image** → drag area to keep → refine → **Finish crop** | Clearly named and guided in the canvas bar; first-time completion still needs observation. |
| Crop a photo inside a shape | Select shape → search **Crop image** → **Crop image inside shape**, or Design properties → Fill → **Crop / position image** | The interaction is explained, but the direct control is deeper in the inspector than the standalone image action. Still needs first-time observation. |
| Make a fixed-size design | Empty-canvas card → **Draw a frame**; on phones, Properties opens to presets, or close it and drag a custom frame | Page/frame distinction is explained at first use and the mobile preset path is surfaced. Confirm drawer behavior on a phone. |
| Apply a recipe to multiple images | Open **Layers** → **Select multiple** → click/tap image layers → **Done** → choose saved recipe/preset → **Apply to N images** | The mode explains the gesture, effect, and unchanged non-image layers. The Layers drawer and row selection still need a phone usability check. |
| Export a PDF | In **Properties**, choose **Export PDF** beside **Export image**, then set paper size and orientation; Help search and File menu remain alternate paths | Directly visible beside image export. The PDF dialog shows paper size, orientation, output dimensions, and fit behavior; choosing raster versus editable vector may still need help. |
| Identify canvas tools | Desktop hover/focus tooltip; touch toolbar labels; **? Help** for task search | Every touch tool now has a visible label through 820 px, and ambiguous “Image”/“Color” labels were changed to “Add image”/“Pick color.” The long tool strip still needs a real-device check. |
| Understand image editing scope | Select image → **Adjust image**; crop is a direct canvas action, local AI tools are under **More image tools** | The direct crop path is separate from the long adjustment list. The remaining controls still need clearer grouping for people exploring beyond the common actions. |
| Share a design live | **Share** → send owner link → guest chooses a folder and returns a reply link → owner accepts/connects | The UI states that no sharing server is used and explains the reply step. This is an unavoidable extra step in the current serverless handshake and remains less simple than a single-link join. |

## Remaining findings

1. **High — actual task success is unknown.** Existing tests verify copy, query matches, responsive rules, and event wiring; they do not show whether an unfamiliar person finds the controls unaided. The crop route is explicitly described, but a first-time user may still miss the contextual image bar or Help entry point. Do not call the editor easy to learn until this is observed.
2. **Medium — cropping a photo inside a shape takes more discovery.** A standalone image gets a direct canvas action bar after selection. For a shape fill, the user must find Design properties → Fill → **Crop / position image**, or know to search **? Help**. Consider surfacing the same contextual canvas action when a shape with one image fill is selected.
3. **Medium — image adjustment controls still form a long inspector run.** The standalone crop action is direct, but crop/transform, color sliders, tonal effects, and AI tools remain a lot to scan when a user chooses **Adjust image**. Group common edits separately from fine-tuning after the task study confirms where people hesitate.
4. **Medium — live sharing carries a comprehension cost.** With no server, the guest must return a reply link and the owner must accept it. The oversized-invite state does have a visible **Share invite details** action; verify that users understand who sends each link and when the connection is live.
5. **Medium — mobile recipe-bar coverage is structural, not observational.** The speed hint and touch-sized controls have responsive tests, but check portrait and landscape with a real image to see whether progress obscures too much of the work.
6. **Low — desktop drawing tools still rely on hover/focus or task search.** Touch users see labels; desktop starts with icons. Keep this if participants find the names and instructions quickly, otherwise add persistent labels to the common tools.

## What a new user should do to crop

For a regular photo layer: choose **Add image**, select the photo on the canvas, choose **Crop image** in its action bar, drag over the area to keep, adjust the handles if needed, and choose **Finish crop**. The crop is reversible with **Undo crop**.

For a photo inside a shape: select the shape, open **Design** properties, find its **Fill** controls, choose **Crop / position image**, drag the photo within the shape (or pinch/use Zoom on touch), and choose **Done positioning**. The shape remains the crop boundary. If a user asks in their own words, the **? Help** search offers **Crop image inside shape** for this selection.

The current source communicates these steps. A first-time user study is still needed to answer whether people understand them: give participants only the canvas and the goal “crop this photo to keep the subject,” record their first action and detours, then repeat for the photo-inside-shape case on desktop and phone. Do not coach them or point out **? Help**; discovering it is part of the result.

## Validation still needed

After feature implementation, ask 5–6 people who have not used Tiny Image Star to complete these tasks without coaching: choose a workspace or browser storage, crop a photo layer, crop a photo inside a shape, make a phone-sized frame, save and apply a recipe to several images, export a page PDF, and invite a collaborator. Record their first action, time to start, completion, wrong turns, help searches, and whether they can explain the result. Repeat on a narrow phone viewport. Browser automation can confirm layout and wiring; only observation can confirm whether people understand the interface.
