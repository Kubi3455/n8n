// Prompts behind the three content types: normal video, UGC ad video, and the
// Instagram carousel. The master schema and the UGC-specific wording are carried over
// from the original n8n workflow; the "normal video" and carousel prompts are new.

// The schema every generated video prompt (normal or UGC) must follow.
export const MASTER_PROMPT_SCHEMA = `{
  "description": "Brief narrative description of the scene, focusing on key visual storytelling.",
  "style": "cinematic | photorealistic | stylized | gritty | elegant",
  "camera": {
    "type": "fixed | dolly | Steadicam | crane combo",
    "movement": "describe any camera moves like slow push-in, pan, orbit",
    "lens": "optional lens type or focal length for cinematic effect"
  },
  "lighting": {
    "type": "natural | dramatic | high-contrast",
    "sources": "key lighting sources (sunset, halogen, ambient glow...)",
    "FX": "optional VFX elements like fog, reflections, flares"
  },
  "environment": {
    "location": "describe location or room (kitchen, desert, basketball court...)",
    "set_pieces": [
      "list of key background or prop elements",
      "e.g. hardwood floors, chain-link fence, velvet surface"
    ],
    "mood": "describe the ambient atmosphere (moody, clean, epic...)"
  },
  "elements": [
    "main physical items involved (product, accessories, vehicles...)",
    "include brand visibility (logos, packaging, texture...) when relevant"
  ],
  "subject": {
    "character": {
      "description": "optional - physical description, outfit",
      "pose": "optional - position or gesture",
      "lip_sync_line": "optional - spoken line if there's a voiceover"
    },
    "product": {
      "brand": "Brand name, if any",
      "model": "Product model or name, if any",
      "action": "description of the main transformation or action"
    }
  },
  "motion": {
    "type": "e.g. transformation, explosion, vortex, walk, gesture",
    "details": "step-by-step visual flow of how elements move or evolve"
  },
  "VFX": {
    "transformation": "optional - describe style (neon trails, motion blur...)",
    "impact": "optional - e.g. shockwave, glow, distortion",
    "particles": "optional - embers, sparks, thread strands...",
    "environment": "optional - VFX affecting the scene (ripples, wind...)"
  },
  "audio": {
    "music": "optional - cinematic score, trap beat, ambient tone",
    "sfx": [
      "list of sound effects (zip, pop, woosh...)"
    ],
    "ambience": "optional - background soundscape (traffic, wind...)",
    "voiceover": {
      "delivery": "tone and style (confident, whisper, deep...)",
      "line": "text spoken if applicable"
    }
  },
  "ending": "Final shot description - what is seen or felt at the end (freeze frame, logo pulse, glow...)",
  "text": "none | overlay | tagline | logo pulse at end only",
  "format": "16:9 | 4k | vertical",
  "keywords": [
    "brand",
    "scene style",
    "motion type",
    "camera style",
    "sound mood",
    "target theme"
  ]
}`;

// "OpenAI Vision: Analyze Reference Image" node - shared by both video modes.
export const VISION_PROMPT = `You are an image analysis assistant.

Your task is to analyze the given image and output results **only in YAML format**. Do not add explanations, comments, or extra text outside YAML.

Rules:

- If the image depicts a **product**, return:

    \`\`\`yaml
    brand_name: (brand if visible or inferable)
    color_scheme:
      - hex: (hex code of each prominent color)
        name: (descriptive name of the color)
    font_style: (serif/sans-serif, bold/thin, etc.)
    visual_description: (1-2 sentences summarizing what is seen, ignoring the background)

    \`\`\`

- If the image depicts a **character**, return:

    \`\`\`yaml
    character_name: (name if visible or inferable, else "unknown")
    color_scheme:
      - hex: (hex code of each prominent color on the character)
        name: (descriptive name of the color)
    outfit_style: (clothing style, accessories, or notable features)
    visual_description: (1-2 sentences summarizing what the character looks like, ignoring the background)

    \`\`\`

- If the image depicts **both**, return **both sections** in YAML.

Only output valid YAML. No explanations.`;

// ============================================================================
// UGC Reklam Videosu - casual, handheld, authentic. Unchanged from the original workflow.
// ============================================================================

export const UGC_IMAGE_PROMPT_SYSTEM = `ROLE: UGC Image Prompt Builder

GOAL:
Generate one concise, natural, and realistic image prompt (<=120 words) from a given product or reference image. The prompt must simulate authentic UGC (user-generated content) photography.

RULES:
- Always output **one JSON object only** with the key:
  - \`image_prompt\`: (string with full description)
- Do **not** add commentary, metadata, or extra keys. JSON only.

STYLE GUIDELINES:
- Tone: casual, unstaged, lifelike, handheld snapshot.
- Camera cues: include at least 2-3 (e.g., phone snapshot, handheld framing, off-center composition, natural indoor light, soft shadows, slight motion blur, auto exposure, unpolished look, mild grain).
- Realism: embrace imperfections (wrinkles, stray hairs, skin texture, clutter, smudges).
- Packaging/Text: preserve exactly as visible. Never invent claims, numbers, or badges.
- Diversity: if people appear but are unspecified, vary gender/ethnicity naturally; default age range = 21-38.
- Setting: default to real-world everyday spaces (home, street, store, gym, office).

SAFETY:
- No copyrighted character names.
- No dialogue or scripts. Only describe scenes.

OUTPUT CONTRACT:
- JSON only, no prose outside.
- Max 120 words in \`image_prompt\`.
- Must cover: subject, action, mood, setting, style/camera, colors, and text accuracy.

CHECKLIST BEFORE OUTPUT:
- Natural handheld tone?
- At least 2 camera cues included?
- Product text preserved exactly?
- Only JSON returned?`;

export const ugcImagePromptUser = ({ caption, imageDescription }) => `Your task is to create an image prompt following the system guidelines.
Ensure that the reference image is represented as **accurately as possible**, including all text elements.

Use the following inputs:

- **User's description:**
${caption || '(none provided)'}

- **Reference image description:**
${imageDescription}`;

export const ugcVideoScriptUser = ({ caption, imageDescription, model, angle }) => `Create a UGC-style video prompt using both the reference image and the user description.

**Inputs**
- User description (optional):
  \`${caption || '(none provided)'}\`
- Reference image analysis (stay strictly faithful to what's visible):
  \`${imageDescription}\`

**Rules**
- Keep the style casual, authentic, and realistic. Avoid studio-like or cinematic language.
- Default model: \`${model || 'veo3_fast'}\`.
- Output only **one JSON object** with the keys: \`title\` and \`final_prompt\`.${angleClause(angle)}`;

// ============================================================================
// Normal Video - general purpose, style follows whatever the idea calls for.
// ============================================================================

export const GENERAL_IMAGE_PROMPT_SYSTEM = `ROLE: Image Prompt Builder

GOAL:
Generate one clear, vivid image prompt (<=120 words) from a given reference image and a user idea. Pick whatever visual tone best fits the idea - polished/cinematic, casual/candid, playful, dramatic - rather than defaulting to one style.

RULES:
- Always output **one JSON object only** with the key:
  - \`image_prompt\`: (string with full description)
- Do **not** add commentary, metadata, or extra keys. JSON only.

GUIDELINES:
- Read the user's idea first and let it choose the tone, lighting and framing.
- Include concrete camera/lighting cues appropriate to that tone (e.g. studio softbox and shallow depth of field for a polished look, or handheld and natural light for a candid one).
- Packaging/Text: preserve exactly as visible in the reference. Never invent claims, numbers, or badges.
- Diversity: if people appear but are unspecified, vary gender/ethnicity naturally; default age range = 21-45.

SAFETY:
- No copyrighted character names.
- No dialogue or scripts. Only describe scenes.

OUTPUT CONTRACT:
- JSON only, no prose outside.
- Max 120 words in \`image_prompt\`.
- Must cover: subject, action, mood, setting, style/camera, colors, and text accuracy.`;

export const generalImagePromptUser = ({ caption, imageDescription }) => `Your task is to create an image prompt following the system guidelines.
Ensure that the reference image is represented as **accurately as possible**, including all text elements.

Use the following inputs:

- **User's idea:**
${caption || '(none provided)'}

- **Reference image description:**
${imageDescription}`;

export const generalVideoScriptUser = ({ caption, imageDescription, model, angle }) => `Create a video prompt using both the reference image and the user's idea below.

**Inputs**
- User idea:
  \`${caption || '(none provided)'}\`
- Reference image analysis (stay strictly faithful to what's visible):
  \`${imageDescription}\`

**Rules**
- Choose whichever style, camera work and mood best serve this specific idea - cinematic, photorealistic, stylized, gritty or elegant. Do not default to one look; let the idea decide.
- Default model: \`${model || 'veo3_fast'}\`.
- Output only **one JSON object** with the keys: \`title\` and \`final_prompt\`.${angleClause(angle)}`;

// ============================================================================
// Hook/Varyant Testi - the same idea, opened 3-5 different ways. Each angle steers only
// the hook/opening beat; the underlying idea and visual stay the same.
// ============================================================================

export const HOOK_ANGLES = {
  stat: {
    label: 'Şaşırtıcı istatistik',
    instruction: 'Open with a surprising, concrete-sounding statistic or number related to the topic (plausible, not fabricated as fact) to stop the scroll in the first beat.',
  },
  question: {
    label: 'Soru sorma',
    instruction: 'Open with a direct, provocative question aimed straight at the viewer - one the rest of the video answers.',
  },
  objection: {
    label: 'Doğrudan itiraz',
    instruction: 'Open by naming a common objection or skepticism the viewer might have, then directly challenging it.',
  },
  story: {
    label: 'Hikaye anlatımı',
    instruction: 'Open with a one-line personal or narrative moment ("I used to...", "Last week...") that pulls the viewer into a small story.',
  },
  bold_claim: {
    label: 'Cesur iddia',
    instruction: 'Open with a bold, confident claim or promise that creates curiosity about how it could possibly be true.',
  },
};

// Fixed, deterministic order: variant N picks the first N angles from this list.
export const HOOK_ANGLE_ORDER = ['stat', 'question', 'objection', 'story', 'bold_claim'];

const angleClause = (angle) => {
  const spec = HOOK_ANGLES[angle];
  return spec
    ? `\n\n**Hook angle for this variant - "${spec.label}":**\n${spec.instruction}\nLet this angle shape the opening beat of \`description\`, the \`ending\`'s setup, and \`subject.character.lip_sync_line\`/\`audio.voiceover.line\` if either is used. The rest of the schema still reflects the same underlying idea.`
    : '';
};

// Shared by both video modes - only the user message above differs.
export const videoScriptSystem = (masterSchema) => `system_prompt:
  ## SYSTEM PROMPT: Structured Video Prompt Generator
  A - Ask:
    Generate a structured video prompt for cinematic generation, strictly based on the master schema provided in: ${masterSchema}.
    The final result must be a JSON object with exactly two top-level keys: \`title\` and \`final_prompt\`.

  G - Guidance:
    role: Creative Director
    output_count: 1
    character_limit: None
    constraints:
      - The output must be valid JSON.
      - The \`title\` field should contain a short, descriptive and unique title (max 15 words).
      - The \`final_prompt\` field must contain a **single-line JSON string** that follows the exact structure of the master schema with all fields preserved.
      - Do not include any explanations, markdown, or extra text - only the JSON object.
      - Escape all inner quotes in the \`final_prompt\` string so it is valid as a stringified JSON inside another JSON.
    tool_usage:
      - Ensure consistent alignment across all fields (camera, lighting, motion, etc.).
      - Maintain full structure even for optional fields (use "none", "", or [] as needed).

  N - Notation:
    format: JSON
    expected_output:
      {
        "title": "A unique short title for the scene",
        "final_prompt": "{...stringified JSON of the full prompt...}"
      }`;

// ============================================================================
// Instagram Carousel - a topic in, a 6-slide swipeable carousel plan out.
// ============================================================================

export const CAROUSEL_PLAN_SYSTEM = `ROLE: Instagram Carousel Content Planner

GOAL:
Turn a topic into a 6-slide swipeable Instagram carousel. Output ONE JSON object only, with a single key \`slides\`: an array of exactly 6 items, in order.

Each slide item has exactly three keys:
- \`headline\`: short punchy text for the slide, in TURKISH, max 8 words.
- \`body\`: one supporting sentence, in TURKISH, max 18 words. Empty string "" is fine for slides that are headline-only (typically slide 1 and slide 6).
- \`image_prompt\`: an English visual description (<=60 words) for the slide's background image - concrete subject, setting, mood, lighting, camera framing. Never describe adding text; the text is composited separately.

STRUCTURE (classic hook -> value -> CTA arc):
- Slide 1: the hook. Stops the scroll, states the topic's core promise or question.
- Slides 2-5: one concrete point, tip, step or fact each - a coherent sequence, not four random facts.
- Slide 6: a call to action (save/share/follow/comment) or a short wrap-up.

RULES:
- Turkish for headline/body, English for image_prompt.
- Keep a consistent visual thread across the 6 image_prompt values (same setting family, palette or subject) so the carousel feels like one design system, not six unrelated images.
- No copyrighted names, no fabricated statistics.
- JSON only - no markdown, no commentary, no extra keys.`;

export const carouselPlanUser = ({ idea, imageDescription }) => `Topic / idea:
${idea || '(none provided)'}

${imageDescription ? `Reference image analysis (keep the visual thread consistent with this where relevant):\n${imageDescription}` : 'No reference image was provided - invent a fitting, consistent visual style for the topic.'}

Produce the 6-slide carousel plan now, following the system rules exactly.`;

// ============================================================================
// 3D Karakter - a topic (and/or a reference image) becomes one prompt suited for
// image-to-3D / text-to-3D character generation (Tripo3D via fal.ai).
// ============================================================================

export const CHARACTER_PROMPT_SYSTEM = `ROLE: 3D Character Concept Prompt Builder

GOAL:
Turn a topic (and, if given, a reference image analysis) into one prompt suited for
image-to-3D or text-to-3D character generation. Output ONE JSON object only:
{ "title": "...", "prompt": "..." }

RULES:
- \`title\`: short label for this character, in TURKISH, max 8 words.
- \`prompt\`: ENGLISH, <=80 words. Must cover:
  - subject: what the character is
  - art style: pick whichever fits the idea (stylized, anime, realistic, low-poly, toon) -
    don't default to one look
  - pose: prefer a neutral standing pose (T-pose or relaxed A-pose) - this reconstructs and
    rigs far better than a dynamic action pose
  - materials/colors, and a closing clause requesting "single centered subject, plain
    neutral background, full body visible, no other objects" - clean isolation is essential
    for accurate 3D reconstruction.
- If a reference image was analyzed, stay faithful to its colors/design; do not invent new
  features that weren't described.
- Exactly one subject. Never describe a scene, a group, or multiple characters.

OUTPUT CONTRACT: JSON only - no markdown, no commentary.`;

export const characterPromptUser = ({ idea, imageDescription }) => `Topic / idea:
${idea || '(none provided)'}

${imageDescription ? `Reference image analysis (stay faithful to this):\n${imageDescription}` : 'No reference image was provided - design a fitting character from the topic alone.'}

Produce the { title, prompt } object now, following the system rules exactly.`;

// ============================================================================
// Shared final step: a ready-to-copy caption for whatever was produced.
// ============================================================================

export const socialCaptionUser = ({ idea, title, contentType, angle }) => {
  const kind = contentType === 'carousel'
    ? 'Instagram carousel post'
    : contentType === 'character3d'
      ? '3D character model reveal post'
      : 'short vertical video';
  const angleNote = angle && HOOK_ANGLES[angle]
    ? `\nThis caption is for the "${HOOK_ANGLES[angle].label}" hook variant - open the caption's first line with that same angle so it matches the video.`
    : '';
  return `You are writing a ready-to-post social media caption for a ${kind} - not inventing a new concept, just captioning the one already made.
---
### CONTEXT:
Content idea: ${idea || '(none provided)'}
Title/hook used: ${title}${angleNote}

Write the caption text for this ${kind}.
---
- MUST be under 200 characters (yes "characters", not word count). This is an absolute MUST.

### FINAL OUTPUT FORMAT (no markdown formatting):
DO NOT return any explanations. Only return the caption text.`;
};
