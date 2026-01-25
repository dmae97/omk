# Gemini Image

Generate or edit images using Gemini image models.

<instruction>
Provide structured parameters for best results. The tool assembles them into an optimized prompt.

When using multiple `input_images`, describe each image's role in the `subject` or `scene` field:
- "Use Image 1 for the character's face and outfit, Image 2 for the pose, Image 3 for the background environment"
- "Match the color palette from Image 1, apply the lighting style from Image 2"
</instruction>

<output>
Returns the generated image saved to disk. The response includes the file path where the image was written.
</output>

<important>
- For photoreal: add "ultra-detailed, realistic, natural skin texture" to style
- For posters/cards: use 9:16 aspect ratio with negative space for text placement
- For iteration: use `changes` to make targeted adjustments rather than regenerating from scratch
- For text: add "sharp, legible, correctly spelled" for important text; keep text short
- For diagrams: include "scientifically accurate" in style and provide facts explicitly
</important>