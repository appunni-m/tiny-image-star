# UI understandability review

Date: 2026-10-04

Scope: first-use navigation, image editing, task discovery, recipes, export, collaboration, and the phone-sized interface.

## Method and limits

This review combines source and UX-test inspection with a fresh local preview of the current checkout at desktop size and a 390 × 844 phone viewport. I opened **? Help**, tried the “Crop an image” suggestion, and checked how the empty page and mobile tool strip present next steps. I did not import a photo into the preview, so the selected-image crop interaction is confirmed from source and focused tests rather than an end-to-end user gesture. Browser smoke remains deferred until the feature batch is complete, as requested. This is a source-led review, not a study with unfamiliar users; the UI and tests cannot establish that people notice controls or complete tasks unaided.

## Direct answer: can a new user figure out how to crop?

There is no separate Crop tool in the bottom strip. Cropping a regular photo is a contextual image action. The empty Layers and Properties states say to select an image and choose **Crop image**. Once a user selects one photo layer, its action bar gives the next steps and the **Crop image**, **Adjust image**, and **Save recipe** actions:

1. Choose **Add image** from the empty Layers or Properties state, or from the new empty-canvas start card.
2. Select the photo with **Move / Select**. The image action bar says **Crop image** and instructs the user to drag across the part to keep.
3. In crop mode, the on-canvas instructions explain edge/corner adjustment, **Undo crop**, and **Finish crop**. A crosshair now signals that the canvas is in crop mode.
4. If the user asks **? Help** “How do I crop an image?”, the action search returns the crop flow. If no image is selected, it explains the prerequisite and offers **Add image**.

The fresh phone preview showed that the **Crop an image** Help suggestion opens a readable, step-by-step result and offers **Add image** when no image layer exists. That makes the “where do I start?” case clear. For a photo used as a shape fill, select a shape with one visible image fill and use **Crop / position image** in the canvas action bar; drag, pinch, or use Zoom to position the photo inside the shape. If the fill uses **Fit** or **Tile**, the bar explains that **Fill** must be selected first. Help also exposes **Crop image inside shape**. When a shape has multiple image fills, the Inspector keeps explicit target controls so the editor does not guess which photo to move.

The focused action-search, image-action, crop-geometry, and mobile-overflow checks passed: 40 tests. They verify natural-language crop queries, the crop gesture instructions, separate photo-fill guidance, crop coordinate behavior, and the mobile overflow control. This confirms that the routes and instructions are wired; it does not prove users understand them without help.

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
- The Help suggestions now include **Create a component**, and its result explains how to make one layer reusable and where to place copies. The empty **Assets → Components** state points to the creation controls and the task result explains why an unsupported selection cannot be converted.
- The mobile tool strip now has a real **More tools** / **First tools** control that moves through the horizontally overflowing tools; this replaces a passive overflow label that could not be tapped.
- Image controls are grouped into **Crop & transform**, **Light & color**, and **Detail & effects**. Crop and common color controls open by default; advanced effects start collapsed, and each image remembers which groups the user opened while editing.

## Task review

| Task | Current path | Assessment |
| --- | --- | --- |
| Add a photo | Empty-canvas card or empty Layers/Properties state → **Add image** | Direct and visible, including when phone side panels start closed. |
| Crop a photo layer | Select image → **Crop image** → drag area to keep → refine → **Finish crop** | Clearly named and guided in the canvas bar; first-time completion still needs observation. |
| Crop a photo inside a shape | Select a shape with one image fill → **Crop / position image** in the canvas action bar → drag/pinch/zoom → **Done positioning**. With multiple fills, target one explicitly in Design properties. | The common case has a direct canvas action; unavailable **Fit/Tile** cases say to switch to **Fill**. User success still needs observation. |
| Make a fixed-size design | Empty-canvas card → **Draw a frame**; on phones, Properties opens to presets, or close it and drag a custom frame | Page/frame distinction is explained at first use and the mobile preset path is surfaced. Confirm drawer behavior on a phone. |
| Apply a recipe to multiple images | Open **Layers** → **Select multiple** → click/tap image layers → **Done** → choose saved recipe/preset → **Apply to N images** | The mode explains the gesture, effect, and unchanged non-image layers. The Layers drawer and row selection still need a phone usability check. |
| Export a PDF | In **Properties**, choose **Export PDF** beside **Export image**, then set paper size and orientation; Help search and File menu remain alternate paths | Directly visible beside image export. The PDF dialog shows paper size, orientation, output dimensions, and fit behavior; choosing raster versus editable vector may still need help. |
| Identify canvas tools | Desktop hover/focus tooltip; touch toolbar labels and **More tools**; **? Help** for task search | Phone tools show their names, and the overflow control is actionable. Confirm target placement and swipe/tap behavior on real devices. |
| Create reusable components | Select one layer → **Create component** in Design properties or its layer menu; Help search offers the same task; place copies from **Assets → Components**. | Now described in Help and the empty Components state; actual first-use success remains unobserved. |
| Understand image editing scope | Select image → **Adjust image**; crop and transform controls are grouped first, common light/color controls next, and fine-tuning under **Detail & effects**; local AI tools are under **More image tools** | The main controls are grouped by task and the advanced group starts closed. A first-use session should check whether people can distinguish and predict sliders such as exposure, highlights, and tint. |
| Share a design live | **Share** → send owner link → guest chooses a folder and returns a reply link → owner accepts/connects. If transferring a QR, the invite tells the guest **File → Join a shared design → Scan invite QR** and the reply tells the host to choose **Scan reply QR**. | The UI states that no sharing server is used and names both QR scan actions. This is an unavoidable extra step in the current serverless handshake and remains less simple than a single-link join. |

## Remaining findings

1. **High — actual task success is unknown.** Tests confirm copy, query matching, responsive rules, and wiring, and the local preview confirms how empty-state help is presented. None of that proves an unfamiliar person will find the contextual image bar after selecting a photo or finish a task without coaching. Do not call the editor easy to learn until this is observed.
2. **Medium — the crop action is contextual.** The regular photo route is clearly described, but its main button appears only after image selection. The phone preview surfaced the first step and Help route; a first-time task study should verify users discover the selected-image bar without being pointed to it.
3. **Medium — image adjustment vocabulary needs observation.** The inspector now groups crop/transform, light/color, and detail/effects, but terms such as exposure, highlights, and tint may still need examples or simpler descriptions if first-time users cannot predict their result.
4. **Medium — live sharing carries a comprehension cost.** With no server, the guest must return a reply link and the owner must accept it. Verify that users understand who sends each link and when the connection is live.
5. **Medium — mobile recipe-bar coverage is structural, not observational.** The speed hint and touch-sized controls have responsive tests, but check portrait and landscape with a real image to see whether progress obscures too much of the work.

## What a new user should do to crop

For a regular photo layer: choose **Add image**, select the photo on the canvas, choose **Crop image** in its action bar, drag over the area to keep, adjust the handles if needed, and choose **Finish crop**. The crop is reversible with **Undo crop**.

For a photo inside a shape: select the shape and choose **Crop / position image** from its canvas action bar, then drag the photo within the shape (or pinch/use Zoom on touch) and choose **Done positioning**. The shape remains the crop boundary. If the fill is set to **Fit** or **Tile**, change it to **Fill** in Design properties first. If a user asks in their own words, the **? Help** search offers **Crop image inside shape** for this selection.

The current source communicates these steps. A first-time user study is still needed to answer whether people understand them: give participants only the canvas and the goal “crop this photo to keep the subject,” record their first action and detours, then repeat for the photo-inside-shape case on desktop and phone. Do not coach them or point out **? Help**; discovering it is part of the result.

## Validation still needed

After feature implementation, ask 5–6 people who have not used Tiny Image Star to complete these tasks without coaching: choose a workspace or browser storage, crop a photo layer, crop a photo inside a shape, make a phone-sized frame, save and apply a recipe to several images, export a page PDF, and invite a collaborator. Record their first action, time to start, completion, wrong turns, help searches, and whether they can explain the result. Repeat on a narrow phone viewport. Browser automation can confirm layout and wiring; only observation can confirm whether people understand the interface.
