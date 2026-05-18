export const promptLibraryVersion = "community-prompt-library-v9-panorama-expansion";

const modeGroups = {
  plan: new Set(["plan-axonometric", "plan-axonometric-view", "plan-render", "cad", "cadrender"]),
  edit: new Set(["upscale", "detail", "materialreplace", "lightingadjust", "styletransfer", "sharpen", "outpaint"]),
  series: new Set(["designseries"]),
  board: new Set(["materialboard"]),
  render: new Set(["photo", "panorama", "whitemodel", "sketch", "plan-axonometric-view", "plan-render", "cadrender"])
};

function hasMode(group, mode) {
  return modeGroups[group]?.has(mode) || false;
}

const imagegenSkillLines = [
  "IMAGEGEN_SKILL_PROMPT_METHOD:",
  "- First classify the image request before writing final_prompt: spatial render, design series, image edit, product/mockup, ad/marketing visual, UI/mockup, diagram/infographic, stylized concept, sketch-to-render, or free-form visual.",
  "- Use a concise production spec order when useful: use case -> asset type -> primary request -> input image roles -> scene/backdrop -> subject/space -> style/medium -> composition/framing -> lighting/mood -> palette -> materials/textures -> exact text -> constraints -> avoid.",
  "- For every uploaded image, assign a role explicitly: primary structure/edit target, reference image, style/material reference, composition reference, or supporting insert.",
  "- If exact readable text is requested, quote it verbatim and keep it short; otherwise avoid logos, watermarks, QR codes and unreadable UI text.",
  "- For public figures, branded contexts, satire, ecommerce or social-platform scenes: make the result clearly fictional or illustrative, avoid real endorsement claims, and avoid copying official logos unless the user explicitly asks and it is allowed.",
  "- For generic user prompts, add only practical composition, medium and quality details that directly support the request; do not add unrelated characters, brands, slogans or narrative objects."
];

function communityPromptExpansionLines(mode = "custom") {
  const lines = [
    "OPEN_COMMUNITY_PROMPT_EXPANSION:",
    "- Treat open prompt galleries as pattern libraries: extract artifact categories, hierarchy, invariants and control axes; do not copy viral prompt text verbatim.",
    "- For production use, prefer short labeled segments when a prompt contains many systems; for simple one-shot outputs, keep the prompt direct and uncluttered.",
    "- Decide one hero subject or artifact first; supporting details should clarify it, not compete with it.",
    "- Pick only the relevant mini-schema below; do not force every request into every category.",
    "ARTIFACT_MINI_SCHEMAS:",
    "- Photoreal / campaign image: real-world moment, subject action, framing, lighting source, believable textures, natural imperfections and restrained retouching.",
    "- Product / mockup: product geometry, label legibility, material finish, contact shadow, background, catalog or lifestyle context and no unintended restyling.",
    "- UI / app mockup: product purpose, screen frame, layout hierarchy, spacing, real interface components, typography, state and no concept-art language.",
    "- Typography / poster / ad: exact quoted copy, single occurrence count, type hierarchy, placement, contrast, composition, audience and no extra slogans.",
    "- Infographic / diagram / slide: audience, learning goal, required parts, data labels, arrows or relationships, visual hierarchy, whitespace and readable text.",
    "- Character / identity series: stable face/body/shape anchors, outfit or material anchors, expression/action changes, consistent camera rhythm and no identity drift.",
    "- Composite / multi-image edit: source image index, transplanted element, target position, unchanged background, matched scale, perspective, light, shadow and occlusion."
  ];

  if (mode === "custom") {
    lines.push("- Custom mode: preserve the user's implied artifact type, such as product shot, UI mockup, poster, diagram, logo, ad, character sheet or spatial render.");
    lines.push("- Custom mode: add spatial-render camera/circulation grammar only when the request is clearly a spatial render; for product, UI, poster, diagram, board, logo or edit requests, keep that artifact grammar instead.");
  }
  if (hasMode("render", mode)) {
    lines.push("- Spatial render expansion: define camera height, lens feel, vanishing-point discipline, focal zone, depth layers, circulation clearance and human-scale cues.");
  }
  if (mode === "panorama") {
    lines.push("- Panorama expansion: specify 2:1 equirectangular output, wrap-safe left/right edges, stable horizon, 360-degree continuity and no single-view crop.");
  }
  if (hasMode("edit", mode)) {
    lines.push("- Edit expansion: write CHANGE ONLY plus the named target, then repeat the untouched identity, geometry, camera, layout, color and non-target areas.");
  }
  if (hasMode("series", mode)) {
    lines.push("- Series expansion: borrow the character-consistency pattern for spaces; repeat spatial DNA, material anchors, lighting philosophy and recurring details across every view.");
  }
  if (hasMode("board", mode)) {
    lines.push("- Board expansion: treat the result as a design artifact with grid, hierarchy, sample scale and whitespace, not as a rendered room or random collage.");
  }
  return lines;
}

function communityPromptControlVocabulary(mode = "custom") {
  const lines = [
    "CONTROL_VOCABULARY:",
    "- Camera: framing, distance, eye height, angle, lens feel, crop, subject placement, negative space, foreground/midground/background and perspective discipline.",
    "- Lighting: time or condition, source direction, color temperature, shadow softness, indirect light, practical fixtures, exposure and highlight limits.",
    "- Materials: base material, grain, roughness, reflectivity, translucency, edge detail, joint logic, pattern scale and construction plausibility.",
    "- Palette: 4-6 bounded colors, contrast hierarchy, dominant/secondary/accent roles and no one-note hue wash.",
    "- Text: quote required copy exactly, specify placement and typography, demand no extra characters, and use high quality for dense or small labels.",
    "- Quality: choose concrete quality criteria such as crisp geometry, label legibility, clean silhouette, readable hierarchy, natural texture or stable identity."
  ];
  if (hasMode("plan", mode)) {
    lines.push("- Plan-specific vocabulary: outer contour, wall thickness, room adjacency, openings, door swings, circulation, footprints, cut walls and orthographic or weak-perspective view.");
  }
  if (hasMode("edit", mode)) {
    lines.push("- Edit-specific vocabulary: non-target areas, original crop, unchanged camera, unchanged object count, matched shadows, no saturation shift and no contrast drift.");
  }
  if (mode === "panorama") {
    lines.push("- Panorama-specific vocabulary: equirectangular wrap, stable horizon, left/right seam safety, 360-degree continuity, full surround environment and no fisheye single-frame crop.");
  }
  return lines;
}

const modulePresetRules = {
  custom: [
    "- Custom mode: treat this as an open default preset, not a hidden workflow.",
    "- Infer the artifact type from the user's latest text before writing visual details: render, design series, material board, edit, outpaint, facade, product scene, concept image, diagram-like visual or another named output.",
    "- If references exist without a primary image, treat them as open design evidence rather than mandatory composition templates.",
    "- State the chosen output clearly so the image model does not default to a generic interior render."
  ],
  "plan-axonometric": [
    "- Fixed colored floor-plan prompt: treat the uploaded plan as locked base geometry, not as loose inspiration.",
    "- Preserve every visible linework relationship: outer contour, wall centerlines/thickness, room shapes, adjacency, openings, door swings, window/stair positions, circulation, labels/dimensions when visible, fixed fixtures and main furniture footprints.",
    "- Convert the exact same footprints into a clean top-down colored floor plan with semantic room/function/material zones, wet-area cues, furniture color hierarchy and circulation readability.",
    "- Keep a strict top-down orthographic 2D plan camera; this step must not tilt, extrude or create perspective.",
    "- Do not move, simplify, redraw, add or remove any room, wall, opening or major furniture position; do not turn this step into an axonometric or eye-level render."
  ],
  "plan-axonometric-view": [
    "- Colored floor-plan to axonometric prompt: treat the uploaded colored floor plan as locked spatial geometry and semantic zoning, not as loose inspiration.",
    "- Preserve the visible wall/opening/furniture footprints, room relationships, circulation, scale, cut-wall logic, stair/window positions and material zones.",
    "- Re-express the same colored floor plan as a clearer high-precision axonometric view with orthographic or weak-perspective camera, stable projected footprint, readable wall height, visible wall thickness, proportional furniture volumes, controlled near/far depth, subtle 3D perspective compression and controlled shadows.",
    "- If a dragged paper view-angle reference is attached, match its rotation, crop, silhouette, foreshortening and near/far edge scale instead of choosing a new default isometric view.",
    "- Do not redraw, redesign, simplify, flatten to a 2D plan, turn into an eye-level render or change any major spatial/furniture position."
  ],
  "plan-render": [
    "- Axonometric-to-render: use the selected red-box region when present; otherwise infer one clear functional zone from the axonometric or plan-based guide.",
    "- Translate only that target zone into a believable eye-level viewpoint, not a full-plan or top-down view.",
    "- Preserve functional relationships, adjacency and circulation while translating the target zone into foreground, midground and background.",
    "- Name source area, room role, camera standing point, view direction, main openings, furniture/display systems, materials, fixtures and clutter limits."
  ],
  cad: [
    "- CAD extraction: prioritize structural wall lines, room boundaries, openings and long straight segments.",
    "- Ignore shadows, texture, hatches, furniture decoration and text unless they help identify major geometry.",
    "- The output should be a clean first-pass trace underlay, not a fully detailed construction drawing."
  ],
  cadrender: [
    "- CAD render: treat CAD/DXF/SVG linework as hard spatial constraint before adding design style.",
    "- Infer wall height, openings, ceiling logic, camera and room role from linework; remove all technical strokes from the final render.",
    "- Use references only after axes, room relationships, circulation and scale are stable."
  ],
  designseries: [
    "- Design series: define one project DNA before image-specific details: space type, material family, lighting logic, palette and render finish.",
    "- Assign each output a clear role such as exterior, lobby, suite, dining, bathroom, corridor, facade, detail or material moment.",
    "- Repeat the same design team language across all images while varying viewpoint, focal zone and composition."
  ],
  photo: [
    "- Site-photo render: preserve existing perspective, envelope, openings, columns, ceiling height, camera and scale cues.",
    "- Redesign finishes, furniture, lighting and styling as a renovation layer over the existing geometry.",
    "- Avoid shifting vanishing points, moving windows/columns or replacing the site with a copied reference room."
  ],
  panorama: [
    "- Panorama render: treat the prompt as a 360-degree equirectangular scene with a continuous wrap-around environment.",
    "- Preserve horizon stability, spatial continuity and believable left/right edge connection for seamless viewer rotation.",
    "- Avoid fisheye single-frame composition, cropped perspective, broken seams, duplicated edge objects and black border artifacts."
  ],
  whitemodel: [
    "- White model polish: preserve massing, camera, levels, openings, proportions and spatial hierarchy.",
    "- Add material systems, lighting, context and human-scale elements only where they clarify the design.",
    "- Avoid raw viewport artifacts, untextured gray clay surfaces, random decoration and impossible facade/interior details."
  ],
  sketch: [
    "- Sketch-to-real: preserve the sketch's composition, gesture, intended perspective, major volumes and design idea.",
    "- Resolve ambiguous lines into plausible architecture/interior elements with buildable materials and lighting.",
    "- Keep a realistic final output unless the user explicitly requests a sketchy hybrid style."
  ],
  upscale: [
    "- Quality enhance: preserve composition, geometry, object identity, materials, colors and subject matter.",
    "- Improve perceived resolution, clarity, denoising, white balance, local contrast and material readability.",
    "- Avoid hallucinated new furniture, changed finishes, over-sharpening halos or plastic texture."
  ],
  detail: [
    "- Detail enhance: if a selected area exists, enhance it first and keep non-selected areas stable.",
    "- Preserve layout, camera, walls, openings, main objects and design direction.",
    "- Add believable craft details: material grain, edge joints, fixtures, lighting layers, soft goods, display objects and scale cues.",
    "- Increase detail only where it supports function, material story or realism; avoid clutter and random luxury props."
  ],
  materialreplace: [
    "- Material replace: use the selected area as the target when present unless the user names a different target.",
    "- Change only the named material system, color, texture, reflectivity, roughness and craft details.",
    "- Preserve geometry, camera, object placement, lighting direction, shadows, spatial relationships and non-target areas.",
    "- Match material scale and construction logic; avoid turning material replacement into full style transfer unless requested."
  ],
  lightingadjust: [
    "- Lighting adjust: preserve space, geometry, furniture, material identity, object placement, camera and composition.",
    "- Define one lighting condition clearly: daylight, overcast, dusk, night, hospitality, showroom, task lighting or wall washing.",
    "- Balance exposure, shadow softness, color temperature, practical fixtures and indirect light; avoid blown windows and muddy shadows."
  ],
  styletransfer: [
    "- Style transfer: preserve architecture, camera, scale, openings, circulation and major object positions.",
    "- Replace material system, furniture language, fixtures, palette and styling grammar coherently.",
    "- Keep the new style buildable for the existing space; avoid a superficial color filter, surface-only recolor or unrecognizable redesign."
  ],
  materialboard: [
    "- Material board: create a visual proposal board with samples, swatches, close-ups, lighting mood and FF&E references.",
    "- Organize by material family and relationship, not random collage density.",
    "- Avoid readable labels, brand logos, watermark, paragraph text and single-room render composition unless requested."
  ],
  sharpen: [
    "- Sharpen: preserve all original content and color relationships.",
    "- Apply edge clarity and local contrast conservatively.",
    "- Avoid halos, crunchy texture, amplified noise, color shifts and fake detail."
  ],
  outpaint: [
    "- Outpaint: preserve original subject, camera, vanishing points, perspective, lighting, material scale and style.",
    "- Extend plausible surrounding architecture/interior context beyond the frame only, with matching geometry and surfaces.",
    "- Avoid visible seams, repeated objects, distorted perspective and style drift."
  ]
};

const modulePromptBlueprints = {
  custom: {
    output: "choose and name the artifact type implied by the latest user request before adding style",
    invariant: "explicit user constraints and any primary-image subject, camera, object identity, space logic or design information that the request depends on",
    transform: "compose the requested visual from text, references and canvas context without forcing a hidden workflow or generic interior-render default",
    risk: "do not default to generic interior render language when the user asks for board, product, facade, series, edit or concept output"
  },
  "plan-axonometric": {
    output: "clean colored architectural floor plan, strict top-down orthographic view",
    invariant: "all original linework relationships, outer contour, wall thickness/centerlines, room adjacency, openings, door swings, windows, stairs, circulation, fixed fixtures, major furniture footprints, relative scale and orientation",
    transform: "add restrained semantic color fills, room/function/material zones, wet-area cues, furniture color hierarchy and circulation readability while keeping a strict top-down orthographic 2D plan",
    risk: "reject axonometric views, 3D extrusion, human-eye views, simplified/redesigned layouts, moved walls/openings, added/missing rooms, perspective tilt and decorative style over geometry"
  },
  "plan-axonometric-view": {
    output: "high-precision axonometric view of the existing colored floor plan, orthographic or weak-perspective, with controlled 3D perspective depth and dragged view-angle matching when supplied",
    invariant: "all visible colored floor-plan relationships: wall/opening/furniture footprints, cut-wall logic, room adjacency, circulation, stair/window positions, scale, material zones and projected crop",
    transform: "recompose the locked colored floor plan into a cleaner axonometric view with stable projection, readable wall height, visible wall thickness, proportional furniture volumes, material clarity, controlled shadows, near/far depth and a precise 3D perspective impression",
    risk: "reject eye-level renders, flat 2D plans, redesigned layouts, moved walls/openings/furniture, default-camera drift, camera/crop mismatch with the supplied dragged reference and decorative style over geometry"
  },
  "plan-render": {
    output: "final eye-level architecture/interior effect render from a selected or inferred axonometric zone",
    invariant: "target zone, source-area clarity, room relationship, circulation, functional logic, openings, scale cues and main furniture/display arrangement",
    transform: "choose a believable camera standing point and translate the target zone into foreground, midground, background, materials, fixtures and atmosphere",
    risk: "reject remaining plan symbols, full-plan camera, unclear source zone, blueprint strokes, diagram labels, impossible perspective and copied reference rooms"
  },
  cad: {
    output: "clean first-pass CAD/SVG trace underlay",
    invariant: "major structural wall lines, openings, room boundaries, long straight segments and overall drawing proportions",
    transform: "separate useful linework from raster noise so the result can be traced or reused downstream",
    risk: "reject furniture decoration, hatches, shadows, texture, photo noise and overfitted construction-detail claims"
  },
  cadrender: {
    output: "realistic spatial render derived from CAD/DXF/SVG linework",
    invariant: "CAD axes, wall logic, openings, room relationships, circulation and scale",
    transform: "infer height, camera, materials, ceiling/lighting and furniture only after the technical geometry is stable",
    risk: "reject visible CAD strokes, colored-plan extrusion, arbitrary room changes and reference style overriding linework"
  },
  designseries: {
    output: "one image or set member belonging to a coherent design series",
    invariant: "one project DNA: space type, material family, lighting logic, palette, camera rhythm and render finish",
    transform: "vary each image by role, viewpoint, focal zone or detail scale while staying from the same project",
    risk: "reject unrelated mood images, random collage, inconsistent palettes, conflicting render finish and copied reference compositions"
  },
  photo: {
    output: "renovated site-photo-based design effect render",
    invariant: "site perspective, envelope, openings, columns, ceiling height, camera, scale cues and major geometry",
    transform: "replace finishes, FF&E, lighting, fixtures and styling as a renovation layer over the existing space",
    risk: "reject shifted vanishing points, moved windows/columns, impossible ceiling changes and reference-room replacement"
  },
  panorama: {
    output: "seamless 2:1 equirectangular 360-degree panorama",
    invariant: "horizon stability, full surround continuity, wrap-safe edges, consistent perspective behavior and coherent scene geometry across the full rotation",
    transform: "compose a believable 360-degree environment that reads cleanly in panorama viewers with stable lighting, geometry and edge continuity",
    risk: "reject fisheye single-view crops, broken wrap seams, duplicated edge objects, black borders, unstable horizon and partial-scene framing"
  },
  whitemodel: {
    output: "polished realistic visualization from a white model screenshot",
    invariant: "massing, camera, levels, openings, proportions, spatial hierarchy and design intent",
    transform: "add material systems, context, lighting, furniture and scale cues that clarify the design",
    risk: "reject raw viewport look, gray clay surfaces, random decoration, impossible facade/interior details and style-only polishing"
  },
  sketch: {
    output: "realistic architecture/interior render translated from sketch intent",
    invariant: "composition, gesture, perspective, main volumes, openings and conceptual design idea",
    transform: "resolve ambiguous lines into plausible buildable space with coherent materials, lighting and scale",
    risk: "reject losing the original idea, copying sketch strokes as final line art, impossible construction and generic room substitution"
  },
  upscale: {
    output: "same image with improved perceived quality",
    invariant: "composition, geometry, objects, materials, colors, subject matter and camera",
    transform: "improve clarity, denoising, white balance, local contrast and material readability",
    risk: "reject new furniture, changed finishes, plastic texture, over-sharpening halos and content hallucination"
  },
  detail: {
    output: "same scene with richer believable craft detail",
    invariant: "layout, camera, walls, openings, main objects, non-selected areas, design direction and scale",
    transform: "add material grain, edge joints, fixtures, lighting layers, soft goods, display objects and scale cues to the selected or implied target",
    risk: "reject clutter, random luxury props, moved architecture, changed camera and decorative noise"
  },
  materialreplace: {
    output: "targeted material replacement edit",
    invariant: "geometry, perspective, object placement, lighting direction, shadows, spatial relationships and non-target areas",
    transform: "change only named material system, color, texture, reflectivity and craft/junction details",
    risk: "reject full redesign, style transfer, changed furniture, inconsistent material scale and conflicting light behavior"
  },
  lightingadjust: {
    output: "same scene under a clearly defined lighting condition",
    invariant: "space, geometry, furniture, materials, object placement, camera, composition and non-lighting content",
    transform: "rebalance exposure, color temperature, shadow softness, indirect light, practical fixtures and highlight control",
    risk: "reject blown windows, muddy shadows, inconsistent light directions, fantasy glow and material identity changes"
  },
  styletransfer: {
    output: "same space with a coherent new design style language",
    invariant: "architecture, camera, scale, openings, circulation and major object positions",
    transform: "replace material system, furniture grammar, fixtures, palette, soft furnishing and styling logic",
    risk: "reject filter-only color changes, unbuildable style overlays, unrecognizable structure and conflicting reference languages"
  },
  materialboard: {
    output: "professional visual material/color/FF&E board",
    invariant: "design direction, material logic, palette relationship and quality benchmark from references",
    transform: "organize samples, swatches, texture close-ups, lighting mood and FF&E references into clear visual hierarchy",
    risk: "reject readable labels, brand logos, watermark, paragraph text, UI screenshot look and random collage density"
  },
  sharpen: {
    output: "same image with controlled edge clarity",
    invariant: "all original content, color relationships, geometry, camera and material identity",
    transform: "increase edge definition and local contrast conservatively",
    risk: "reject halos, crunchy texture, amplified noise, color shifts, fake details and redesign"
  },
  outpaint: {
    output: "expanded version of the same image",
    invariant: "original subject, camera, vanishing points, perspective, lighting direction, material scale and style",
    transform: "extend only surrounding architecture/interior context with matching geometry, surfaces and atmosphere",
    risk: "reject visible seams, repeated objects, distorted perspective, cropped subject and style drift"
  }
};

function modulePromptBlueprint(mode) {
  return modulePromptBlueprints[mode] || modulePromptBlueprints.custom;
}

function modulePresetLines(mode) {
  return modulePresetRules[mode] || modulePresetRules.custom;
}

export function communityPromptBlueprintLines(mode = "custom") {
  const blueprint = modulePromptBlueprint(mode);
  return [
    "MODULE_PROMPT_BLUEPRINT:",
    `- Output boundary: ${blueprint.output}.`,
    `- Non-negotiable invariants: ${blueprint.invariant}.`,
    `- Allowed transformation: ${blueprint.transform}.`,
    `- Failure guard: ${blueprint.risk}.`
  ];
}

export function communityPromptPreflightLines(mode = "custom") {
  return [
    "FINAL_PROMPT_PREFLIGHT:",
    "- Before final_prompt is accepted, verify it names the exact output artifact and does not contradict the selected workflow.",
    "- Verify preserve terms are more concrete than style terms whenever an input image exists.",
    "- Verify references are used as evidence and quality direction, not as permission to replace hard geometry.",
    "- Verify camera/view language matches the artifact: flat colored plan, axonometric view, eye-level render, board, edit or outpaint.",
    "- Verify text-heavy, UI, product, poster, diagram or composite requests keep their own artifact grammar instead of being converted into a generic render.",
    "- Verify avoid-lines target the likely failure for this mode instead of adding a generic negative-prompt dump.",
    `- Mode-specific failure guard: ${modulePromptBlueprint(mode).risk}.`
  ];
}

export function communityPromptKernel(mode = "custom") {
  const lines = [
    "- Community pattern: start with artifact, medium, audience, aspect ratio and success criteria before style words.",
    "- Use layered controls instead of one paragraph: subject/space, operation, composition, camera, materials, lighting, palette, details, quality, avoid-lines.",
    "- Make constraints concrete and visible: name exact zones, objects, surfaces, openings, scale cues and finish rather than generic adjectives.",
    "- Keep references evidence-based: describe what each image contributes, then say what must not be copied.",
    "- Use artifact-specific grammar: a UI screen needs layout and state, a poster needs type hierarchy, a product shot needs material and shadow, and a render needs spatial order.",
    "- For image-to-image tasks, state preserve boundaries before transformation goals.",
    "- Use negative instructions sparingly for likely failures only: watermarks, logos, unreadable text, UI overlay, geometry drift, collage, blur or artifacts."
  ];
  if (hasMode("render", mode)) {
    lines.push("- For spatial renders, control viewpoint, lens feel, perspective discipline, foreground/midground/background, scale, material behavior and lighting hierarchy.");
    lines.push("- For architecture/interior renders, tie every detail back to function, circulation, construction logic, material behavior or a deliberate focal point.");
  }
  if (mode === "panorama") {
    lines.push("- For panoramas, output a true 2:1 equirectangular surround image; prioritize seamless left/right wrap, stable horizon and full-room or full-environment continuity over dramatic single-shot framing.");
  }
  if (hasMode("series", mode)) {
    lines.push("- For series outputs, define one design DNA, then vary room role, camera distance, focal moment or detail scale without drifting palette and materials.");
  }
  if (hasMode("board", mode)) {
    lines.push("- For material boards, organize samples, swatches, texture close-ups and FF&E references into a proposal board; do not import multi-room series logic.");
  }
  if (hasMode("plan", mode)) {
    lines.push("- For floor-plan workflows, lock geometry, orientation, adjacency, openings and circulation before any style, material or camera language.");
  }
  if (hasMode("edit", mode)) {
    lines.push("- For edits, name the surgical target first, then repeat what must remain unchanged: object identity, count, composition, camera, geometry and boundaries.");
  }
  return lines;
}

export function communityPromptCompactRules(mode = "custom") {
  const lines = [
    "COMMUNITY_PROMPT_COMPACT_RULES:",
    "- Full community prompt-library guidance is injected only in GPT-IMAGE-2 PROMPT FUSION METHOD; do not paste it again here.",
    "- Apply the same compact structure: artifact -> operation -> preserve/transform -> composition/camera -> materials -> lighting -> palette -> details -> quality -> avoid.",
    "- Prefer specific visible nouns and constraints over stacked style adjectives."
  ];
  if (mode === "custom") {
    lines.push("- Custom mode: keep the user's implied artifact family explicit, especially product, UI, typography, diagram, ad, logo, composite or character work.");
  }
  if (hasMode("plan", mode)) {
    lines.push("- Plan modes: geometry fidelity outranks style; preserve layout before rendering or coloring.");
  }
  if (hasMode("edit", mode)) {
    lines.push("- Edit modes: change only the named target and keep composition, identity, geometry and camera stable.");
  }
  if (hasMode("series", mode)) {
    lines.push("- Series modes: repeat design DNA while varying shot role, focal zone and scale.");
  }
  if (hasMode("board", mode)) {
    lines.push("- Board mode: build a clean material/color/FF&E board, not a connected spatial series.");
  }
  lines.push(...modulePresetLines(mode).slice(0, 2));
  lines.push(...communityPromptBlueprintLines(mode).slice(1, 3));
  return lines;
}

export function communityModeControlLines(mode = "custom") {
  return [
    "COMMUNITY_MODE_REFINEMENT:",
    ...modulePresetLines(mode),
    ...communityPromptBlueprintLines(mode),
    ...communityPromptPreflightLines(mode)
  ];
}

export function communityPromptLibraryBlock({ mode = "custom", referenceCount = 0 } = {}) {
  const referenceRule = referenceCount > 0
    ? "- Reference images: read each image holistically, state visible evidence and usable contribution, then exclude exact composition, brands, watermarks and accidental artifacts."
    : "- No references: infer a coherent design direction from the user brief and selected workflow; avoid inventing irrelevant reference constraints.";
  return [
    `COMMUNITY_PROMPT_LIBRARY: ${promptLibraryVersion}`,
    "Distilled from public prompt-engineering guides and open prompt-library patterns; use as prompt construction guidance, not as content to copy verbatim.",
    "Recommended final_prompt order:",
    "CANVAS -> ARTIFACT/MEDIUM -> TASK -> INPUT/REFERENCES -> PRESERVE -> TRANSFORM -> SUBJECT/SPACE -> COMPOSITION/CAMERA -> MATERIALS -> LIGHTING -> PALETTE -> DETAILS -> QUALITY -> AVOID.",
    "Community prompt disciplines:",
    "- Put the desired output format and audience before decorative style modifiers.",
    "- Separate controllable visual systems; do not bury camera, material, light and palette in one vague sentence.",
    "- Use concrete nouns and measurable boundaries: room type, zone, opening, furniture system, surface finish, fixture type, color family, scale cue.",
    "- For edits and reference workflows, lead with invariants, then describe the allowed transformation.",
    "- For exact text, UI screens, posters, diagrams and product mockups, keep layout, type hierarchy, label placement and legibility constraints explicit.",
    "- Keep negative prompts targeted to likely model failures instead of long generic ban lists.",
    referenceRule,
    ...imagegenSkillLines,
    ...communityPromptKernel(mode),
    ...communityPromptExpansionLines(mode),
    ...communityPromptControlVocabulary(mode),
    ...communityModeControlLines(mode)
  ].join("\n");
}
