import { useTranslation } from 'react-i18next'

import {
  LANGUAGE_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  getResolvedLocale,
  type SupportedLanguage,
} from '../i18n'

interface LanguageSwitchProps {
  compact?: boolean
}

export function LanguageSwitch({ compact = false }: LanguageSwitchProps) {
  const { i18n, t } = useTranslation()
  const currentLanguage = getResolvedLocale(i18n.resolvedLanguage)

  function handleChange(language: SupportedLanguage) {
    void i18n.changeLanguage(language)
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language)
  }

  if (compact) {
    const nextLanguage = currentLanguage === 'en' ? 'pt-BR' : 'en'
    const nextLabel = languageLabel(nextLanguage, t)

    return (
      <button
        aria-label={t('language.switchTo', { language: nextLabel })}
        className="flex h-9 w-9 items-center justify-center rounded-md bg-transparent text-[0.62rem] font-semibold text-slate-400 transition hover:bg-white/[0.06] hover:text-white"
        onClick={() => handleChange(nextLanguage)}
        title={t('language.switchTo', { language: nextLabel })}
        type="button"
      >
        {languageShortLabel(currentLanguage)}
      </button>
    )
  }

  return (
    <div
      aria-label={t('language.ariaLabel')}
      className="inline-flex rounded-md border border-white/[0.08] bg-white/[0.025] p-0.5"
      role="group"
    >
      {SUPPORTED_LANGUAGES.map((language) => {
        const isActive = language === currentLanguage

        return (
          <button
            aria-pressed={isActive}
            className={`h-6 rounded px-2 text-[0.62rem] font-semibold transition ${
              isActive
                ? 'bg-white text-slate-950'
                : 'text-slate-500 hover:bg-white/[0.06] hover:text-white'
            }`}
            key={language}
            onClick={() => handleChange(language)}
            title={languageLabel(language, t)}
            type="button"
          >
            {languageShortLabel(language)}
          </button>
        )
      })}
    </div>
  )
}

function languageShortLabel(language: SupportedLanguage) {
  return language === 'en' ? 'EN' : 'PT'
}

function languageLabel(language: SupportedLanguage, t: (key: string) => string) {
  return language === 'en' ? t('language.english') : t('language.portuguese')
}
