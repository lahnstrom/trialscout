import { log } from "../../../utils/utils.js";
import { cacheResultToFile } from "../../../utils/cache.js";

export const searchLinkedAtRegistration = async (registration) => {
  if (!registration) {
    throw new Error(`searchLinkedAtRegistration failed, null registration`);
  }

  log(`Finding linked publications for ${registration.trialId}`);

  let hits = [];

  // First: Check linkedPubmedIds (from EUCTR results page or other registries)
  if (registration?.linkedPubmedIds?.length > 0) {
    log(
      `Found ${registration.linkedPubmedIds.length} linked PMIDs from registry results page`
    );
    hits = registration.linkedPubmedIds.map((pmid) => ({
      pmid: pmid,
    }));
  }
  // Fallback: Check references array (from CTGov)
  else if (registration?.references?.length > 0) {
    log(`Found ${registration?.references?.length} references in registry`);
    hits = registration?.references
      ?.filter((ref) => !!ref?.pmid)
      .map((ref) => {
        return {
          pmid: ref?.pmid,
        };
      });
    if (hits?.length !== registration?.references?.length) {
      log(
        `Used ${hits?.length} of linked references for registration ${registration?.trialId} (missing pmid)`
      );
    }
  }

  return { results: hits };
};

export const searchLinkedAtRegistrationCached = async (registration) => {
  return await cacheResultToFile(
    () => searchLinkedAtRegistration(registration),
    `linked-at-registration-${registration?.trialId}`,
    "linked_registration"
  );
};
