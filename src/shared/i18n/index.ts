import i18next, { type TFunction } from 'i18next'
import { initReactI18next } from 'react-i18next'

import { resources } from './resources'

export const DEFAULT_LANGUAGE = 'en'
export const LANGUAGE_STORAGE_KEY = 'openbanjo.language'
export const SUPPORTED_LANGUAGES = ['en', 'pt-BR'] as const

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export interface LocalizedErrorPayload {
  code?: string
  params?: Record<string, string | number | boolean | null>
  fallback?: string
}

function readStoredLanguage(): SupportedLanguage {
  try {
    const value = window.localStorage.getItem(LANGUAGE_STORAGE_KEY)

    return isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE
  } catch {
    return DEFAULT_LANGUAGE
  }
}

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as SupportedLanguage)
}

export function getResolvedLocale(language: string | undefined) {
  return isSupportedLanguage(language) ? language : DEFAULT_LANGUAGE
}

export function translateError(error: unknown, t: TFunction, fallbackKey = 'app.unexpectedError') {
  if (isLocalizedErrorPayload(error)) {
    const fallback = error.fallback ?? t(fallbackKey)

    return error.code
      ? t(`backend.${error.code}`, { defaultValue: fallback, ...(error.params ?? {}) })
      : fallback
  }

  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  return t(fallbackKey)
}

export function translateBackendMessage(
  message: LocalizedErrorPayload | string | null | undefined,
  t: TFunction,
) {
  if (!message) {
    return null
  }

  return translateError(message, t)
}

function isLocalizedErrorPayload(error: unknown): error is LocalizedErrorPayload {
  if (!error || typeof error !== 'object') {
    return false
  }

  return 'code' in error || 'fallback' in error
}

void i18next.use(initReactI18next).init({
  fallbackLng: DEFAULT_LANGUAGE,
  interpolation: {
    escapeValue: false,
  },
  lng: readStoredLanguage(),
  resources,
})

export { i18next }
