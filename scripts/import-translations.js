#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

// Process CLI arguments
const argv = yargs(hideBin(process.argv))
  .option('config', {
    alias: 'c',
    description: 'Path to configuration file',
    type: 'string',
    default: './translations-config.json'
  })
  .option('output', {
    alias: 'o',
    description: 'Path to output directory',
    type: 'string',
    default: '../src/translations' 
  })
  .option('format', {
    alias: 'f',
    description: 'Output format (typescript or json)',
    type: 'string',
    default: 'typescript',
    choices: ['typescript', 'json']
  })
  .option('locales', {
    alias: 'l',
    description: 'Locales to export (comma-separated list)',
    type: 'string'
  })
  .option('verbose', {
    alias: 'v',
    description: 'Verbose logging',
    type: 'boolean',
    default: false
  })
  .help()
  .alias('help', 'h')
  .parse();

// Get the directory where the script is located
const scriptDir = __dirname;

// Read configuration file
const configPath = path.resolve(process.cwd(), argv.config);
let config;

try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error(`Could not read configuration file: ${configPath}`);
  console.error(error);
  process.exit(1);
}

// Initialize Firebase
try {
  const serviceAccountPath = path.resolve(process.cwd(), config.serviceAccountKeyPath);
  const serviceAccount = require(serviceAccountPath);
  
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: config.databaseURL
  });
} catch (error) {
  console.error('Failed to initialize Firebase:');
  console.error(error);
  process.exit(1);
}

// Create output directory - Changed: Based on the script's directory
const outputDir = path.resolve(scriptDir, argv.output);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Determine locales
const locales = argv.locales ? argv.locales.split(',') : config.locales;
if (!locales || locales.length === 0) {
  console.error('No locales specified for export.');
  process.exit(1);
}

// Fetch translations from Firebase
async function fetchTranslations() {
  const db = admin.database();
  const translationsRef = db.ref(config.translationsPath);
  
  if (argv.verbose) {
    console.log(`Fetching translations from Firebase: ${config.translationsPath}`);
  }
  
  try {
    // Get translations version
    let translationsVersion = 0;
    try {
      const versionRef = db.ref('translations_version');
      const versionSnapshot = await versionRef.once('value');
      translationsVersion = versionSnapshot.val()?.version || 0;
      
      if (argv.verbose) {
        console.log(`Current translations version: ${translationsVersion}`);
      }
    } catch (versionError) {
      console.warn('Could not fetch translations version:', versionError);
    }
    
    // Get translations
    const snapshot = await translationsRef.once('value');
    const translations = snapshot.val();
    
    if (!translations) {
      console.error(`No translations found at: ${config.translationsPath}`);
      process.exit(1);
    }
    
    // Get all keys and languages
    const keys = Object.keys(translations);
    
    // Find all available languages by looking at the first key
    // (assuming all keys have the same languages)
    let languages = [];
    if (keys.length > 0) {
      languages = Object.keys(translations[keys[0]]);
    }
    
    // Process the data into language-based structure
    const processedTranslations = {};
    
    // Initialize language objects
    languages.forEach(lang => {
      processedTranslations[lang] = {};
    });
    
    // Fill in translations for each language
    keys.forEach(key => {
      if (!key.startsWith('---')) { // Skip keys starting with ---
        languages.forEach(lang => {
          if (translations[key] && translations[key][lang]) {
            processedTranslations[lang][key] = translations[key][lang];
          }
        });
      }
    });
    
    return {
      translations: processedTranslations,
      version: translationsVersion
    };
  } catch (error) {
    console.error('Failed to fetch translations:');
    console.error(error);
    process.exit(1);
  }
}

// Generate TypeScript file
function generateTypeScriptFile(locale, translations, version) {
  // Create backup directory if it doesn't exist
  const backupDir = path.join(outputDir, 'backup');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  // Try to create a backup of the existing file
  const filePath = path.join(outputDir, `${locale}.ts`);
  try {
    if (fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, path.join(backupDir, `${locale}.ts`));
      if (argv.verbose) {
        console.log(`Backup created for: ${locale}.ts`);
      }
    }
  } catch (error) {
    if (argv.verbose) {
      console.warn(`Could not create backup for ${locale}.ts:`, error);
    }
  }
  
  // Generate the content
  const content = `// This file is auto-generated. Please do not edit.
// Generated on: ${new Date().toISOString()}
// Translations version: ${version}

export const ${locale} = ${JSON.stringify(translations, null, 2)};
`;
  
  fs.writeFileSync(filePath, content);
  
  if (argv.verbose) {
    console.log(`TypeScript file generated: ${filePath}`);
  }
}

// Generate JSON file
function generateJsonFile(locale, translations, version) {
  // Add version metadata to the translations object
  const translationsWithMeta = {
    _meta: {
      version: version,
      generatedAt: new Date().toISOString()
    },
    ...translations
  };
  
  const content = JSON.stringify(translationsWithMeta, null, 2);
  const filePath = path.join(outputDir, `${locale}.json`);
  fs.writeFileSync(filePath, content);
  
  if (argv.verbose) {
    console.log(`JSON file generated: ${filePath}`);
  }
}

// Generate index file (for TypeScript)
function generateIndexFile(locales, version) {
  const imports = locales.map(locale => `import { ${locale} } from './${locale}';`).join('\n');
  const exportObj = `{\n  ${locales.join(',\n  ')}\n}`;
  
  const content = `// This file is auto-generated. Please do not edit.
// Generated on: ${new Date().toISOString()}
// Translations version: ${version}

${imports}

export const TRANSLATIONS_VERSION = ${version};

export default ${exportObj};
`;
  
  const filePath = path.join(outputDir, 'index.ts');
  fs.writeFileSync(filePath, content);
  
  if (argv.verbose) {
    console.log(`Index file generated: ${filePath}`);
  }
}

// Generate defaultLocale file (copy of the default locale file)
function generateDefaultLocaleFile(defaultLocale, translations, version) {
  if (!defaultLocale || !translations[defaultLocale]) {
    console.warn(`Warning: Default locale "${defaultLocale}" not found in translations data.`);
    return;
  }
  
  // Generate the content (same as the locale file but with different name)
  const content = `// This file is auto-generated. Please do not edit.
// Generated on: ${new Date().toISOString()}
// Translations version: ${version}

export const defaultLocale = ${JSON.stringify(translations[defaultLocale], null, 2)};
`;
  
  const filePath = path.join(outputDir, `defaultLocale.ts`);
  fs.writeFileSync(filePath, content);
  
  if (argv.verbose) {
    console.log(`Default locale file generated: ${filePath}`);
  }
}

// Main function
async function main() {
  try {
    console.log('Fetching translations from Firebase...');
    const { translations: processedTranslations, version } = await fetchTranslations();
    
    const availableLocales = Object.keys(processedTranslations);
    
    // Filter locales if specified in arguments
    const localesToExport = locales.filter(locale => 
      availableLocales.includes(locale)
    );
    
    if (localesToExport.length === 0) {
      console.error('No matching locales found in the translations data.');
      process.exit(1);
    }
    
    console.log(`Generating files for ${localesToExport.length} locales (version: ${version})...`);
    
    for (const locale of localesToExport) {
      const translations = processedTranslations[locale];
      
      if (!translations || Object.keys(translations).length === 0) {
        console.warn(`Warning: No translations found for locale "${locale}".`);
        continue;
      }
      
      if (argv.format === 'typescript') {
        generateTypeScriptFile(locale, translations, version);
      } else {
        generateJsonFile(locale, translations, version);
      }
    }
    
    if (argv.format === 'typescript') {
      generateIndexFile(localesToExport, version);
      
      // Generate defaultLocale.ts file (copy of the default locale file)
      // Use config.defaultLocale if available, otherwise use the first locale in the list
      const defaultLocale = config.defaultLocale || localesToExport[0];
      generateDefaultLocaleFile(defaultLocale, processedTranslations, version);
    }
    
    console.log(`Translations exported successfully! (version: ${version})`);
  } catch (error) {
    console.error('Error exporting translations:');
    console.error(error);
    process.exit(1);
  } finally {
    admin.app().delete();
  }
}

main();
