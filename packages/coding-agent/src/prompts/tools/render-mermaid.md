Convert Mermaid graph source into ASCII diagram output.

Parameters:
- `mermaid` (required): Mermaid graph text to render.
- `config` (optional): JSON render configuration (spacing and layout options).
Behavior:
- Returns ASCII diagram text.
- Saves full ASCII output to an artifact URL (`artifact://<id>`) when artifact storage is available.
- Returns an error when the Mermaid input is invalid or rendering fails.