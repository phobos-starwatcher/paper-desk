---
name: paper-desk
description: Open papers, textbooks, or technical documents in the Codex 文献对读 PDF reader for side-by-side reading with a layout-preserving Simplified Chinese translation, linked selection, and questions grounded in the source. Use when the user wants to open or compare a PDF in the reader. Keep ordinary summaries in chat.
---

# 文献对读

- Use the local PDF the user provided or the local PDF associated with their attachment. For a source link, use the corresponding PDF when available; the reader does not open webpages or EPUB files. Do not pass an opaque attachment URI as a disk path.
- Call the `open_paper` MCP tool titled **打开文献对读** with the absolute `path`. If the user supplied a page-aligned Chinese PDF, also pass its absolute `translation` path. The result opens the reader. Only pass files belonging to this request.
- Opening a PDF does not start translation. In the translation pane, the user can choose a model (or keep the Codex default) and click **开始翻译**. This uses their local Codex login without a separate API key. Do not start translation on their behalf when they only ask to open a document. Do not claim translation is complete until the reader reports it.
- The same tool can open the built-in demo without a path (use `demo: true`). Keep it distinct from the user's document.
