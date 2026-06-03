# Pathway Mapping — Project Overview

## What this is

A set of standalone single-file HTML editors for building and exporting RMIT course pathway maps. No build step, no dependencies — each file is self-contained and works by opening it in a browser or hosting it on GitHub Pages.

## Live URLs (GitHub Pages)

- CI Compact editor: https://rmit-ve-learningexperience.github.io/Pathway-Mapper/Pathway%20Editor%20Compact.html
- FT editor: https://rmit-ve-learningexperience.github.io/Pathway-Mapper/FT%20Pathway%20Editor.html
- Full CI editor: https://rmit-ve-learningexperience.github.io/Pathway-Mapper/Pathway%20Editor.html

GitHub repo: https://github.com/RMIT-VE-LearningExperience/Pathway-Mapper.git

## Files

| File | Purpose |
|------|---------|
| `Pathway Editor Compact.html` | **Primary CI editor** — Creative Industries (515T), compact layout matching the original PDF spacing |
| `FT Pathway Editor.html` | **Primary FT editor** — Future Technologies (525T), 4 AQF levels (4–7) |
| `Pathway Editor.html` | Full-size CI editor — same data as compact but with more vertical spacing |
| `CI_Pathways_Mapping_Aug25.pdf` | Original CI pathway PDF (reference only, not committed to GitHub) |
| `FT_Pathway_Mapping_May26 (1).pdf` | Original FT pathway PDF (reference only, not committed to GitHub) |

PDFs are excluded via `.gitignore`.

## Editor features

- **Drag** nodes to reposition
- **Shift+click** to multi-select nodes; drag any selected node to move the group
- **Del key or ✕ Delete button** removes selection (single or multi)
- **Hover a node** → connection dots appear → drag to another node to draw an arrow
- **Click badge or h1** to edit the course code / title inline (contenteditable)
- **Click legend labels** to rename connection types inline
- **Inspector panel** (left sidebar) — click any node or edge to edit title, code, colour, connection type
- **Columns panel** — rename AQF levels, add/remove columns
- **⤓ Export ▾ dropdown** — PDF, PNG, Slide (1920×1080 16:9 for PowerPoint), JSON
- **⤒ Import JSON** — reload a previously exported map
- **Map switcher dropdown** in header — switch between CI and FT editors
- **? Tour button** — step-by-step onboarding tour (auto-shows on first visit, stored in localStorage)

## Architecture (per file)

Each HTML file is fully self-contained:

```
<style>          CSS — layout, nodes, edges, dropdowns, tour overlay
<body>           Header toolbar + left sidebar + canvas host
<script>         All JS — state, rendering, interaction, exports
  COLS[]         Column definitions (id, label, x, w)
  STYLES{}       Edge/connection type definitions (label, dash, width, cap)
  PALETTE[]      Colour swatches available in inspector
  nodes[]        Array of node objects {id, title, code, col, x, y, w, color}
  edges[]        Array of edge objects {id, from, to, style, color}
  seed()         Populates nodes[] and edges[] with the default map data
  renderCols()   Draws column background strips and labels
  renderNodes()  Renders node divs from nodes[]
  renderEdges()  Renders SVG bezier/straight paths from edges[]
  renderLegend() Builds editable legend items from STYLES{}
  buildMapCanvas()   Renders the full map to an offscreen canvas (used by PDF + PNG)
  buildSlideCanvas() Renders map scaled to 1920×1080 (used by Slide export)
  exportHTML()   Standalone HTML export (hidden, not in UI)
  Tour JS        Onboarding spotlight tour (injected at bottom of body)
```

## Node object shape

```js
{
  id: 'n1',           // unique string ID
  title: 'Diploma Graphic Design',
  code: 'C5409',
  col: 5,             // matches a COLS[].id (AQF level number)
  x: 450,             // canvas position (px)
  y: 96,
  w: 180,             // width (px)
  color: '#3f9c54'    // hex colour
}
```

## Edge object shape

```js
{
  id: 'e1',
  from: 'n2',         // node id
  to: 'n10',          // node id
  style: 'credit',    // key into STYLES{}
  color: '#3f9c54'
}
```

## Key layout constants

- **Compact editors**: row spacing `y = 50 + row * 46`, node `min-height: 40px`, font `10.5px`
- **Full editor**: row spacing `y = 80 + row * 72`, node `min-height: 54px`, font `11.5px`
- Board snaps to a 14px grid on drag
- Column gap is 15px between columns

## CI map structure (Pathway Editor Compact.html)

- **AQF Level 3** (col id: 3): 1 node — Cert III Clothing & Textile
- **AQF Level 4** (col id: 4): 8 nodes — Cert IV programs across design, fashion, screen/media, writing, photo
- **AQF Level 5** (col id: 5): 11 nodes — Diplomas
- **AQF Level 6** (col id: 6): 10 nodes — Associate/Advanced Degrees
- **AQF Level 7** (col id: 7): 15 nodes — Bachelor degrees

## FT map structure (FT Pathway Editor.html)

- **AQF Level 4** (col id: 4): 4 nodes — Cert IV Engineering Prep, Business Prep, ICT, Cyber Security
- **AQF Level 5** (col id: 5): 1 node — Diploma of Information Technology
- **AQF Level 6** (col id: 6): 13 nodes — AD026 Engineering Tech + 5 streams + Advanced Diplomas + Building + AD006 IT
- **AQF Level 7** (col id: 7): 12 nodes — 6 Bachelor of Engineering Honours + 2 Business + 4 IT

## What's not done yet / next steps

- **Cloudflare Worker + KV for map saving/sharing** — the intent is a `POST /save` endpoint that stores the JSON export and returns a short shareable URL, with a "Share" button in the editor toolbar. The RMIT Cloudflare account (`Lawrence.makoona@rmit.edu.au`) has an API token configured in `~/.claude/mcp.json` for local development.
- The `FT_Pathway_Mapping_Oct25 (1).pdf` has not been mapped yet — could be a third editor variant.

## Export formats

| Button | Format | Notes |
|--------|--------|-------|
| PDF | A3-proportional PDF | Built from canvas, no external lib |
| PNG | Full-resolution PNG | 2× DPR for sharpness |
| Slide | 1920×1080 PNG | Scaled to fit, white header bar + legend strip, for PowerPoint |
| JSON | JSON | Re-importable via Import JSON |
