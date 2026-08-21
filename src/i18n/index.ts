import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enCommon from "./locales/en/common.json";
import enNav from "./locales/en/nav.json";
import enSettings from "./locales/en/settings.json";
import enGate from "./locales/en/gate.json";
import enSearch from "./locales/en/search.json";
import enLocal from "./locales/en/local.json";
import enSpotify from "./locales/en/spotify.json";
import enKnowledge from "./locales/en/knowledge.json";
import enHistory from "./locales/en/history.json";
import enProfile from "./locales/en/profile.json";
import enAccount from "./locales/en/account.json";

import frCommon from "./locales/fr/common.json";
import frNav from "./locales/fr/nav.json";
import frSettings from "./locales/fr/settings.json";
import frGate from "./locales/fr/gate.json";
import frSearch from "./locales/fr/search.json";
import frLocal from "./locales/fr/local.json";
import frSpotify from "./locales/fr/spotify.json";
import frKnowledge from "./locales/fr/knowledge.json";
import frHistory from "./locales/fr/history.json";
import frProfile from "./locales/fr/profile.json";
import frAccount from "./locales/fr/account.json";

export type AppLocale = "en" | "fr";

export const NAMESPACES = [
  "common",
  "nav",
  "settings",
  "gate",
  "search",
  "local",
  "spotify",
  "knowledge",
  "history",
  "profile",
  "account",
] as const;

export type AppNamespace = (typeof NAMESPACES)[number];

export function detectBrowserLocale(): AppLocale {
  if (typeof navigator === "undefined") {
    return "en";
  }
  const lang = (navigator.language || "").toLowerCase();
  return lang.startsWith("fr") ? "fr" : "en";
}

export function intlLocale(locale: AppLocale): "en-US" | "fr-FR" {
  return locale === "fr" ? "fr-FR" : "en-US";
}

export function applyDocumentLang(locale: AppLocale): void {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = locale;
}

const resources = {
  en: {
    common: enCommon,
    nav: enNav,
    settings: enSettings,
    gate: enGate,
    search: enSearch,
    local: enLocal,
    spotify: enSpotify,
    knowledge: enKnowledge,
    history: enHistory,
    profile: enProfile,
    account: enAccount,
  },
  fr: {
    common: frCommon,
    nav: frNav,
    settings: frSettings,
    gate: frGate,
    search: frSearch,
    local: frLocal,
    spotify: frSpotify,
    knowledge: frKnowledge,
    history: frHistory,
    profile: frProfile,
    account: frAccount,
  },
} as const;

const initialLng = detectBrowserLocale();

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLng,
  fallbackLng: "en",
  defaultNS: "common",
  ns: [...NAMESPACES],
  interpolation: {
    escapeValue: false,
  },
  returnNull: false,
});

applyDocumentLang(initialLng);

i18n.on("languageChanged", (lng: string) => {
  applyDocumentLang(lng.startsWith("fr") ? "fr" : "en");
});

export default i18n;
