import {
  fetchRegistration as fetchCtgovRegistration,
  fetchRegistrationFs as fetchCtgovRegistrationFs,
  parseRegistration as parseCtgovRegistration,
} from "../registry/ctgov.js";
import { discoverRegistration as discoverEuctrRegistration } from "../registry/euctr.js";
import { discoverRegistration as discoverDrksRegistration } from "../registry/drks.js";
import { writeRegistrationLiveCache } from "../utils/server_utils.js";
import { detectRegistryType, REGISTRY_TYPES } from "../registry/utils.js";
import { log } from "../utils/utils.js";

export async function registrationDiscovery(trialId, { localRegistrations } = {}) {
  const registryType = detectRegistryType(trialId);
  log(`Detected registry type: ${registryType} for trial ID: ${trialId}`);

  let registration;

  switch (registryType) {
    case REGISTRY_TYPES.CTGOV:
      let rawRegistration;
      if (localRegistrations) {
        try {
          rawRegistration = fetchCtgovRegistrationFs(trialId, localRegistrations);
          log(`Loaded ${trialId} from local file`);
        } catch {
          log(`Local file not found for ${trialId}, falling back to API`);
          rawRegistration = await fetchCtgovRegistration(trialId);
        }
      } else {
        rawRegistration = await fetchCtgovRegistration(trialId);
      }
      registration = parseCtgovRegistration(rawRegistration);
      break;

    case REGISTRY_TYPES.EUCTR:
      registration = await discoverEuctrRegistration(trialId);
      break;

    case REGISTRY_TYPES.DRKS:
      registration = await discoverDrksRegistration(trialId);
      break;

    default:
      throw new Error(
        `Unsupported registry type: ${registryType} for trial ID: ${trialId}`
      );
  }

  writeRegistrationLiveCache(trialId, registration);
  return registration;
}
