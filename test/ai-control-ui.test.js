import assert from "node:assert/strict";
import test from "node:test";
import { getAiControl, patchAiControl } from "../app/ai-control-api.ts";
import {
  aiControlPresentation,
  aiControlReducer,
  initialAiControlState,
  isAiControlSwitchDisabled,
} from "../app/ai-control-model.ts";

test("GET globalEnabled=true apresenta Lara ativa", async () => {
  const enabled = await getAiControl(undefined, async () => Response.json({ ok: true, globalEnabled: true }));
  assert.equal(enabled, true);
  assert.equal(aiControlPresentation(enabled).status, "Ativa");
});

test("GET globalEnabled=false apresenta Lara pausada", async () => {
  const enabled = await getAiControl(undefined, async () => Response.json({ ok: true, globalEnabled: false }));
  assert.equal(enabled, false);
  assert.equal(aiControlPresentation(enabled).status, "Pausada");
});

for (const enabled of [false, true]) {
  test(`alteração envia PATCH enabled=${enabled}`, async () => {
    let request;
    const result = await patchAiControl(enabled, async (url, options) => {
      request = { url, options };
      return Response.json({ ok: true, globalEnabled: enabled });
    });

    assert.equal(request.url, "/api/ai-control");
    assert.equal(request.options.method, "PATCH");
    assert.deepEqual(JSON.parse(request.options.body), { enabled });
    assert.equal(result, enabled);
  });
}

test("switch fica bloqueado durante PATCH", () => {
  const state = aiControlReducer(
    { ...initialAiControlState, loading: false, globalEnabled: true },
    { type: "save_started" },
  );
  assert.equal(state.saving, true);
  assert.equal(isAiControlSwitchDisabled(state), true);
});

test("falha no PATCH restaura o estado anterior", () => {
  const saving = aiControlReducer(
    { ...initialAiControlState, loading: false, globalEnabled: false },
    { type: "save_started" },
  );
  const failed = aiControlReducer(saving, { type: "save_failed", previousEnabled: false });
  assert.equal(failed.globalEnabled, false);
  assert.equal(failed.saving, false);
  assert.equal(failed.error, "save");
});

test("falha no GET não assume Lara ativa", () => {
  const state = aiControlReducer(initialAiControlState, { type: "load_failed" });
  assert.equal(state.globalEnabled, null);
  assert.equal(isAiControlSwitchDisabled(state), true);
  assert.equal(aiControlPresentation(state.globalEnabled).status, "Status indisponível");
});

test("cada carregamento consulta novamente o GET da API", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return Response.json({ ok: true, globalEnabled: calls === 1 });
  };

  assert.equal(await getAiControl(undefined, fetchImpl), true);
  assert.equal(await getAiControl(undefined, fetchImpl), false);
  assert.equal(calls, 2);
});
