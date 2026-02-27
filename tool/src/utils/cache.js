import fs from "fs";
import config from "config";

/**
 * Cache metadata structure:
 * {
 *   timestamp: ISO string when cached,
 *   ttl: seconds until expiration,
 *   cacheType: type of cache for TTL lookup,
 *   data: actual cached result
 * }
 */

/**
 * Get TTL for a specific cache type from config
 * @param {string} cacheType - Type of cache (e.g., 'pubmed_naive', 'gpt_queries')
 * @returns {number} TTL in seconds, or null for no expiration
 */
const getCacheTTL = (cacheType) => {
  try {
    const ttlConfig = config.get("cache.ttl");
    return ttlConfig[cacheType] || ttlConfig.default || null;
  } catch (error) {
    // Config not available, use default of 7 days
    console.warn("Cache TTL config not found, using default 7 days");
    return 604800;
  }
};

/**
 * Check if cache is still valid based on TTL
 * @param {Object} cacheMetadata - Cache metadata object
 * @returns {boolean} True if cache is valid, false if expired
 */
const isCacheValid = (cacheMetadata) => {
  if (!cacheMetadata.timestamp) {
    // Old cache format without timestamp - consider invalid
    return false;
  }

  if (!cacheMetadata.ttl) {
    // No TTL means cache never expires
    return true;
  }

  const cacheAge = Date.now() - new Date(cacheMetadata.timestamp).getTime();
  const ttlMs = cacheMetadata.ttl * 1000;

  return cacheAge < ttlMs;
};

/**
 * Get cache age in human-readable format
 * @param {string} timestamp - ISO timestamp
 * @returns {string} Human-readable age
 */
export const getCacheAge = (timestamp) => {
  const ageMs = Date.now() - new Date(timestamp).getTime();
  const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
  const ageHours = Math.floor(
    (ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
  );

  if (ageDays > 0) {
    return `${ageDays}d ${ageHours}h`;
  }
  return `${ageHours}h`;
};

/**
 * Cache result to file with TTL support
 * @param {Function} func - Async function to execute if cache miss
 * @param {string} cacheKey - Cache key/filename
 * @param {string} cacheType - Type of cache for TTL lookup (e.g., 'pubmed_naive')
 * @returns {Promise<any>} Cached or fresh result
 */
export const cacheResultToFile = async (func, cacheKey, cacheType = null) => {
  const cacheFileName = `./cache/${cacheKey}.json`;

  // Try to read existing cache
  if (fs.existsSync(cacheFileName)) {
    try {
      const cachedContent = await fs.promises.readFile(cacheFileName, "utf8");
      const cachedData = JSON.parse(cachedContent);

      // Check if this is new format with metadata
      if (cachedData.timestamp !== undefined) {
        // New format with TTL
        if (isCacheValid(cachedData)) {
          const age = getCacheAge(cachedData.timestamp);
          console.log(`✓ Cache HIT (age: ${age}):`, cacheFileName);
          global.cacheHits = (global.cacheHits || 0) + 1;
          return cachedData.data;
        } else {
          console.log("✗ Cache EXPIRED:", cacheFileName);
          global.cacheExpired = (global.cacheExpired || 0) + 1;
          // Cache expired, will regenerate
        }
      } else {
        // Old format without metadata - return as-is for backward compatibility
        console.log("⚠ Cache HIT (legacy format):", cacheFileName);
        global.cacheHits = (global.cacheHits || 0) + 1;
        return cachedData;
      }
    } catch (error) {
      console.error("Failed to read cache file:", error);
      global.cacheErrors = (global.cacheErrors || 0) + 1;
    }
  } else {
    console.log("✗ Cache MISS:", cacheFileName);
    global.cacheMisses = (global.cacheMisses || 0) + 1;
  }

  // Cache miss or expired - execute function
  const result = await func();

  // Write cache with metadata
  try {
    const ttl = getCacheTTL(cacheType);
    const cacheData = {
      timestamp: new Date().toISOString(),
      ttl: ttl,
      cacheType: cacheType,
      data: result,
    };

    fs.writeFileSync(cacheFileName, JSON.stringify(cacheData, null, 2), "utf8");
    const ttlInfo = ttl ? `TTL: ${Math.floor(ttl / 86400)}d` : "no expiration";
    console.log(`✓ Cache WRITE (${ttlInfo}):`, cacheFileName);
  } catch (error) {
    console.error("Failed to write cache file:", error);
    global.cacheErrors = (global.cacheErrors || 0) + 1;
  }

  return result
};
