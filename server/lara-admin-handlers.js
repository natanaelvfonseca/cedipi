import {
  addLaraKnowledge, listLaraKnowledge, listLaraHandoffs,
  setLaraKnowledgeActive, closeLaraHandoff,
} from "./lara-inbox-repository.js";

export function createListLaraKnowledgeHandler(list = listLaraKnowledge) {
  return async (_req, res) => {
    try {
      res.status(200).json({ ok: true, sources: await list() });
    } catch {
      res.status(503).json({ ok: false, error: "lara_knowledge_unavailable" });
    }
  };
}
export function createAddLaraKnowledgeHandler(add = addLaraKnowledge) {
  return async (req, res) => {
    const title = typeof req.body?.title === "string" ? req.body.title.trim() : "";
    const content = typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!title || title.length > 200 || !content || content.length > 40000) {
      res.status(400).json({ ok: false, error: "invalid_knowledge_source" });
      return;
    }
    try {
      res.status(201).json({ ok: true, source: await add({ title, content }) });
    } catch {
      res.status(503).json({ ok: false, error: "lara_knowledge_unavailable" });
    }
  };
}
export function createListLaraHandoffsHandler(list = listLaraHandoffs) {
  return async (_req, res) => {
    try {
      res.status(200).json({ ok: true, handoffs: await list() });
    } catch {
      res.status(503).json({ ok: false, error: "lara_handoffs_unavailable" });
    }
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createPatchLaraKnowledgeHandler(update = setLaraKnowledgeActive) {
  return async (req, res) => {
    if (!uuidPattern.test(req.params.sourceId ?? "") ||
        typeof req.body?.active !== "boolean") {
      res.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      const source = await update(req.params.sourceId, req.body.active);
      if (!source) res.status(404).json({ ok: false, error: "not_found" });
      else res.status(200).json({ ok: true, source });
    } catch {
      res.status(503).json({ ok: false, error: "lara_knowledge_unavailable" });
    }
  };
}

export function createCloseLaraHandoffHandler(close = closeLaraHandoff) {
  return async (req, res) => {
    if (!uuidPattern.test(req.params.id ?? "")) {
      res.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      const handoff = await close(req.params.id);
      if (!handoff) res.status(404).json({ ok: false, error: "not_found" });
      else res.status(200).json({ ok: true, handoff });
    } catch {
      res.status(503).json({ ok: false, error: "lara_handoffs_unavailable" });
    }
  };
}
