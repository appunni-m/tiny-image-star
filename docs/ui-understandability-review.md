# UI understandability review

**Date:** 2026-10-04  
**Scope:** first-use discoverability for adding and cropping an image, finding common editing actions, applying image recipes, and using the editor on a phone.

## Review method

I followed the visible paths in a fresh local workspace at desktop and phone-sized viewports, then checked the corresponding action descriptions and state-dependent behavior in the editor. This is a source-led usability review, not a study with representative users. I did not import a personal image or claim observed task-completion rates.

## Task walkthroughs

| User goal | What the interface teaches | Assessment |
| --- | --- | --- |
| Start a design | The empty canvas offers **Add image**, **Draw a frame**, and **Add text**. It explains that a page is open workspace and frames have a fixed size. | Clear first step; frame terminology is explained in context. |
| Return to a saved design | The first review found that choosing browser storage saved the design but brought the blocking workspace chooser back after reload. Startup now recognizes a restored local design as an established storage choice. | Fixed: first-use choice is only required before any usable local design or folder workspace exists. |
| Crop a photo | The empty Layers and Design panels say to select an image and choose **Crop image**. The Help search accepts “How do I crop an image?” and explains: select the image, drag over what to keep, then choose **Finish crop**. Selecting an image exposes **Crop image** in its image actions. Crop mode explains edge and corner adjustment and offers **Undo crop**. | The steps are explicit and the same action is named consistently. The help search is useful after the user notices it. |
| Crop a photo placed inside a shape | A separate **Crop image inside shape** action positions the photo within its shape. When needed, Help now gives the exact path: **Design properties → Scale → Fill → Crop / position image**. | This is a distinct flow, but its prerequisite is now named as a control path instead of an unexplained “Scale to Fill” phrase. |
| Apply edits to many photos | A saved image recipe is described as a reusable preset. The interface directs users to select multiple image layers and then choose a recipe; mixed selections leave non-image layers unchanged. | The behavior is explained, though users must first find **Select multiple** in Layers. A suggested task in Help now exposes the path. |
| Find a feature without knowing its tool name | **? Help** opens a natural-language action finder; full questions, aliases, and task-dependent unavailable reasons are supported. The blank state shows five example tasks instead of the full action catalog. | Good recognition-based fallback; examples now demonstrate what it can do without overwhelming the phone-sized dialog. |
| Find tools on a phone | Tool labels are visible, and the bottom toolbar says **More →** while it can be swiped horizontally. The toolbar’s accessible description also explains horizontal scrolling. | The overflow cue is clearer now, but users still need to discover the gesture. Verify that first-time users can find tools such as Text and Comment. |
| Export | **Export image** and **Export PDF** are visible in the inspector footer; the PDF flow distinguishes paper output from frame sizing. | Clear action names and context. |

## Changes made from this review

The Help screen now shows task suggestions before a user types: **Crop an image**, **Remove background**, **Add text**, **Apply an image recipe**, and **Export PDF**. The action list stays empty until a query is entered. Tapping a suggestion fills the search and shows its instructions; it does not immediately run the action. Suggestions disappear while a query is active to keep the result list focused, and the targets remain large enough for touch. The image-in-shape crop action also names its exact prerequisite path. Startup now remembers that browser storage was selected by continuing into an already-saved local design instead of asking again after reload.

## Follow-up priorities

1. Test whether first-time users can locate tools such as Text and Comment through the mobile toolbar’s **More →** cue without help.
2. Run five short, moderated first-use sessions. Ask participants to add and crop a photo, remove a background, apply a saved recipe to several images, and export a PDF. Record unassisted completion, wrong turns, time to first action, and points where they ask for help. Do not call the UX validated until those sessions pass.

The existing local preview tab at `127.0.0.1:8000` was already loaded without the current Help entry. I left that tab’s design intact; use a fresh reload only after its unsaved state is safe.
