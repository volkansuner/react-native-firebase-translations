import * as React from "react";
import { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultLocale } from "../translations/defaultLocale";
import defaultTranslations from "../translations";
import { TRANSLATIONS_VERSION } from "../translations";
import database from "@react-native-firebase/database";

// defaultLocale'den tip çıkarımı
type TranslationKeys = keyof typeof defaultLocale;

// Context tipi tanımlamaları
export type TranslationsData = Record<string, Record<string, any>>;
export type TranslationsContextType = {
  t: (key: TranslationKeys, params?: Record<string, any>) => string;
  locale: string;
  setLocale: (locale: string) => Promise<void>;
  isLoading: boolean;
  availableLocales: string[];
  refreshTranslations: () => Promise<void>;
  translationsVersion: number;
};

// Context'in varsayılan değerleri
const defaultContext: TranslationsContextType = {
  t: (key: TranslationKeys) => String(key),
  locale: "tr",
  setLocale: async () => {},
  isLoading: true,
  availableLocales: [],
  refreshTranslations: async () => {},
  translationsVersion: TRANSLATIONS_VERSION,
};

// Context oluşturma
const TranslationsContext =
  createContext<TranslationsContextType>(defaultContext);

// Provider props tipi
export type TranslationsProviderProps = {
  children: React.ReactNode;
  defaultLocale?: string;
  fallbackLocale?: string;
  translations?: Record<string, any>;
  storageKey?: string;
  translationsPath?: string;
  translationsVersionPath?: string;
  disableFirebaseSync?: boolean;
  databaseURL?: string;
  /** Polling interval in ms for checking version updates. Default: 30000 (30s). Set to 0 to disable. */
  pollingInterval?: number;
};

export const TranslationsProvider: React.FC<TranslationsProviderProps> = ({
  children,
  defaultLocale = "tr",
  fallbackLocale = "en",
  translations = defaultTranslations,
  storageKey = "@translations:locale",
  translationsPath = "translations",
  translationsVersionPath = "translations_version",
  disableFirebaseSync = false,
  databaseURL,
}) => {
  const [locale, setLocaleState] = useState(defaultLocale);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [translationsData, setTranslationsData] =
    useState<TranslationsData>(translations);
  const [translationsVersion, setTranslationsVersion] =
    useState(TRANSLATIONS_VERSION);
  const availableLocales = Object.keys(translationsData);

  // Parametre interpolasyonu için yardımcı fonksiyon
  const interpolateParams = (
    text: string,
    params?: Record<string, any>,
  ): string => {
    if (!params) return text;

    return Object.entries(params).reduce((result, [key, value]) => {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      return result.replace(regex, String(value));
    }, text);
  };

  // Çeviri fonksiyonu
  const t = (key: string, params?: Record<string, any>): string => {
    // Nokta notasyonu ile nested objelere erişim (örn: "welcome.message")
    const keys = key.split(".");
    let value: any = translationsData[locale];

    // Anahtarı takip ederek değere ulaşmaya çalış
    for (const k of keys) {
      if (value && typeof value === "object" && k in value) {
        value = value[k];
      } else {
        // Mevcut dilde bulunamadıysa, fallback dilde dene
        if (locale !== fallbackLocale) {
          let fallbackValue = translationsData[fallbackLocale];
          let found = true;

          for (const fk of keys) {
            if (
              fallbackValue &&
              typeof fallbackValue === "object" &&
              fk in fallbackValue
            ) {
              fallbackValue = fallbackValue[fk];
            } else {
              found = false;
              break;
            }
          }

          if (found && typeof fallbackValue === "string") {
            return interpolateParams(fallbackValue, params);
          }
        }

        // Hiçbir dilde bulunamadıysa anahtarı döndür
        return key;
      }
    }

    // Değer bir string değilse, anahtarı döndür
    if (typeof value !== "string") {
      return key;
    }

    // Parametreleri değiştir ve sonucu döndür
    return interpolateParams(value, params);
  };

  // Dil değiştirme fonksiyonu
  const setLocale = async (newLocale: string): Promise<void> => {
    if (availableLocales.includes(newLocale)) {
      try {
        // First save to AsyncStorage to ensure persistence
        await AsyncStorage.setItem(storageKey, newLocale);

        // Then update the state
        setLocaleState(newLocale);

        console.log(
          `[Translations] Locale set to "${newLocale}" and saved to storage`,
        );
      } catch (error) {
        console.error(
          "[Translations] Failed to save locale to AsyncStorage:",
          error,
        );
        // Still update the state even if storage fails
        setLocaleState(newLocale);
      }
    } else {
      console.warn(
        `[Translations] Locale "${newLocale}" is not available. Available locales: ${availableLocales.join(", ")}`,
      );
    }
  };

  // Get database instance helper
  const getDb = () => {
    if (databaseURL) {
      return database().app.database(databaseURL);
    }
    return database();
  };

  // Firebase'den çevirileri yenileme fonksiyonu
  const refreshTranslations = async (): Promise<void> => {
    if (disableFirebaseSync) return;

    try {
      setIsLoading(true);
      await fetchAndUpdateTranslations();
    } catch (error) {
      console.error("[Translations] Failed to refresh translations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Add a new function to fetch and update translations
  const fetchAndUpdateTranslations = async (): Promise<void> => {
    try {
      const db = getDb();
      const translationsRef = db.ref(translationsPath);
      const snapshot = await translationsRef.once("value");
      const firebaseTranslations = snapshot.val();

      if (firebaseTranslations) {
        // Process and update translations
        const processedTranslations: Record<string, any> = {};
        const keys = Object.keys(firebaseTranslations);

        // Tüm dilleri bul
        let languages: string[] = [];
        if (keys.length > 0) {
          languages = Object.keys(firebaseTranslations[keys[0]]);
        }

        // Dil nesnelerini başlat
        languages.forEach((lang) => {
          processedTranslations[lang] = {};
        });

        // Her dil için çevirileri doldur
        keys.forEach((key) => {
          if (!key.startsWith("---")) {
            languages.forEach((lang) => {
              if (
                firebaseTranslations[key] &&
                firebaseTranslations[key][lang]
              ) {
                processedTranslations[lang][key] =
                  firebaseTranslations[key][lang];
              }
            });
          }
        });

        // Çevirileri güncelle
        setTranslationsData(processedTranslations);

        // AsyncStorage'a kaydet
        await AsyncStorage.setItem(
          "@translations:data",
          JSON.stringify(processedTranslations),
        );
      }
    } catch (error) {
      console.error("[Translations] Failed to fetch translations:", error);
    }
  };

  // Setup real-time listener for version changes using class-based API
  useEffect(() => {
    if (disableFirebaseSync) return;

    const db = getDb();
    const versionRef = db.ref(translationsVersionPath);

    console.log("[Translations] Setting up Firebase version listener...");

    // Define the callback function
    const onVersionChange = async (snapshot: any) => {
      console.log("[Translations] Firebase snapshot received");

      const versionData = snapshot.val();
      console.log(
        "[Translations] Version data from Firebase:",
        JSON.stringify(versionData),
      );

      // Support both formats: {version: 86} or just 86
      let remoteVersion = 0;
      if (typeof versionData === "number") {
        remoteVersion = versionData;
      } else if (typeof versionData === "object" && versionData?.version) {
        remoteVersion = versionData.version;
      }

      console.log(`[Translations] Remote version: ${remoteVersion}`);

      // Always read the current stored version fresh from AsyncStorage
      const savedVersion = await AsyncStorage.getItem("@translations:version");
      const currentStoredVersion = savedVersion ? parseInt(savedVersion) : 0;

      console.log(
        `[Translations] Current stored version: ${currentStoredVersion}`,
      );

      if (remoteVersion > currentStoredVersion) {
        console.log(
          `[Translations] Updating translations from version ${currentStoredVersion} to ${remoteVersion}`,
        );

        // Update version state and storage
        setTranslationsVersion(remoteVersion);
        await AsyncStorage.setItem(
          "@translations:version",
          String(remoteVersion),
        );

        // Fetch and update translations
        await fetchAndUpdateTranslations();

        console.log("[Translations] Translations updated successfully");
      } else {
        console.log(
          "[Translations] No update needed, versions are equal or local is newer",
        );
      }
    };

    // Subscribe to value changes (deprecated but try anyway)
    versionRef.on("value", onVersionChange);

    // Clean up listener on unmount
    return () => {
      versionRef.off("value", onVersionChange);
      console.log("[Translations] Version listener removed");
    };
  }, [disableFirebaseSync, databaseURL]);

  // Polling fallback for version updates (in case realtime listener doesn't work)
  useEffect(() => {
    if (disableFirebaseSync) return;

    // Get polling interval from props or default to 30 seconds
    const interval = 30000; // Default polling interval
    if (interval <= 0) return;

    console.log(`[Translations] Starting polling fallback every ${interval}ms`);

    const checkVersionUpdate = async () => {
      try {
        const db = getDb();
        const versionRef = db.ref(translationsVersionPath);
        const snapshot = await versionRef.once("value");
        const versionData = snapshot.val();

        // Support both formats
        let remoteVersion = 0;
        if (typeof versionData === "number") {
          remoteVersion = versionData;
        } else if (typeof versionData === "object" && versionData?.version) {
          remoteVersion = versionData.version;
        }

        const savedVersion = await AsyncStorage.getItem(
          "@translations:version",
        );
        const currentStoredVersion = savedVersion ? parseInt(savedVersion) : 0;

        if (remoteVersion > currentStoredVersion) {
          console.log(
            `[Translations] Polling detected update: ${currentStoredVersion} -> ${remoteVersion}`,
          );

          setTranslationsVersion(remoteVersion);
          await AsyncStorage.setItem(
            "@translations:version",
            String(remoteVersion),
          );
          await fetchAndUpdateTranslations();

          console.log("[Translations] Translations updated via polling");
        }
      } catch (error) {
        // Silent fail for polling
      }
    };

    const pollingTimer = setInterval(checkVersionUpdate, interval);

    return () => {
      clearInterval(pollingTimer);
      console.log("[Translations] Polling stopped");
    };
  }, [disableFirebaseSync, databaseURL]);

  // İlk yükleme
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);

        // AsyncStorage'dan kaydedilmiş dil bilgisini yükle
        const savedLocale = await AsyncStorage.getItem(storageKey);
        console.log(
          `[Translations] Retrieved locale from storage: ${savedLocale || "none"}`,
        );

        if (savedLocale) {
          console.log(`[Translations] Found locale in storage: ${savedLocale}`);
          if (availableLocales.includes(savedLocale)) {
            console.log(
              `[Translations] Setting locale from storage: ${savedLocale}`,
            );
            setLocaleState(savedLocale);
          } else {
            // AsyncStorage'dan kaydedilmiş çeviri verilerini yükle
            const savedTranslationsData =
              await AsyncStorage.getItem("@translations:data");

            if (savedTranslationsData) {
              const parsedData = JSON.parse(savedTranslationsData);
              if (parsedData && parsedData[savedLocale]) {
                console.log(
                  `[Translations] Found saved locale "${savedLocale}" in cached translations`,
                );
                setTranslationsData(parsedData);
                setLocaleState(savedLocale);
              } else {
                setLocaleState(defaultLocale);
              }
            } else {
              setLocaleState(defaultLocale);
            }
          }
        } else {
          console.log(
            `[Translations] No saved locale, using default: ${defaultLocale}`,
          );
          setLocaleState(defaultLocale);
        }

        // AsyncStorage'dan kaydedilmiş çeviri verilerini yükle
        const savedTranslationsData =
          await AsyncStorage.getItem("@translations:data");
        const savedVersion = await AsyncStorage.getItem(
          "@translations:version",
        );

        if (savedTranslationsData && savedVersion) {
          const parsedData = JSON.parse(savedTranslationsData);
          const parsedVersion = Number(savedVersion);

          setTranslationsData(parsedData);
          setTranslationsVersion(parsedVersion);
          console.log(
            `[Translations] Loaded cached translations, version: ${parsedVersion}`,
          );
        }

        // Firebase'den aktif versiyon kontrolü yap
        if (!disableFirebaseSync) {
          try {
            console.log(
              "[Translations] Checking Firebase for version updates...",
            );
            const db = getDb();
            const versionRef = db.ref(translationsVersionPath);

            const versionSnapshot = await versionRef.once("value");
            const versionData = versionSnapshot.val();

            console.log(
              "[Translations] Firebase version data:",
              JSON.stringify(versionData),
            );

            // Support both formats: {version: 86} or just 86
            let remoteVersion = 0;
            if (typeof versionData === "number") {
              remoteVersion = versionData;
            } else if (
              typeof versionData === "object" &&
              versionData?.version
            ) {
              remoteVersion = versionData.version;
            }

            const currentStoredVersion = savedVersion
              ? parseInt(savedVersion)
              : 0;

            console.log(
              `[Translations] Remote version: ${remoteVersion}, Local version: ${currentStoredVersion}`,
            );

            if (remoteVersion > currentStoredVersion) {
              console.log(
                `[Translations] New version available! Updating from ${currentStoredVersion} to ${remoteVersion}`,
              );

              // Update version state and storage
              setTranslationsVersion(remoteVersion);
              await AsyncStorage.setItem(
                "@translations:version",
                String(remoteVersion),
              );

              // Fetch and update translations
              await fetchAndUpdateTranslations();

              console.log("[Translations] Translations updated successfully!");
            } else {
              console.log("[Translations] Translations are up to date");
            }
          } catch (firebaseError) {
            console.error(
              "[Translations] Failed to check Firebase for updates:",
              firebaseError,
            );
          }
        }
      } catch (error) {
        console.error(
          "[Translations] Failed to initialize translations:",
          error,
        );
      } finally {
        setIsLoading(false);
      }
    };

    initialize();
  }, []);

  // Context değeri
  const contextValue: TranslationsContextType = {
    t,
    locale,
    setLocale,
    isLoading,
    availableLocales,
    refreshTranslations,
    translationsVersion,
  };

  return (
    <TranslationsContext.Provider value={contextValue}>
      {children}
    </TranslationsContext.Provider>
  );
};

// Custom hook
export const useTranslations = (): TranslationsContextType => {
  const context = useContext(TranslationsContext);

  if (context === undefined) {
    throw new Error(
      "useTranslations must be used within a TranslationsProvider",
    );
  }

  return context;
};
