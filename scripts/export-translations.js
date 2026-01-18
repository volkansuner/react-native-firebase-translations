#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");
const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const { prompt } = require("enquirer");

// Get the directory where the script is located
const scriptDir = __dirname;

// Process CLI arguments
const argv = yargs(hideBin(process.argv))
  .option("config", {
    alias: "c",
    description: "Path to configuration file",
    type: "string",
    default: "./translations-config.json",
  })
  .option("input", {
    alias: "i",
    description: "Path to input directory containing translation files",
    type: "string",
    default: "./src/translations",
  })
  .option("format", {
    alias: "f",
    description: "Input format (typescript or json)",
    type: "string",
    default: "typescript",
    choices: ["typescript", "json"],
  })
  .option("locales", {
    alias: "l",
    description: "Locales to import (comma-separated list)",
    type: "string",
  })
  .option("verbose", {
    alias: "v",
    description: "Verbose logging",
    type: "boolean",
    default: false,
  })
  .option("dry-run", {
    alias: "d",
    description: "Dry run (do not update Firebase)",
    type: "boolean",
    default: false,
  })
  .option("yes", {
    alias: "y",
    description: "Skip confirmation prompt",
    type: "boolean",
    default: false,
  })
  .help()
  .alias("help", "h")
  .parse();

// Read configuration file
const configPath = path.resolve(process.cwd(), argv.config);
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch (error) {
  console.error(`Could not read configuration file: ${configPath}`);
  console.error(error);
  process.exit(1);
}

// Initialize Firebase
try {
  const serviceAccountPath = path.resolve(
    process.cwd(),
    config.serviceAccountKeyPath,
  );
  const serviceAccount = require(serviceAccountPath);

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.databaseURL,
  });
} catch (error) {
  console.error("Failed to initialize Firebase:");
  console.error(error);
  process.exit(1);
}

// Determine locales
const locales = argv.locales ? argv.locales.split(",") : config.locales;
if (!locales || locales.length === 0) {
  console.error("No locales specified for import.");
  process.exit(1);
}

// Read translations from files
async function readTranslations() {
  // Use current working directory as the base for the input path
  const inputDir = path.resolve(process.cwd(), argv.input);
  const translations = {};

  if (!fs.existsSync(inputDir)) {
    console.error(`Input directory does not exist: ${inputDir}`);
    process.exit(1);
  }

  for (const locale of locales) {
    let filePath;
    let fileContent;

    if (argv.format === "typescript") {
      filePath = path.join(inputDir, `${locale}.ts`);

      if (!fs.existsSync(filePath)) {
        console.warn(
          `Warning: Translation file not found for locale "${locale}": ${filePath}`,
        );
        continue;
      }

      try {
        // For TypeScript files, we need to extract the exported object
        fileContent = fs.readFileSync(filePath, "utf8");

        // Extract the JSON object from the TypeScript file
        // This is a simple regex approach, might need adjustment for complex files
        const match = fileContent.match(/export const \w+ = (\{[\s\S]*\});?$/m);
        if (!match || !match[1]) {
          console.error(
            `Could not extract translations from TypeScript file: ${filePath}`,
          );
          continue;
        }

        // Parse the extracted object (supports both JSON and JS object syntax)
        try {
          // Use Function constructor to safely evaluate JS object literal
          // This handles both quoted and unquoted keys
          const parseObject = new Function("return " + match[1]);
          translations[locale] = parseObject();
        } catch (parseError) {
          console.error(
            `Failed to parse translations from TypeScript file: ${filePath}`,
          );
          console.error(parseError);
          continue;
        }
      } catch (error) {
        console.error(`Failed to read TypeScript file: ${filePath}`);
        console.error(error);
        continue;
      }
    } else {
      filePath = path.join(inputDir, `${locale}.json`);

      if (!fs.existsSync(filePath)) {
        console.warn(
          `Warning: Translation file not found for locale "${locale}": ${filePath}`,
        );
        continue;
      }

      try {
        fileContent = fs.readFileSync(filePath, "utf8");
        translations[locale] = JSON.parse(fileContent);
      } catch (error) {
        console.error(`Failed to read JSON file: ${filePath}`);
        console.error(error);
        continue;
      }
    }

    if (argv.verbose) {
      console.log(`Read translations for locale "${locale}" from: ${filePath}`);
    }
  }

  return translations;
}

// Transform translations to Firebase format
function transformToFirebaseFormat(translations) {
  const firebaseData = {};

  // Get all unique keys across all locales
  const allKeys = new Set();
  Object.values(translations).forEach((localeData) => {
    Object.keys(localeData).forEach((key) => allKeys.add(key));
  });

  // Create Firebase structure
  allKeys.forEach((key) => {
    firebaseData[key] = {};
    Object.keys(translations).forEach((locale) => {
      if (translations[locale][key]) {
        firebaseData[key][locale] = translations[locale][key];
      }
    });
  });

  return firebaseData;
}

// Update Firebase with translations
async function updateFirebase(firebaseData) {
  const db = admin.database();

  if (argv.dry_run) {
    console.log("DRY RUN: Would update Firebase with the following data:");
    console.log(JSON.stringify(firebaseData, null, 2));
    return;
  }

  // Add confirmation prompt
  if (!argv.yes) {
    const { confirm } = await prompt({
      type: "confirm",
      name: "confirm",
      message: "Are you sure you want to update translations in Firebase?",
      initial: false,
    });

    if (!confirm) {
      console.log("Operation cancelled by user.");
      return;
    }
  }

  try {
    // First, get the current version
    let currentVersion = 0;
    const versionRef = db.ref("translations_version");
    const versionSnapshot = await versionRef.once("value");
    currentVersion = versionSnapshot.val()?.version || 0;

    // Update translations
    const translationsRef = db.ref(config.translationsPath);
    await translationsRef.set(firebaseData);
    console.log(
      `Successfully updated translations in Firebase at: ${config.translationsPath}`,
    );

    // Update version
    const newVersion = currentVersion + 1;
    await versionRef.set({ version: newVersion });
    console.log(`Updated translations version to: ${newVersion}`);
  } catch (error) {
    console.error("Failed to update Firebase:");
    console.error(error);
    process.exit(1);
  }
}

// Main function
async function main() {
  try {
    console.log("Reading translations from files...");
    const translations = await readTranslations();

    const localesFound = Object.keys(translations);
    if (localesFound.length === 0) {
      console.error("No translations found in the specified files.");
      process.exit(1);
    }

    console.log(
      `Found translations for ${localesFound.length} locales: ${localesFound.join(", ")}`,
    );

    console.log("Transforming translations to Firebase format...");
    const firebaseData = transformToFirebaseFormat(translations);

    console.log("Updating Firebase...");
    await updateFirebase(firebaseData);

    console.log("Translations successfully imported to Firebase!");
  } catch (error) {
    console.error("Error importing translations:");
    console.error(error);
    process.exit(1);
  } finally {
    admin.app().delete();
  }
}

main();
