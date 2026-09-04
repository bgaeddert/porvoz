import Busboy from "busboy";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { createAppService } from "../electron/app-service.js";
import { createDatabaseLogStore } from "./database-log-store.js";

const JSON_LIMIT_BYTES = 2 * 1024 * 1024;

export function createPorvozHttpServer({ store, adminKey, host = "127.0.0.1", port = 0 }) {
  if (!adminKey) throw new Error("PORVOZ_ADMIN_KEY is required.");
  const logStore = createDatabaseLogStore(store.getDatabase(), {
    maxEntries: store.getLimits().maxLogEntries
  });
  const service = createAppService(store, logStore);
  const server = http.createServer((request, response) => {
    handleRequest(request, response).catch((error) => sendError(response, error));
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, resolve);
      });
      return server.address();
    },
    async close() {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      store.close();
    },
    server
  };

  async function handleRequest(request, response) {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const controller = new AbortController();
    response.once("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { status: "ok" });
    }

    const auth = authenticate(request);
    if (!auth) return sendOpenAiError(response, 401, "Invalid or missing API key.", "invalid_api_key");

    if (request.method === "GET" && url.pathname === "/v1/models") {
      const settings = store.getSettings();
      const profiles = auth.type === "admin"
        ? settings.profiles
        : settings.profiles.filter((profile) => profile.id === auth.profileId);
      return sendJson(response, 200, {
        object: "list",
        data: profiles.map(publicModel)
      });
    }

    if (request.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
      const multipart = await readMultipart(request, store.getLimits().maxUploadBytes);
      const profileId = auth.type === "admin" ? multipart.fields.model : auth.profileId;
      if (!profileId) return sendOpenAiError(response, 400, "The desktop client must send a profile ID in model.", "invalid_request_error");
      if (multipart.fields.response_format && multipart.fields.response_format !== "json") {
        return sendOpenAiError(response, 400, "Porvoz supports only the json transcription response format.", "invalid_request_error");
      }
      if (!multipart.file) return sendOpenAiError(response, 400, "A transcription audio file is required.", "invalid_request_error");
      const context = parseContext(multipart.fields.porvoz_context);
      const transcription = await service.transcribe({
        audio: multipart.file.data,
        mimeType: multipart.file.mimeType,
        profileId
      }, { signal: controller.signal });
      const instruction = await service.instruct({
        transcript: transcription.transcript,
        logGroupId: transcription.logGroupId,
        profileId,
        clipboardText: context.clipboard
      }, { signal: controller.signal });
      return sendJson(response, 200, {
        text: instruction.transcript,
        porvoz: {
          raw_transcript: transcription.transcript,
          instruction_applied: instruction.instructionApplied,
          log_group_id: transcription.logGroupId
        }
      });
    }

    if (auth.type !== "admin") {
      return sendOpenAiError(response, 403, "This endpoint requires the admin API key.", "permission_denied");
    }

    if (request.method === "GET" && url.pathname === "/v1/porvoz/runtime") {
      return sendJson(response, 200, service.getRuntimeConfig(url.searchParams.get("profileId") || undefined));
    }
    if (request.method === "GET" && url.pathname === "/v1/porvoz/setup") {
      return sendJson(response, 200, service.getSetupStatus(url.searchParams.get("profileId") || undefined));
    }
    if (request.method === "POST" && url.pathname === "/v1/porvoz/profiles") {
      return sendJson(response, 201, service.createProfile(await readJson(request)));
    }
    if (request.method === "PUT" && url.pathname === "/v1/porvoz/prompt") {
      const body = await readJson(request);
      return sendJson(response, 200, { prompt: service.savePrompt(body.prompt) });
    }
    if (request.method === "POST" && url.pathname === "/v1/porvoz/prompt/reset") {
      return sendJson(response, 200, { prompt: service.resetPrompt() });
    }
    if (request.method === "PUT" && url.pathname === "/v1/porvoz/prefixes") {
      return sendJson(response, 200, service.savePrefixSettings(await readJson(request)));
    }
    if (request.method === "GET" && url.pathname === "/v1/porvoz/logs") {
      return sendJson(response, 200, service.getLogs());
    }
    if (request.method === "DELETE" && url.pathname === "/v1/porvoz/logs") {
      return sendJson(response, 200, service.clearLogs());
    }
    if (request.method === "POST" && url.pathname === "/v1/porvoz/logs/errors") {
      return sendJson(response, 201, service.logError(await readJson(request)));
    }
    if (request.method === "POST" && url.pathname === "/v1/porvoz/reset") {
      return sendJson(response, 200, service.resetToDefaults());
    }
    if (request.method === "POST" && url.pathname === "/v1/porvoz/import") {
      return sendJson(response, 200, { imported: store.importLegacy(await readJson(request)) });
    }
    if (request.method === "POST" && url.pathname === "/v1/porvoz/prefixes/from-audio") {
      const multipart = await readMultipart(request, store.getLimits().maxUploadBytes);
      if (!multipart.file) throw httpError(400, "A prefix audio file is required.");
      return sendJson(response, 200, await service.createPrefixFromVoice({
        audio: multipart.file.data,
        mimeType: multipart.file.mimeType,
        profileId: multipart.fields.model
      }, { signal: controller.signal }));
    }

    const profileRoute = url.pathname.match(/^\/v1\/porvoz\/profiles\/([^/]+)(?:\/(connection|models|inference-key))?$/);
    if (profileRoute) {
      const profileId = decodeURIComponent(profileRoute[1]);
      const resource = profileRoute[2] || "profile";
      if (request.method === "PATCH" && resource === "profile") {
        return sendJson(response, 200, service.renameProfile({ id: profileId, ...(await readJson(request)) }));
      }
      if (request.method === "DELETE" && resource === "profile") {
        return sendJson(response, 200, service.deleteProfile({ id: profileId }));
      }
      if (request.method === "GET" && resource === "connection") {
        return sendJson(response, 200, connectionResponse(profileId));
      }
      if (request.method === "PUT" && resource === "connection") {
        return sendJson(response, 200, service.saveConnection({ profileId, ...(await readJson(request)) }));
      }
      if (request.method === "PUT" && resource === "models") {
        return sendJson(response, 200, service.saveModelSelections({ profileId, ...(await readJson(request)) }));
      }
      if (request.method === "POST" && resource === "models") {
        return sendJson(response, 200, await service.populateModels({ profileId, signal: controller.signal }));
      }
      if (request.method === "GET" && resource === "inference-key") {
        return sendJson(response, 200, { apiKey: store.getInferenceKey(profileId) });
      }
      if (request.method === "POST" && resource === "inference-key") {
        return sendJson(response, 200, { apiKey: store.rotateInferenceKey(profileId) });
      }
    }

    return sendOpenAiError(response, 404, "The requested endpoint does not exist.", "not_found");
  }

  function connectionResponse(profileId) {
    return {
      ...service.getConnectionSettings(profileId),
      inferenceApiKey: store.getInferenceKey(profileId)
    };
  }

  function authenticate(request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization || "");
    const key = match?.[1]?.trim();
    if (!key) return null;
    if (secureEqual(key, adminKey)) return { type: "admin" };
    const profileId = store.resolveInferenceKey(key);
    return profileId ? { type: "inference", profileId } : null;
  }
}

function publicModel(profile) {
  const transcription = profile.models.transcription || "unconfigured-transcription";
  const instruction = profile.models.instruction || "unconfigured-instruction";
  return {
    id: `${profile.name} · ${transcription} · ${instruction}`,
    object: "model",
    created: 0,
    owned_by: "porvoz"
  };
}

async function readJson(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > JSON_LIMIT_BYTES) throw httpError(413, "The request body is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "The request body must contain valid JSON.");
  }
}

function readMultipart(request, maxFileBytes) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: { fileSize: maxFileBytes, files: 1, fields: 20, fieldSize: 300_000 }
      });
    } catch {
      reject(httpError(400, "The request must use multipart/form-data."));
      return;
    }
    const fields = {};
    let file;
    let failed = false;
    const fail = (error) => {
      if (failed) return;
      failed = true;
      reject(error);
      request.unpipe(parser);
      parser.destroy();
      // Drain any remaining body without retaining it after a rejected upload.
      if (!request.destroyed) request.resume();
    };
    const onRequestError = (error) => fail(httpError(400, error.message));
    const onAborted = () => fail(httpError(400, "The upload was interrupted."));
    request.once("error", onRequestError);
    request.once("aborted", onAborted);
    request.once("close", () => {
      request.off("error", onRequestError);
      request.off("aborted", onAborted);
    });
    parser.on("field", (name, value) => { fields[name] = value; });
    parser.on("file", (name, stream, info) => {
      const chunks = [];
      let truncated = false;
      stream.once("error", (error) => fail(httpError(400, error.message)));
      stream.on("data", (chunk) => { if (!failed) chunks.push(chunk); });
      stream.on("limit", () => { truncated = true; });
      stream.on("end", () => {
        if (failed) return;
        if (truncated) {
          fail(httpError(413, "The audio file is too large."));
          return;
        }
        if (name === "file") {
          file = {
            data: Buffer.concat(chunks),
            fileName: info.filename,
            mimeType: info.mimeType || "application/octet-stream"
          };
        }
      });
    });
    parser.once("error", (error) => fail(httpError(400, error.message)));
    parser.once("close", () => { if (!failed) resolve({ fields, file }); });
    if (request.aborted || request.destroyed) onAborted();
    else request.pipe(parser);
  });
}

function parseContext(value) {
  if (!value) return { clipboard: "" };
  try {
    const parsed = JSON.parse(value);
    return { clipboard: typeof parsed?.clipboard === "string" ? parsed.clipboard : "" };
  } catch {
    throw httpError(400, "porvoz_context must contain valid JSON.");
  }
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(response, status, value) {
  if (response.headersSent) return;
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  response.end(body);
}

function sendError(response, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  if (status >= 500) console.error("Porvoz server request failed:", error);
  sendOpenAiError(response, status, error?.message || "The server could not process the request.", error?.code);
}

function sendOpenAiError(response, status, message, code) {
  sendJson(response, status, {
    error: {
      message,
      type: status === 401 ? "authentication_error" : "invalid_request_error",
      param: null,
      code: code || null
    }
  });
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}
