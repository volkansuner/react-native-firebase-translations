
import * as React from "react";
import { createContext, useContext, useState, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { defaultLocale } from "../translations/defaultLocale";
import defaultTranslations from "../translations";
import { TRANSLATIONS_VERSION } from "../translations";
import { getApp } from "@react-native-firebase/app";
import {
  getDatabase,
  ref,
  onValue,
  get,
} from "@react-native-firebase/database";

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
  const [translationsData, setTranslationsData] = useState<TranslationsData>(translations);
  const [translationsVersion, setTranslationsVersion] =
    useState(TRANSLATIONS_VERSION);
  const availableLocales = Object.keys(translationsData);

  // Add a reference to store the unsubscribe function
  const [versionListener, setVersionListener] = useState<(() => void) | null>(null);

  // Parametre interpolasyonu için yardımcı fonksiyon
  const interpolateParams = (
    text: string,
    params?: Record<string, any>
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
        
        console.log(`Locale set to "${newLocale}" and saved to storage`);
      } catch (error) {
        console.error("Failed to save locale to AsyncStorage:", error);
        // Still update the state even if storage fails
        setLocaleState(newLocale);
      }
    } else {
      console.warn(
        `Locale "${newLocale}" is not available. Available locales: ${availableLocales.join(', ')}`
      );
    }
  };

  // Firebase'den çevirileri yenileme fonksiyonu
  const refreshTranslations = async (): Promise<void> => {
    if (disableFirebaseSync) return;

    try {
      setIsLoading(true);

      const app = getApp();
      const db = getDatabase(app, databaseURL);

      // Firebase'den çevirileri al
      await fetchAndUpdateTranslations(db);
    } catch (error) {
      console.error("Failed to refresh translations:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Add a new function to fetch and update translations
  const fetchAndUpdateTranslations = async (db: any): Promise<void> => {
    try {
      // Firebase'den çevirileri al
      const translationsRef = ref(db, translationsPath);
      const snapshot = await get(translationsRef);
      const firebaseTranslations = snapshot.val();

      if (firebaseTranslations) {
        // Process and update translations (existing code)
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
          JSON.stringify(processedTranslations)
        );
      }
    } catch (error) {
      console.error("Failed to fetch translations:", error);
    }
  };

  // Setup real-time listener for version changes
  useEffect(() => {
    if (disableFirebaseSync) return;

    const setupVersionListener = async () => {
      try {
        const app = getApp();
        const db = getDatabase(app, databaseURL);
        const versionRef = ref(db, translationsVersionPath);

        // Get current stored version
        const savedVersion = await AsyncStorage.getItem("@translations:version");
        const storedVersion = savedVersion ? parseInt(savedVersion) : 0;

        // Set up real-time listener
        const unsubscribe = onValue(
          versionRef,
          async (snapshot) => {

            const versionData = snapshot.val();
            const remoteVersion = versionData?.version || 0;

            if (remoteVersion > storedVersion) {
              console.log(
                `Updating translations from version ${translationsVersion} to ${remoteVersion}`
              );
              
              // Update version state and storage
              setTranslationsVersion(remoteVersion);
              await AsyncStorage.setItem(
                "@translations:version",
                String(remoteVersion)
              );
              
              // Fetch and update translations
              await fetchAndUpdateTranslations(db);
            }
          },
          (error) => {
            console.error("Error listening to translation version:", error);
          }
        );

        // Store unsubscribe function
        setVersionListener(() => unsubscribe);
      } catch (error) {
        console.error("Failed to set up version listener:", error);
      }
    };

    setupVersionListener();

    // Clean up listener on unmount
    return () => {
      if (versionListener) {
        versionListener();
      }
    };
  }, [disableFirebaseSync, databaseURL]);

  // İlk yükleme
  useEffect(() => {
    const initialize = async () => {
      try {
        setIsLoading(true);

        // AsyncStorage'dan kaydedilmiş dil bilgisini yükle
        const savedLocale = await AsyncStorage.getItem(storageKey);
        console.log(`Retrieved locale from storage: ${savedLocale || 'none'}`);
        if (savedLocale) {
          console.log(`Found locale in storage: ${savedLocale}`);
          if (availableLocales.includes(savedLocale)) {
            console.log(`Setting locale from storage: ${savedLocale}`);
            setLocaleState(savedLocale);
          } else {
            console.log(`Saved locale "${savedLocale}" not available in current translations`);
            
            // AsyncStorage'dan kaydedilmiş çeviri verilerini yükle
            const savedTranslationsData = await AsyncStorage.getItem("@translations:data");
            
            if (savedTranslationsData) {
              const parsedData = JSON.parse(savedTranslationsData);
              // AsyncStorage'deki çevirilerde bu dil var mı kontrol et
              if (parsedData && parsedData[savedLocale]) {
                console.log(`Found saved locale "${savedLocale}" in cached translations`);
                // Çevirileri güncelle ve dili ayarla
                setTranslationsData(parsedData);
                setLocaleState(savedLocale);
              } else {
                // Geçici olarak varsayılan dili kullan, önce AsyncStorage'deki çevirilerde kontrol et, sonra gerekirse Firebase'den çekilenlerde
                setLocaleState(defaultLocale);
                // Kaydedilen dili hatırla
                const rememberedLocale = savedLocale;
                // Firebase senkronizasyonu tamamlandıktan sonra tekrar kontrol et
                const checkLocaleAfterSync = () => {
                  if (availableLocales.includes(rememberedLocale)) {
                    console.log(`Setting remembered locale after sync: ${rememberedLocale}`);
                    setLocaleState(rememberedLocale);
                  }
                };
                // refreshTranslations tamamlandığında çalışacak bir listener ekle
                const originalIsLoadingSetter = setIsLoading;
                const wrappedSetIsLoading = (value: boolean) => {
                  originalIsLoadingSetter(value);
                  if (value === false) {
                    // Yükleme tamamlandığında kontrol et
                    checkLocaleAfterSync();
                    // Orijinal setter'ı geri yükle
                    // Don't reassign setIsLoading
                    // Instead, call the original function directly
                    checkLocaleAfterSync();
                  }
                };
              }
            } else {
              // AsyncStorage'de çeviri yoksa varsayılan dili kullan ve Firebase'i bekle
              setLocaleState(defaultLocale);
              // Kaydedilen dili hatırla ve Firebase senkronizasyonu sonrası kontrol et
              // ... (mevcut kod)
            }
          }
        } else {
          console.log(`No saved locale, using default: ${defaultLocale}`);
          setLocaleState(defaultLocale);
        }

        // AsyncStorage'dan kaydedilmiş çeviri verilerini yükle
        const savedTranslationsData = await AsyncStorage.getItem(
          "@translations:data"
        );
        const savedVersion = await AsyncStorage.getItem(
          "@translations:version"
        );

        if (savedTranslationsData && savedVersion) {
          const parsedData = JSON.parse(savedTranslationsData);
          const parsedVersion = Number(savedVersion);

          setTranslationsData(parsedData);
          setTranslationsVersion(parsedVersion);
        }

      } catch (error) {
        console.error("Failed to initialize translations:", error);
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
      "useTranslations must be used within a TranslationsProvider"
    );
  }

  return context;
};
