# Shengtu Reference Image Prompting Notes

Date: 2026-07-17

This note records the prompting pattern that worked well for the Rinha thumbnail generation task. It is meant to be reused for future image-generation tasks with different characters, scenes, or source articles.

## Goal

When using multiple reference images, avoid letting the model blend all references equally. Assign each reference a narrow job:

- Composition references: layout, framing, thumbnail density, rough visual motifs.
- Character reference: identity, face, hair, outfit, proportions, and art style.
- Secondary subject reference: silhouette, pose role, side-character placement.

For character-centric images, make the character reference the highest-priority source. The model should be told that style fidelity beats action, decoration, and composition.

## What Worked

The best results came from these constraints:

- Use only the original four reference images, not previous generated outputs.
- State a clear reference priority order.
- Put the character reference above all other instructions.
- Say that pose/action may be simple if that preserves the original art style.
- Prevent common artifacts explicitly: hands, fingers, hair strands, pseudo-text, malformed icons.
- Reduce decorative elements when they are not essential.
- Generate several candidates with slightly different risk profiles.
- Add final title text locally, not with the image model.

## Reference Priority Pattern

Use language like this:

```text
Reference image 3 is the strongest and primary reference for BOTH character identity and art style.
If any instruction conflicts with matching reference image 3's art style, choose reference image 3's art style.
Reference images 1 and 2 are only rough layout references.
Reference image 4 is only for the side producer concept.
```

This is important because screenshot references often pull the model toward a different thumbnail/fanart style. If the target character has an official standing illustration, repeatedly describe the target art style from that image.

## Style Lock Phrases

Useful phrases:

```text
NON-NEGOTIABLE STYLE LOCK
ABSOLUTE HIGHEST PRIORITY
official visual-novel character art feeling
same official-style visual-novel art style as reference image 3
same face proportions, eye shape, hair silhouette, color palette, and outfit design language
clean anime visual-novel linework
flat and soft cel shading
restrained highlights
controlled shadows
```

Avoid vague requests such as only "same style" or "match the reference." Spell out what style means: linework, shading, face proportions, hair shape, eyes, outfit, and finish.

## Negative Style Phrases

These helped reduce drift:

```text
No painterly rendering.
No semi-realistic fanart.
No cinematic bloom.
No glossy skin.
No heavy shading.
No photorealistic fabric.
No 3D look.
No soft blurry hair.
No melted hair tips.
Do not reinterpret the character.
Do not make her look like a different artist or a fanart redesign.
```

## Artifact Prevention

Hands, fingers, symbols, and hair are frequent failure points. If they are not central to the image, simplify them:

```text
Avoid visible detailed fingers.
Hands should be crossed under sleeves, hidden by the body, or cropped out.
Hair strands must be crisp, clean, and readable, not melted or blurry.
Decorative symbols must be minimal, simple, complete, and not warped.
Do not generate question marks if they are not necessary.
No speech bubbles, dialogue boxes, caption bars, readable text, fake text, logos, or watermark.
```

## Candidate Strategy

Generate multiple candidates instead of trying to solve every requirement in one prompt:

- Candidate 1: balanced thumbnail, style lock, minimal hearts/sweat, no question marks.
- Candidate 2: closer to original pose, accepting a simpler pose to preserve character style.
- Candidate 3: clean character-focus version, almost no decoration.

This gives the user a meaningful comparison: composition energy versus character fidelity.

## API Command Template

Use the skill script with repeated `--image` arguments for multiple references.

```powershell
python C:\Users\fork\.codex\skills\shengtu-skill\scripts\generate_image.py `
  --base-url https://www.aiwanwu.cc `
  --mode edit `
  --image "PATH_TO_COMPOSITION_REFERENCE_1.png" `
  --image "PATH_TO_COMPOSITION_REFERENCE_2.png" `
  --image "PATH_TO_CHARACTER_REFERENCE.png" `
  --image "PATH_TO_SECONDARY_SUBJECT_REFERENCE.png" `
  --prompt "$prompt" `
  --size 3840x2160 `
  --out "PATH_TO_OUTPUT.png"
```

Use `https://www.aiwanwu.cc` if the primary endpoint is temporarily unavailable. Do not include or expose API keys in notes, prompts, or commands.

## Prompt Case 1: Style Lock, No Question Marks

Use when the previous output had malformed symbols or excessive decoration.

```text
Create a complete model-generated 16:9 Japanese anime thumbnail illustration using ONLY the four provided reference images.

NON-NEGOTIABLE STYLE LOCK:
The central [CHARACTER_NAME] must match reference image 3 as closely as possible in character shape and art style. Reference image 3 is the primary source for her face, proportions, hair shape, hair color, eyes, outfit, accessories, clean anime visual-novel linework, restrained highlights, and soft cel shading. Do not reinterpret her. Do not use painterly fanart, semi-realism, glossy cinematic lighting, heavy airbrush, soft-focus glamour, 3D, or photorealism. If the composition references conflict with reference image 3's style, ignore the composition style and preserve reference image 3's style.

Use reference images 1 and 2 only for broad thumbnail composition: wide layout, [CHARACTER_NAME] large in the center, a cropped no-face side character on the right, [SCENE_PROP] at lower left, warm background.
Use reference image 4 only for the side character idea: cropped/no-face figure, simple clean anime style.

To avoid generation artifacts:
- Keep [CHARACTER_NAME]'s hands off-frame, behind her body, or hidden by sleeves. Do not draw detailed fingers.
- Hair strands must be crisp, clean, and readable, not melted or blurry.
- Decorative elements must be minimal and simple: only 2 or 3 clean small hearts and 2 small sweat drops on or near the side character.
- Do NOT generate question marks.
- Do NOT generate speech bubbles, dialogue boxes, caption bars, readable text, fake text, logos, or watermark.

Scene mood: [MOOD_DESCRIPTION]. Leave the lower area clean enough for a compact title overlay later.
```

## Prompt Case 2: Original-Pose Style Preservation

Use when the model keeps changing the character form too much. This prompt sacrifices dramatic action to preserve style.

```text
Create a complete model-generated 16:9 Japanese anime thumbnail illustration using ONLY the four provided reference images.

PRIMARY GOAL: generate [CHARACTER_NAME] in the same official-style visual-novel art style as reference image 3. This is more important than a dramatic pose. It is acceptable for [CHARACTER_NAME] to keep a pose very close to reference image 3, such as a calm confident upper-body pose with arms crossed or hands mostly hidden, if that helps preserve the original art style and character shape.

Match reference image 3 very strictly:
- Same clean line quality and soft cel-shaded visual-novel rendering.
- Same face design, eye shape, eye rendering, small confident smile, hair silhouette, hair volume and hair strand logic.
- Same outfit design language, accessories, restrained highlights.
- Same proportions and official character-art feeling.

Avoid all style drift:
No painterly rendering, no semi-realistic fanart, no cinematic bloom, no glossy skin, no heavy shading, no photorealistic fabric, no 3D look, no blurred hair, no melted hair tips.

Composition from reference images 1 and 2 only at a rough level: [CHARACTER_NAME] large and central, side character on the right as a cropped/no-face figure, [SCENE_PROP] at lower left, warm background. Reference image 4 gives the side character silhouette concept. All elements must share reference image 3's clean anime visual-novel style.

Artifact prevention:
- Avoid visible detailed fingers. Hands should be crossed under sleeves, hidden by the body, or cropped out.
- Use no question marks. Use only 1 or 2 very simple hearts and 1 or 2 small sweat drops if needed.
- Do not add speech bubbles, dialogue boxes, caption bars, readable text, fake text, logos, or watermark.
- Keep decorative symbols crisp and complete, not warped, not fuzzy, not pseudo-text.

Mood: [MOOD_DESCRIPTION]. Leave lower area clean for a later title overlay.
```

## Prompt Case 3: Clean Character Focus

Use when ornaments keep deforming or the model is spending too much effort on props.

```text
Create a complete model-generated 16:9 Japanese anime thumbnail illustration using ONLY the four provided reference images.

This version should prioritize character accuracy and art-style consistency over thumbnail decoration.

[CHARACTER_NAME] style requirement, highest priority:
The central character must be generated in the same art style and character shape as reference image 3. Treat reference image 3 as the official model sheet. Match her face proportions, eye shape and eye rendering, hair silhouette, smooth clean hair locks, expression, outfit, accessories, and restrained visual-novel cel shading. Keep clean edges and controlled shadows. She should look like the same character from the same visual-novel artwork set, not a new fanart redesign.

Composition:
- Wide 16:9.
- [CHARACTER_NAME] large in the center-left or center, upper-body, close to the viewer.
- Side character on the right, cropped/no-face, simple clean anime style based on reference image 4.
- [SCENE_PROP] at lower left, simplified and clean.
- Warm background, simple and unobtrusive.

Strict negative requirements:
- No visible detailed hands or fingers. If hands appear, they must be simple and mostly hidden/cropped, with no finger emphasis.
- No question marks.
- No speech bubbles, dialogue boxes, caption bars, readable text, fake text, logos, or watermark.
- No malformed decorative symbols. Use at most one tiny heart and one tiny sweat drop, or omit decorations entirely if they risk distortion.
- No painterly rendering, no semi-realistic lighting, no photorealistic suit fabric, no excessive glow, no soft blurry hair, no warped hair strands.

Mood: [MOOD_DESCRIPTION]. Leave lower area clean for a title overlay.
```

## Local Title Overlay

For Japanese titles, do not ask the image model to draw text. Generate the image without text, then add the title locally with PIL or another deterministic tool.

For the Rinha task, the title font was:

```text
C:\Users\fork\AppData\Local\Microsoft\Windows\Fonts\华康POP2体W9-0.ttf
Font family metadata: DFPOP2W9-B5
```

Use a compact black backing behind the title. The backing should only exceed the text by a small padding amount, roughly:

- Horizontal padding: `0.25-0.35 * font_size`
- Vertical padding: `0.10-0.18 * font_size`

## Review Checklist

Before accepting a candidate:

- Does the character still look like the original reference, not just "similar purple-haired anime girl"?
- Are the face proportions, eye shape, hair silhouette, and outfit language preserved?
- Is the rendering style close to the source art, not screenshot/fanart style?
- Are hands hidden or clean?
- Are hair tips crisp and readable?
- Are hearts/sweat/question marks complete and not malformed?
- Is there no fake text, dialogue bubble, or accidental caption?
- Is the lower title area usable?

## Practical Note

If the model repeatedly fails character-style fidelity, simplify the prompt:

1. Remove question marks and extra decorations.
2. Hide or crop hands.
3. Allow the character to keep a pose close to the original reference.
4. Reduce scene action.
5. Generate more candidates rather than overloading one prompt.

The strongest prompt is often the least ambitious compositionally: a clean upper-body character-focused image with minimal decoration.
