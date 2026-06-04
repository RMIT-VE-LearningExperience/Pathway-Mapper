const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-edit-token",
  "access-control-max-age": "86400"
};

const MAX_VIEW_BYTES = 900000;
const MAX_GENERATE_TEXT_BYTES = 120000;
const EDITORS = new Set(["ci-compact", "ci-full", "ft"]);
const PALETTE = [
  "#3f9c54",
  "#4aa1a6",
  "#e07a52",
  "#d4543a",
  "#3aa0d6",
  "#2c7fbf",
  "#f06ba8",
  "#d6202a",
  "#2e3b8c",
  "#7d3fa0",
  "#c0392b",
  "#1b2a4a"
];

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/health" && request.method === "GET") {
        return json({ ok: true, service: "pathway-editor-views" });
      }

      if (url.pathname === "/views" && request.method === "GET") {
        return listViews(env, url.searchParams.get("editor"));
      }

      if (url.pathname === "/views" && request.method === "POST") {
        return createView(request, env);
      }

      if (url.pathname === "/generate-pathway" && request.method === "POST") {
        return generatePathway(request, env);
      }

      const match = url.pathname.match(/^\/views\/([a-zA-Z0-9_-]+)$/);
      if (match && request.method === "GET") {
        return getView(env, match[1]);
      }

      if (match && request.method === "PUT") {
        return updateView(request, env, match[1]);
      }

      if (match && request.method === "DELETE") {
        return deleteView(request, env, match[1]);
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: err.message || "Unexpected error" }, 500);
    }
  }
};

async function listViews(env, editor) {
  if (editor && !EDITORS.has(editor)) {
    return json({ error: "Unknown editor" }, 400);
  }

  const prefix = editor ? `meta:${editor}:` : "meta:";
  const listed = await env.PATHWAY_VIEWS.list({ prefix });
  const views = [];

  for (const key of listed.keys) {
    const meta = await env.PATHWAY_VIEWS.get(key.name, "json");
    if (meta) views.push(meta);
  }

  views.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return json({ views });
}

async function getView(env, id) {
  const record = await env.PATHWAY_VIEWS.get(viewKey(id), "json");
  if (!record) return json({ error: "View not found" }, 404);
  return json(publicRecord(record));
}

async function createView(request, env) {
  const body = await readJson(request);
  const record = buildRecord(body);

  await writeRecord(env, record);
  return json(publicRecord(record, true), 201);
}

async function updateView(request, env, id) {
  const existing = await env.PATHWAY_VIEWS.get(viewKey(id), "json");
  if (!existing) return json({ error: "View not found" }, 404);
  requireEditToken(request, existing);

  const body = await readJson(request);
  const updated = {
    ...existing,
    name: cleanName(body.name || existing.name),
    title: cleanName(body.title || existing.title),
    badge: cleanName(body.badge || existing.badge),
    data: validateData(body.data || existing.data),
    updatedAt: new Date().toISOString()
  };

  await writeRecord(env, updated);
  return json(publicRecord(updated));
}

async function deleteView(request, env, id) {
  const existing = await env.PATHWAY_VIEWS.get(viewKey(id), "json");
  if (!existing) return json({ error: "View not found" }, 404);

  await env.PATHWAY_VIEWS.delete(viewKey(id));
  await env.PATHWAY_VIEWS.delete(metaKey(existing.editor, id));
  return json({ ok: true });
}

async function generatePathway(request, env) {
  if (!env.VAL_API_KEY) {
    return json({ error: "VAL_API_KEY is not configured on the Worker" }, 400);
  }

  const body = await readJson(request);
  const editor = validateEditor(body.editor);
  const prompt = cleanLongText(body.prompt || "", 6000);
  const sourceText = cleanLongText(body.text || "", MAX_GENERATE_TEXT_BYTES);
  const image = validateImageInput(body.image);
  if (!prompt && !sourceText && !image) {
    return json({ error: "Add a prompt, upload a document, or upload an image first" }, 400);
  }

  const current = body.current && typeof body.current === "object" ? body.current : {};
  const cols = Array.isArray(current.cols) && current.cols.length ? current.cols : defaultCols(editor);
  const title = cleanName(body.title || current.title || "");
  const valResult = await callVal(env, {
    editor,
    title,
    prompt,
    sourceText,
    image,
    cols
  });
  const map = buildMapFromVal(valResult, cols, editor);

  return json({
    ok: true,
    title: cleanName(valResult.title || title || "Generated pathway map"),
    badge: cleanName(valResult.badge || ""),
    data: map,
    notes: Array.isArray(valResult.notes) ? valResult.notes.slice(0, 8).map(cleanName) : []
  });
}

function buildRecord(body) {
  const now = new Date().toISOString();
  const id = crypto.randomUUID().split("-")[0];
  const editor = validateEditor(body.editor);

  return {
    id,
    editor,
    name: cleanName(body.name || body.title || "Untitled view"),
    title: cleanName(body.title || ""),
    badge: cleanName(body.badge || ""),
    data: validateData(body.data),
    editToken: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now
  };
}

function validateImageInput(image) {
  if (!image || typeof image !== "object") return null;
  const mime = String(image.type || "").toLowerCase();
  const dataUrl = String(image.dataUrl || "");
  const name = cleanName(image.name || "uploaded image");
  if (!/^image\/(png|jpe?g|webp)$/.test(mime)) {
    throw new Error("Only PNG, JPEG, and WebP images are supported");
  }
  if (!dataUrl.startsWith(`data:${mime};base64,`)) {
    throw new Error("Invalid image upload");
  }
  if (dataUrl.length > 6_000_000) {
    throw new Error("Image is too large. Use a smaller screenshot or image.");
  }
  return { name, type: mime, dataUrl };
}

async function writeRecord(env, record) {
  await env.PATHWAY_VIEWS.put(viewKey(record.id), JSON.stringify(record));
  await env.PATHWAY_VIEWS.put(metaKey(record.editor, record.id), JSON.stringify(metaRecord(record)));
}

function publicRecord(record, includeEditToken = false) {
  const response = {
    ...metaRecord(record),
    data: record.data
  };
  if (includeEditToken) response.editToken = record.editToken;
  return response;
}

function metaRecord(record) {
  return {
    id: record.id,
    editor: record.editor,
    name: record.name,
    title: record.title,
    badge: record.badge,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function viewKey(id) {
  return `view:${id}`;
}

function metaKey(editor, id) {
  return `meta:${editor}:${id}`;
}

function validateEditor(editor) {
  if (!EDITORS.has(editor)) {
    throw new Error("Unknown editor");
  }
  return editor;
}

function validateData(data) {
  if (!data || typeof data !== "object") {
    throw new Error("Missing view data");
  }
  if (!Array.isArray(data.cols) || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error("View data must include cols, nodes, and edges arrays");
  }

  const encoded = JSON.stringify(data);
  if (encoded.length > MAX_VIEW_BYTES) {
    throw new Error("View data is too large");
  }
  return data;
}

async function callVal(env, input) {
  const baseUrl = String(env.VAL_API_BASE_URL || "https://val-npe.rmit.edu.au/api").replace(/\/+$/, "");
  const model = env.VAL_MODEL || "val-gpt-4o";
  const schemaHint = {
    title: "Short map title",
    badge: "Optional school or portfolio code",
    qualifications: [
      {
        id: "stable unique id such as q1",
        title: "Qualification name",
        code: "Course code if known",
        aqfLevel: 4,
        discipline: "Short grouping label",
        color: "#3f9c54"
      }
    ],
    connections: [
      {
        from: "source id or code",
        to: "target id or code",
        style: "credit",
        rationale: "Short reason"
      }
    ],
    notes: ["Short caveats about assumptions"]
  };

  const userPayload = {
    requestedEditor: input.editor,
    currentTitle: input.title,
    availableColumns: input.cols.map((c) => ({ id: c.id, label: c.label })),
    requestedOutputShape: schemaHint,
    userInstructions: input.prompt,
    sourceText: input.sourceText,
    imageInstructions: input.image
      ? `The uploaded image is named ${input.image.name}. Read visible pathway/table/course information from it and infer the map only from visible content.`
      : ""
  };

  const userContent = input.image
    ? [
        { type: "text", text: JSON.stringify(userPayload) },
        { type: "image_url", image_url: { url: input.image.dataUrl } }
      ]
    : JSON.stringify(userPayload);

  const messages = [
    {
      role: "system",
      content: [
        "You build RMIT pathway editor data from curriculum notes.",
        "Return only a JSON object. Do not include markdown.",
        "Extract qualifications and pathway connections from supplied text and any uploaded image.",
        "Use aqfLevel values that match the provided columns where possible.",
        "Use connection style credit for guaranteed entry with credits, guar for guaranteed entry, await for awaiting approval, and nope for not guaranteed.",
        "Do not invent course codes. Leave code empty if unknown."
      ].join(" ")
    },
    {
      role: "user",
      content: userContent
    }
  ];

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "authorization": `Bearer ${env.VAL_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error("VAL_AUTH_EXPIRED");
    }
    const detail = payload.error?.message || payload.detail || `VAL request failed with ${res.status}`;
    return Promise.reject(new Error(detail));
  }

  const raw = payload.choices?.[0]?.message?.content;
  if (!raw) throw new Error("VAL returned no text output");
  return parseJsonObject(raw);
}

function buildMapFromVal(result, cols, editor) {
  const qualifications = Array.isArray(result.qualifications) ? result.qualifications : [];
  if (!qualifications.length) {
    throw new Error("VAL did not return any qualifications");
  }

  const cleanCols = cols.map((c, i) => ({
    id: Number(c.id) || i + 1,
    label: cleanName(c.label || `Level ${i + 1}`),
    x: Number(c.x) || 20 + i * 230,
    w: Number(c.w) || 210
  }));
  const colorByDiscipline = new Map();
  const idByToken = new Map();
  const groups = new Map();

  const nodes = qualifications.slice(0, 140).map((q, index) => {
    const col = findBestColumn(cleanCols, q.aqfLevel);
    const discipline = cleanName(q.discipline || q.title || "Pathway");
    if (!colorByDiscipline.has(discipline)) {
      colorByDiscipline.set(discipline, cleanColor(q.color) || PALETTE[colorByDiscipline.size % PALETTE.length]);
    }
    const groupKey = String(col.id);
    const row = groups.get(groupKey) || 0;
    groups.set(groupKey, row + 1);
    const id = `n${index + 1}`;
    const code = cleanName(q.code || "");
    const sourceId = cleanName(q.id || "");
    [sourceId, code, q.title].filter(Boolean).forEach((token) => idByToken.set(normalToken(token), id));
    return {
      id,
      title: cleanName(q.title || code || `Qualification ${index + 1}`),
      code,
      col: col.id,
      color: colorByDiscipline.get(discipline),
      x: col.x + 15,
      y: 70 + row * 86,
      w: editor === "ft" ? 182 : 184
    };
  });

  const edges = [];
  (Array.isArray(result.connections) ? result.connections : []).slice(0, 220).forEach((connection) => {
    const from = idByToken.get(normalToken(connection.from));
    const to = idByToken.get(normalToken(connection.to));
    if (!from || !to || from === to) return;
    const source = nodes.find((n) => n.id === from);
    edges.push({
      id: `e${edges.length + 1}`,
      from,
      to,
      style: ["await", "guar", "credit", "nope"].includes(connection.style) ? connection.style : "guar",
      color: source?.color || PALETTE[0]
    });
  });

  return validateData({
    cols: cleanCols,
    styles: defaultStyles(),
    nodes,
    edges,
    lineRouting: "straight"
  });
}

function findBestColumn(cols, aqfLevel) {
  const level = Number(aqfLevel);
  if (Number.isFinite(level)) {
    const direct = cols.find((c) => Number(c.id) === level);
    if (direct) return direct;
    const labelled = cols.find((c) => String(c.label).includes(String(level)));
    if (labelled) return labelled;
  }
  return cols[Math.min(cols.length - 1, Math.max(0, Math.floor(cols.length / 2)))] || { id: 1, label: "Level", x: 20, w: 210 };
}

function defaultCols(editor) {
  const w = 230;
  if (editor === "ft") {
    return [
      { id: 4, label: "AQF Level 4", x: 20, w },
      { id: 5, label: "AQF Level 5", x: 270, w },
      { id: 6, label: "AQF Level 6", x: 520, w },
      { id: 7, label: "AQF Level 7", x: 770, w }
    ];
  }
  return [
    { id: 3, label: "AQF Level 3", x: 20, w },
    { id: 4, label: "AQF Level 4", x: 270, w },
    { id: 5, label: "AQF Level 5", x: 520, w },
    { id: 6, label: "AQF Level 6", x: 770, w },
    { id: 7, label: "AQF Level 7", x: 1020, w }
  ];
}

function defaultStyles() {
  return {
    await: { label: "Awaiting approval — guaranteed entry on completion", w: 2, dash: "6 5", cap: "butt" },
    guar: { label: "Guaranteed entry on completion", w: 2, dash: "1 4", cap: "round" },
    credit: { label: "Guaranteed entry on completion with credits", w: 3.4, dash: "none", cap: "butt" },
    nope: { label: "Not guaranteed — credits if applicant accepted", w: 2, dash: "2 6", cap: "round" }
  };
}

function parseJsonObject(raw) {
  const text = String(raw).trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error("VAL returned invalid JSON");
  }
}

function cleanName(value) {
  return String(value || "").trim().slice(0, 120);
}

function cleanLongText(value, max) {
  return String(value || "").trim().slice(0, max);
}

function cleanColor(value) {
  const color = String(value || "").trim();
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "";
}

function normalToken(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function requireEditToken(request, record) {
  const token = request.headers.get("x-edit-token");
  if (!token || token !== record.editToken) {
    throw new Error("Valid edit token required");
  }
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be JSON");
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
