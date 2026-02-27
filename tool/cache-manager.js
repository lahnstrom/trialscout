#!/usr/bin/env node

/**
 * Cache Management Utility
 *
 * Commands:
 *   node cache-manager.js clear-all              - Delete all cache files
 *   node cache-manager.js clear-trial <trialId>  - Delete all cache for specific trial
 *   node cache-manager.js clear-type <type>      - Delete cache by type (e.g., pubmed-naive)
 *   node cache-manager.js clear-expired          - Delete only expired caches
 *   node cache-manager.js list                   - Show cache statistics
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CACHE_DIR = path.join(__dirname, "cache");

/**
 * Check if cache file is expired
 */
const isCacheExpired = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);

    // Old format without metadata
    if (!data.timestamp) {
      return false; // Don't delete old format caches automatically
    }

    // No TTL means never expires
    if (!data.ttl) {
      return false;
    }

    const cacheAge = Date.now() - new Date(data.timestamp).getTime();
    const ttlMs = data.ttl * 1000;

    return cacheAge >= ttlMs;
  } catch (error) {
    console.error(`Error checking cache ${filePath}:`, error.message);
    return false;
  }
};

/**
 * Get cache file info
 */
const getCacheInfo = (filePath) => {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(content);
    const stats = fs.statSync(filePath);
    const sizeKB = Math.round(stats.size / 1024);

    if (!data.timestamp) {
      return {
        fileName: path.basename(filePath),
        format: "legacy",
        age: "unknown",
        ttl: "none",
        size: `${sizeKB}KB`,
        expired: false,
      };
    }

    const ageMs = Date.now() - new Date(data.timestamp).getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const ageHours = Math.floor(
      (ageMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );
    const ageStr = ageDays > 0 ? `${ageDays}d ${ageHours}h` : `${ageHours}h`;

    const ttlDays = data.ttl ? Math.floor(data.ttl / 86400) : null;
    const ttlStr = ttlDays ? `${ttlDays}d` : "none";

    return {
      fileName: path.basename(filePath),
      format: "new",
      age: ageStr,
      ttl: ttlStr,
      cacheType: data.cacheType || "unknown",
      size: `${sizeKB}KB`,
      expired: isCacheExpired(filePath),
    };
  } catch (error) {
    return {
      fileName: path.basename(filePath),
      format: "error",
      error: error.message,
    };
  }
};

/**
 * List all cache files with statistics
 */
const listCache = () => {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log("Cache directory does not exist");
    return;
  }

  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log("No cache files found");
    return;
  }

  console.log(`\nFound ${files.length} cache files:\n`);
  console.log(
    "File".padEnd(50),
    "Format".padEnd(8),
    "Age".padEnd(10),
    "TTL".padEnd(8),
    "Size".padEnd(8),
    "Status"
  );
  console.log("-".repeat(100));

  let totalSize = 0;
  let expiredCount = 0;
  let legacyCount = 0;

  files.forEach((file) => {
    const filePath = path.join(CACHE_DIR, file);
    const info = getCacheInfo(filePath);

    if (info.expired) expiredCount++;
    if (info.format === "legacy") legacyCount++;

    const stats = fs.statSync(filePath);
    totalSize += stats.size;

    const status = info.expired ? "EXPIRED" : "valid";
    console.log(
      info.fileName.padEnd(50),
      info.format.padEnd(8),
      info.age.padEnd(10),
      info.ttl.padEnd(8),
      info.size.padEnd(8),
      status
    );
  });

  console.log("-".repeat(100));
  console.log(`\nTotal: ${files.length} files (${Math.round(totalSize / 1024)}KB)`);
  console.log(`Expired: ${expiredCount} files`);
  console.log(`Legacy format: ${legacyCount} files`);
};

/**
 * Clear all cache files
 */
const clearAll = () => {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log("Cache directory does not exist");
    return;
  }

  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log("No cache files to delete");
    return;
  }

  console.log(`Deleting ${files.length} cache files...`);

  let deleted = 0;
  files.forEach((file) => {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, file));
      deleted++;
    } catch (error) {
      console.error(`Failed to delete ${file}:`, error.message);
    }
  });

  console.log(`✓ Deleted ${deleted} cache files`);
};

/**
 * Clear cache for specific trial
 */
const clearTrial = (trialId) => {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log("Cache directory does not exist");
    return;
  }

  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json") && f.includes(trialId));

  if (files.length === 0) {
    console.log(`No cache files found for trial ${trialId}`);
    return;
  }

  console.log(`Deleting ${files.length} cache files for trial ${trialId}...`);

  let deleted = 0;
  files.forEach((file) => {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, file));
      console.log(`  ✓ ${file}`);
      deleted++;
    } catch (error) {
      console.error(`  ✗ Failed to delete ${file}:`, error.message);
    }
  });

  console.log(`\n✓ Deleted ${deleted} cache files`);
};

/**
 * Clear cache by type
 */
const clearType = (type) => {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log("Cache directory does not exist");
    return;
  }

  const files = fs
    .readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith(".json") && f.startsWith(type));

  if (files.length === 0) {
    console.log(`No cache files found for type ${type}`);
    return;
  }

  console.log(`Deleting ${files.length} cache files of type ${type}...`);

  let deleted = 0;
  files.forEach((file) => {
    try {
      fs.unlinkSync(path.join(CACHE_DIR, file));
      deleted++;
    } catch (error) {
      console.error(`Failed to delete ${file}:`, error.message);
    }
  });

  console.log(`✓ Deleted ${deleted} cache files`);
};

/**
 * Clear only expired cache files
 */
const clearExpired = () => {
  if (!fs.existsSync(CACHE_DIR)) {
    console.log("Cache directory does not exist");
    return;
  }

  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    console.log("No cache files found");
    return;
  }

  console.log("Checking for expired cache files...");

  let deleted = 0;
  files.forEach((file) => {
    const filePath = path.join(CACHE_DIR, file);
    if (isCacheExpired(filePath)) {
      try {
        fs.unlinkSync(filePath);
        console.log(`  ✓ ${file}`);
        deleted++;
      } catch (error) {
        console.error(`  ✗ Failed to delete ${file}:`, error.message);
      }
    }
  });

  if (deleted === 0) {
    console.log("No expired cache files found");
  } else {
    console.log(`\n✓ Deleted ${deleted} expired cache files`);
  }
};

/**
 * Show help
 */
const showHelp = () => {
  console.log(`
Cache Management Utility

Usage:
  node cache-manager.js <command> [args]

Commands:
  list                     Show all cache files with statistics
  clear-all                Delete all cache files
  clear-trial <trialId>    Delete all cache for specific trial (e.g., NCT12345678)
  clear-type <type>        Delete cache by type prefix (e.g., pubmed-naive, gpt-pubmed)
  clear-expired            Delete only expired cache files
  help                     Show this help message

Examples:
  node cache-manager.js list
  node cache-manager.js clear-trial NCT12345678
  node cache-manager.js clear-type pubmed-naive
  node cache-manager.js clear-expired
`);
};

// Main CLI handler
const main = () => {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "list":
      listCache();
      break;
    case "clear-all":
      clearAll();
      break;
    case "clear-trial":
      if (!args[1]) {
        console.error("Error: Trial ID required");
        console.log("Usage: node cache-manager.js clear-trial <trialId>");
        process.exit(1);
      }
      clearTrial(args[1]);
      break;
    case "clear-type":
      if (!args[1]) {
        console.error("Error: Cache type required");
        console.log("Usage: node cache-manager.js clear-type <type>");
        process.exit(1);
      }
      clearType(args[1]);
      break;
    case "clear-expired":
      clearExpired();
      break;
    case "help":
    case "--help":
    case "-h":
      showHelp();
      break;
    default:
      console.error(`Error: Unknown command '${command}'`);
      showHelp();
      process.exit(1);
  }
};

main();
