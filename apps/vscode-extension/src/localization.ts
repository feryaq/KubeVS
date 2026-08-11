type L10nArg = string | number | boolean;
type RuntimeLanguage = 'en';

export function setRuntimeLocale(locale?: string): void {
  void locale;
  // KubeVS is intentionally English-only.
}

export function runtimeLanguage(): RuntimeLanguage {
  return 'en';
}

export function t(message: string, ...args: L10nArg[]): string {
  return message.replace(/\{(\d+)\}/g, (placeholder, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? placeholder : String(value);
  });
}

export function localeNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function fileCount(value: number): string {
  return `${localeNumber(value)} ${value === 1 ? 'file' : 'files'}`;
}
