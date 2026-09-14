// Prompts carried over from the n8n workflow, kept as close to the originals as possible
// so the web app produces the same kind of output as the automation it replaces.

// "Set Master Prompt" node: the schema every generated video prompt must follow.
export const MASTER_PROMPT_SCHEMA = `{
  "description": "Brief narrative description of the scene, focusing on key visual storytelling and product transformation.",
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
    "main physical items involved (product box, accessories, vehicles...)",
    "include brand visibility (logos, packaging, texture...)"
  ],
  "subject": {
    "character": {
      "description": "optional - physical description, outfit",
      "pose": "optional - position or gesture",
      "lip_sync_line": "optional - spoken line if there's a voiceover"
    },
    "product": {
      "brand": "Brand name",
      "model": "Product model or name",
      "action": "description of product transformation or assembly"
    }
  },
  "motion": {
    "type": "e.g. transformation, explosion, vortex",
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

// "OpenAI Vision: Analyze Reference Image" node.
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

// "Generate Image Prompt" agent node.
export const IMAGE_PROMPT_SYSTEM = `ROLE: UGC Image Prompt Builder

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

export const imagePromptUser = ({ caption, imageDescription }) => `Your task is to create an image prompt following the system guidelines.
Ensure that the reference image is represented as **accurately as possible**, including all text elements.

Use the following inputs:

- **User's description:**
${caption || '(none provided)'}

- **Reference image description:**
${imageDescription}`;

// "AI Agent: Generate Video Script" node.
export const videoScriptSystem = (masterSchema) => `system_prompt:
  ## SYSTEM PROMPT: Structured Video Ad Prompt Generator
  A - Ask:
    Generate a structured video ad prompt for cinematic generation, strictly based on the master schema provided in: ${masterSchema}.
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

export const videoScriptUser = ({ caption, imageDescription, model }) => `Create a UGC-style video prompt using both the reference image and the user description.

**Inputs**
- User description (optional):
  \`${caption || '(none provided)'}\`
- Reference image analysis (stay strictly faithful to what's visible):
  \`${imageDescription}\`

**Rules**
- Keep the style casual, authentic, and realistic. Avoid studio-like or cinematic language.
- Default model: \`${model || 'veo3_fast'}\`.
- Output only **one JSON object** with the keys: \`title\` and \`final_prompt\`.`;

// "Rewrite Caption with GPT-4o" node.
export const captionUser = ({ idea, title }) => `You are rewriting a TikTok video script, caption, and overlay -
not inventing a new one. You must follow this format and obey
these rules strictly.
---
### CONTEXT:
Here is the content idea to use: ${idea || '(none provided)'}

and the Title is : ${title}


Write the caption text using the topic.

---
- MUST be under 200 characters (yes "Characters" not wordcount)
this is an absolute MUST, no more than 200 characters!!!

### FINAL OUTPUT FORMAT (no markdown formatting):

DO NOT return any explanations. Only return the Caption Text`;
