# Read

Reads a file from the local filesystem.

<instruction>
- Reads up to {{DEFAULT_MAX_LINES}} lines by default
- Use `offset` and `limit` for large files
- Use `lines: true` to include line numbers
- Supports images (PNG, JPG), PDFs, and Jupyter notebooks
- For directories, use the ls tool instead
- Parallelize reads when exploring related files
</instruction>

<output>
- Returns file content as text
- Images: returns visual content for analysis
- PDFs/notebooks: returns extracted text/cells
- Empty files: triggers a warning
- Missing files: returns closest filename matches for correction
</output>
