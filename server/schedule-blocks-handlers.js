import { isValidDate } from "./scheduling-handlers.js";
import {
  createScheduleBlocks,
  listScheduleBlocks,
  removeScheduleBlocks,
  ScheduleBlockError,
} from "./schedule-blocks-repository.js";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validIds(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && new Set(value).size === value.length && value.every((id) => typeof id === "string" && uuidPattern.test(id));
}

function validTimes(value) {
  return Array.isArray(value) && value.length > 0 && value.length <= 100
    && new Set(value).size === value.length
    && value.every((time) => typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time));
}

function sendError(response, error) {
  if (error instanceof ScheduleBlockError) {
    response.status(error.status).json({ ok: false, error: error.code, conflicts: error.conflicts });
    return;
  }
  console.error("Falha ao gerenciar bloqueios da agenda.");
  response.status(500).json({ ok: false, error: "internal_error" });
}

export function createListScheduleBlocksHandler(find = listScheduleBlocks) {
  return async function listBlocksHandler(request, response) {
    const date = request.query.date;
    const doctor = typeof request.query.doctor === "string" && request.query.doctor.trim()
      ? request.query.doctor.trim()
      : typeof request.query.doctorId === "string" ? request.query.doctorId : undefined;
    if (!isValidDate(date) || (doctor && doctor.length > 255)) {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      response.status(200).json({ ok: true, blocks: await find({ date, doctor }) });
    } catch (error) { sendError(response, error); }
  };
}

export function createPostScheduleBlocksHandler(create = createScheduleBlocks) {
  return async function postBlocksHandler(request, response) {
    const { doctorId, date, times, slotIds, reason } = request.body ?? {};
    if (!uuidPattern.test(doctorId ?? "") || !isValidDate(date)
      || (!validTimes(times) && !validIds(slotIds))
      || (reason !== undefined && (typeof reason !== "string" || reason.trim().length > 500))) {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      const blocks = await create({
        doctorId, date, times: validTimes(times) ? times : undefined,
        slotIds: validTimes(times) ? undefined : slotIds,
        reason: reason?.trim() || null,
        actorUserId: request.auth.user.id,
      });
      response.status(201).json({ ok: true, blocks });
    } catch (error) { sendError(response, error); }
  };
}

export function createDeleteScheduleBlocksHandler(remove = removeScheduleBlocks) {
  return async function deleteBlocksHandler(request, response) {
    const { blockIds } = request.body ?? {};
    if (!validIds(blockIds)) {
      response.status(400).json({ ok: false, error: "invalid_request" });
      return;
    }
    try {
      const result = await remove({ blockIds, actorUserId: request.auth.user.id });
      response.status(200).json({ ok: true, ...result });
    } catch (error) { sendError(response, error); }
  };
}
