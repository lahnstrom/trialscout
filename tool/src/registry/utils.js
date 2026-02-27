/**
 * Utilities for handling different clinical trial registry types
 * Supports multiple registry formats: ClinicalTrials.gov (NCT), EudraCT (EUCTR), etc.
 */

// Registry type constants
export const REGISTRY_TYPES = {
  CTGOV: "ctgov",
  EUCTR: "euctr",
  DRKS: "drks",
  UNKNOWN: "unknown",
};

// Registry ID format patterns
const REGISTRY_PATTERNS = {
  [REGISTRY_TYPES.CTGOV]: /^NCT\d{8}$/i,
  [REGISTRY_TYPES.EUCTR]: /^\d{4}-\d{6}-\d{2}$/,
  [REGISTRY_TYPES.DRKS]: /^DRKS\d{8}$/i,
};

/**
 * Automatically detect the registry type from a trial ID
 * @param {string} trialId - The trial registry ID
 * @returns {string} Registry type constant (ctgov, euctr, or unknown)
 */
export function detectRegistryType(trialId) {
  if (!trialId || typeof trialId !== "string") {
    return REGISTRY_TYPES.UNKNOWN;
  }

  const normalized = trialId.trim();

  // Check each registry pattern
  if (REGISTRY_PATTERNS[REGISTRY_TYPES.CTGOV].test(normalized)) {
    return REGISTRY_TYPES.CTGOV;
  }

  if (REGISTRY_PATTERNS[REGISTRY_TYPES.EUCTR].test(normalized)) {
    return REGISTRY_TYPES.EUCTR;
  }

  if (REGISTRY_PATTERNS[REGISTRY_TYPES.DRKS].test(normalized)) {
    return REGISTRY_TYPES.DRKS;
  }

  return REGISTRY_TYPES.UNKNOWN;
}

/**
 * Validate a trial ID against its expected registry type format
 * @param {string} trialId - The trial registry ID
 * @param {string} registryType - Expected registry type
 * @returns {boolean} True if valid, false otherwise
 */
export function validateTrialId(trialId, registryType) {
  if (!trialId || typeof trialId !== "string") {
    return false;
  }

  const pattern = REGISTRY_PATTERNS[registryType];
  if (!pattern) {
    return false;
  }

  return pattern.test(trialId.trim());
}

/**
 * Normalize a trial ID (trim, uppercase for NCT IDs)
 * @param {string} trialId - The trial registry ID
 * @returns {string} Normalized trial ID
 */
export function normalizeTrialId(trialId) {
  if (!trialId || typeof trialId !== "string") {
    return "";
  }

  const trimmed = trialId.trim();
  const registryType = detectRegistryType(trimmed);

  // NCT IDs should be uppercase
  if (registryType === REGISTRY_TYPES.CTGOV) {
    return trimmed.toUpperCase();
  }

  // DRKS IDs should be uppercase (DRKS prefix)
  if (registryType === REGISTRY_TYPES.DRKS) {
    return trimmed.toUpperCase();
  }

  // EUCTR IDs are already numeric, just return trimmed
  return trimmed;
}

/**
 * Get human-readable registry name
 * @param {string} registryType - Registry type constant
 * @returns {string} Human-readable name
 */
export function getRegistryName(registryType) {
  const names = {
    [REGISTRY_TYPES.CTGOV]: "ClinicalTrials.gov",
    [REGISTRY_TYPES.EUCTR]: "EU Clinical Trials Register",
    [REGISTRY_TYPES.DRKS]: "German Clinical Trials Register",
    [REGISTRY_TYPES.UNKNOWN]: "Unknown Registry",
  };

  return names[registryType] || names[REGISTRY_TYPES.UNKNOWN];
}

/**
 * Format a trial ID for display
 * @param {string} trialId - The trial registry ID
 * @param {string} registryType - Registry type (optional, will auto-detect)
 * @returns {string} Formatted trial ID
 */
export function formatTrialIdForDisplay(trialId, registryType = null) {
  const normalized = normalizeTrialId(trialId);
  const type = registryType || detectRegistryType(normalized);
  const registryName = getRegistryName(type);

  return `${normalized} (${registryName})`;
}
