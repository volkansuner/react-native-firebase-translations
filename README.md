# React Native Firebase Translations

A React Native library for managing translations with Firebase Realtime Database integration. This package provides a simple way to manage and synchronize translations across your React Native applications using Firebase Realtime Database.

## Features

- 🔄 Sync translations with Firebase Realtime Database
- 🌐 Support for multiple languages
- 📱 Offline support with AsyncStorage caching
- 🔄 Automatic language detection
- 📦 Easy import/export of translations
- 🧩 Simple React Context API

## Installation

```bash
npm install react-native-firebase-translations
# or
yarn add react-native-firebase-translations
# or
pnpm add react-native-firebase-translations
```

### Peer Dependencies

This package requires the following peer dependencies:

```bash
npm install react react-native @react-native-firebase/app @react-native-firebase/database @react-native-async-storage/async-storage @hookstate/core
```

## Setup

### 1. Configure Firebase

Make sure you have set up Firebase in your React Native project. If not, follow the [official documentation](https://rnfirebase.io/).

### 2. Create Configuration File

Create a `translations-config.json` file in your project root:

```json
{
  "serviceAccountKeyPath": "./path-to-your-service-account-key.json",
  "databaseURL": "https://your-firebase-project.firebaseio.com",
  "translationsPath": "translations",
  "locales": ["en", "tr"],
  "defaultLocale": "en"
}
```

## Usage

### Provider Setup

Wrap your application with the `TranslationsProvider`:

```jsx
import { TranslationsProvider } from 'react-native-firebase-translations';
import translationsConfig from "@/translations-config.json";

const App = () => {
  return (
    <TranslationsProvider {...translationsConfig}>
      <YourApp />
    </TranslationsProvider>
  );
};
```

Alternatively, you can provide the configuration directly:

```jsx
import { TranslationsProvider } from 'react-native-firebase-translations';

const App = () => {
  return (
    <TranslationsProvider
      defaultLocale="en"
      fallbackLocale="en"
      databaseURL="https://your-firebase-project.firebaseio.com"
    >
      <YourApp />
    </TranslationsProvider>
  );
};
```

### Using Translations

```jsx
import { useTranslations } from 'react-native-firebase-translations';

const MyComponent = () => {
  const { t, locale, setLocale, availableLocales } = useTranslations();

  return (
    <View>
      <Text>{t('hello_world')}</Text>
      <Text>Current language: {locale}</Text>
      
      <Dropdown
        value={locale}
        items={availableLocales.map(loc => ({ label: t(`language`, {}, loc), value: loc }))}
        onChange={value => setLocale(value)}
      />
    </View>
  );
};
```

## Import/Export Translations

This package provides CLI tools to import and export translations from/to Firebase.

### Import Translations from Firebase

```bash
npx firebase-translations-import --config ./i18n-config.json --output ./src/translations
```

### Export Translations to Firebase

```bash
npx firebase-translations-export --config ./i18n-config.json --input ./src/translations
```

## CLI Options

### Import Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--config` | `-c` | Path to configuration file | `./i18n-config.json` |
| `--output` | `-o` | Path to output directory | `../src/translations` |
| `--format` | `-f` | Output format (typescript or json) | `typescript` |
| `--locales` | `-l` | Locales to export (comma-separated list) | All locales in config |
| `--verbose` | `-v` | Verbose logging | `false` |

### Export Options

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--config` | `-c` | Path to configuration file | `./i18n-config.json` |
| `--input` | `-i` | Path to input directory containing translation files | `../src/translations` |
| `--format` | `-f` | Input format (typescript or json) | `typescript` |
| `--locales` | `-l` | Locales to import (comma-separated list) | All locales in config |
| `--verbose` | `-v` | Verbose logging | `false` |
| `--dry-run` | `-d` | Dry run (don't update Firebase) | `false` |
| `--yes` | `-y` | Skip confirmation prompt | `false` |

## API Reference

### TranslationsProvider Props

| Prop | Type | Description | Default |
|------|------|-------------|---------|
| `defaultLocale` | `string` | Default locale to use | `"tr"` |
| `fallbackLocale` | `string` | Fallback locale when translation is missing | `"en"` |
| `translations` | `object` | Initial translations object | Built-in translations |
| `storageKey` | `string` | AsyncStorage key for storing locale | `"@translations:locale"` |
| `translationsPath` | `string` | Firebase path for translations | `"translations"` |
| `translationsVersionPath` | `string` | Firebase path for translations version | `"translations_version"` |
| `disableFirebaseSync` | `boolean` | Disable Firebase synchronization | `false` |
| `databaseURL` | `string` | Firebase database URL | Required if Firebase sync is enabled |

### useTranslations Hook

| Property | Type | Description |
|----------|------|-------------|
| `t` | `function` | Translation function |
| `locale` | `string` | Current locale |
| `setLocale` | `function` | Function to change locale |
| `availableLocales` | `string[]` | List of available locales |
| `isLoading` | `boolean` | Loading state |
| `translationsVersion` | `number` | Current translations version |

## License

MIT
