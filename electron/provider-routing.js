// Older settings routed both stages through the active connection profile.
export function normalizeRouting(settings) {
  const fallback = settings.profiles.some(({ id }) => id === settings.activeProfileId)
    ? settings.activeProfileId
    : settings.profiles[0].id;
  return Object.fromEntries(["transcription", "instruction"].map((stage) => [
    stage,
    settings.profiles.some(({ id }) => id === settings.routing?.[stage])
      ? settings.routing[stage]
      : fallback
  ]));
}

export function updateRouting(settings, value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error("Routing must contain transcription or instruction provider IDs."), { statusCode: 400 });
  }
  const routing = normalizeRouting(settings);
  for (const stage of ["transcription", "instruction"]) {
    if (value[stage] === undefined) continue;
    if (!settings.profiles.some(({ id }) => id === value[stage])) {
      throw Object.assign(new Error(`Choose an existing provider for ${stage} routing.`), { statusCode: 400 });
    }
    routing[stage] = value[stage];
  }
  return routing;
}
