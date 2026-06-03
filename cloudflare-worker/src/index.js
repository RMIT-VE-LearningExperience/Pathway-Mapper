const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,x-edit-token",
  "access-control-max-age": "86400"
};

const MAX_VIEW_BYTES = 900000;
const EDITORS = new Set(["ci-compact", "ci-full", "ft"]);

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
  requireEditToken(request, existing);

  await env.PATHWAY_VIEWS.delete(viewKey(id));
  await env.PATHWAY_VIEWS.delete(metaKey(existing.editor, id));
  return json({ ok: true });
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

function cleanName(value) {
  return String(value || "").trim().slice(0, 120);
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
