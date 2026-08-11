import * as vscode from 'vscode';
import ruMessagesJson from '../l10n/bundle.l10n.ru.json' with { type: 'json' };

type L10nArg = string | number | boolean;
type RuntimeLanguage = 'en' | 'ru';

const ruMessages = ruMessagesJson as Readonly<Record<string, string>>;
let currentLanguage: RuntimeLanguage = vscode.env.language.toLowerCase().startsWith('ru')
  ? 'ru'
  : 'en';

export function setRuntimeLocale(locale?: string): void {
  if (!locale) {
    currentLanguage = vscode.env.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
    return;
  }
  currentLanguage = /^ru(?:[_-]|$)/i.test(locale) ? 'ru' : 'en';
}

export function runtimeLanguage(): RuntimeLanguage {
  return currentLanguage;
}

export function t(message: string, ...args: L10nArg[]): string {
  const template = currentLanguage === 'ru' ? (ruMessages[message] ?? message) : message;
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}

export function localeNumber(value: number): string {
  return value.toLocaleString(currentLanguage === 'ru' ? 'ru-RU' : 'en-US');
}

export function fileCount(value: number): string {
  if (currentLanguage !== 'ru') return `${localeNumber(value)} ${value === 1 ? 'file' : 'files'}`;
  const mod100 = value % 100;
  const mod10 = value % 10;
  const noun =
    mod100 >= 11 && mod100 <= 14
      ? 'файлов'
      : mod10 === 1
        ? 'файл'
        : mod10 >= 2 && mod10 <= 4
          ? 'файла'
          : 'файлов';
  return `${localeNumber(value)} ${noun}`;
}
