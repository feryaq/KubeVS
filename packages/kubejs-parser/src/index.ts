export type ScriptKind = 'server_scripts' | 'client_scripts' | 'startup_scripts';

export interface StaticIssue {
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly line: number;
  readonly startCharacter: number;
  readonly endCharacter: number;
  readonly code: string;
}

export function classifyScriptPath(path: string): ScriptKind | undefined {
  const normalized = path.replaceAll('\\', '/');
  return (['server_scripts', 'client_scripts', 'startup_scripts'] as const).find((kind) =>
    normalized.split('/').includes(kind),
  );
}

/**
 * Performs a deliberately small, non-executing lexical analysis of KubeJS.
 * This is not a JavaScript parser: it checks unsafe eval calls, a few common
 * event mistakes, and balanced braces while ignoring comments and literals.
 */
export function analyzeKubeJs(source: string, kind?: ScriptKind): readonly StaticIssue[] {
  const issues: StaticIssue[] = [];
  const lineStarts = [0];
  for (let i = 0; i < source.length; i += 1) {
    if (source[i] === '\n') lineStarts.push(i + 1);
  }

  const locate = (
    offset: number,
  ): Pick<StaticIssue, 'line' | 'startCharacter' | 'endCharacter'> => {
    let low = 0;
    let high = lineStarts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if ((lineStarts[middle] ?? 0) <= offset) low = middle;
      else high = middle;
    }
    const lineStart = lineStarts[low] ?? 0;
    return {
      line: low,
      startCharacter: offset - lineStart,
      endCharacter: offset - lineStart + 1,
    };
  };
  const report = (
    severity: StaticIssue['severity'],
    code: string,
    message: string,
    offset: number,
    width = 1,
  ): void => {
    const position = locate(offset);
    issues.push({
      severity,
      code,
      message,
      ...position,
      endCharacter: position.startCharacter + width,
    });
  };

  const braces: number[] = [];
  const lineHasCallParen = new Set<number>();
  const wrongKindSeen = new Set<string>();
  const evalMessage = 'Avoid eval(): KubeVS cannot safely analyze or generate arbitrary code.';
  const incompleteMessage = 'This KubeJS event declaration appears incomplete.';

  const isIdentifierStart = (character: string | undefined): boolean =>
    character !== undefined && /[$_\p{ID_Start}]/u.test(character);
  const isIdentifierPart = (character: string | undefined): boolean =>
    character !== undefined && /[$\u200c\u200d\p{ID_Continue}]/u.test(character);
  const isDigit = (character: string | undefined): boolean =>
    character !== undefined && /[0-9]/u.test(character);

  // Look past whitespace and comments so `eval /* comment */ (` is detected.
  const nextSignificant = (from: number): number => {
    let i = from;
    while (i < source.length) {
      if (/\s/u.test(source[i] ?? '')) {
        i += 1;
        continue;
      }
      if (source.startsWith('//', i)) {
        const newline = source.indexOf('\n', i + 2);
        i = newline < 0 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith('/*', i)) {
        const close = source.indexOf('*/', i + 2);
        i = close < 0 ? source.length : close + 2;
        continue;
      }
      break;
    }
    return i;
  };

  const expressionPrefixKeywords = new Set([
    'await',
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'new',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ]);

  const scanRegex = (start: number): number => {
    let i = start + 1;
    let inCharacterClass = false;
    while (i < source.length && source[i] !== '\n' && source[i] !== '\r') {
      const character = source[i] ?? '';
      if (character === '\\') {
        i += 2;
        continue;
      }
      if (character === '[') inCharacterClass = true;
      else if (character === ']') inCharacterClass = false;
      else if (character === '/' && !inCharacterClass) {
        i += 1;
        while (isIdentifierPart(source[i])) i += 1;
        return i;
      }
      i += 1;
    }
    // An unterminated slash is safer to treat as punctuation than to swallow
    // the rest of a file as a regex literal.
    return start + 1;
  };

  const scanString = (start: number, quote: string): number => {
    let i = start + 1;
    while (i < source.length) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === quote) return i + 1;
      if ((source[i] === '\n' || source[i] === '\r') && quote !== '`') return i;
      i += 1;
    }
    return i;
  };

  // scanCode returns at the matching `}` for a template substitution.
  const scanCode = (start: number, templateExpression = false): number => {
    let i = start;
    let localBraceDepth = 0;
    let canStartRegex = true;
    while (i < source.length) {
      const character = source[i] ?? '';
      if (/\s/u.test(character)) {
        i += 1;
        continue;
      }

      if (source.startsWith('//', i)) {
        const newline = source.indexOf('\n', i + 2);
        i = newline < 0 ? source.length : newline + 1;
        continue;
      }
      if (source.startsWith('/*', i)) {
        const close = source.indexOf('*/', i + 2);
        i = close < 0 ? source.length : close + 2;
        continue;
      }

      if (character === '}' && templateExpression && localBraceDepth === 0) {
        if (braces.length > 0) braces.pop();
        return i + 1;
      }
      if (character === '{') {
        braces.push(i);
        localBraceDepth += 1;
        canStartRegex = true;
        i += 1;
        continue;
      }
      if (character === '}') {
        if (braces.length > 0) braces.pop();
        else report('error', 'kubevs/unbalanced-brace', 'Unexpected closing brace.', i);
        if (localBraceDepth > 0) localBraceDepth -= 1;
        canStartRegex = false;
        i += 1;
        continue;
      }

      if (character === "'" || character === '"') {
        i = scanString(i, character);
        canStartRegex = false;
        continue;
      }
      if (character === '`') {
        i = scanTemplate(i);
        canStartRegex = false;
        continue;
      }
      if (character === '/' && canStartRegex) {
        const regexEnd = scanRegex(i);
        if (regexEnd > i + 1) {
          i = regexEnd;
          canStartRegex = false;
          continue;
        }
      }

      if (isIdentifierStart(character)) {
        const tokenStart = i;
        i += 1;
        while (isIdentifierPart(source[i])) i += 1;
        const identifier = source.slice(tokenStart, i);
        if (identifier === 'replaceInput' && source[nextSignificant(i)] === '(') {
          report(
            'warning',
            'kubevs/verify-replaced-inputs',
            'replaceInput depends on serializer support and may miss nested ingredients. After reload, verify the exact live recipe JSON; use an explicit recipe override if inputs remain unchanged.',
            tokenStart,
            identifier.length,
          );
        }
        if (identifier === 'eval' && source[nextSignificant(i)] === '(') {
          report('error', 'kubevs/no-eval', evalMessage, tokenStart, identifier.length);
        }
        if (
          (identifier === 'ServerEvents' || identifier === 'StartupEvents') &&
          source[i] === '.'
        ) {
          const line = locate(tokenStart).line;
          if (identifier === 'ServerEvents' && !lineHasCallParen.has(line)) {
            // Parentheses later on this line are considered below as tokens are
            // encountered; defer this small heuristic until the scan completes.
            incompleteEvents.push({ offset: tokenStart, line });
          }
          if (
            kind &&
            ((identifier === 'ServerEvents' && kind !== 'server_scripts') ||
              (identifier === 'StartupEvents' && kind === 'server_scripts'))
          ) {
            const key = `${identifier}:${tokenStart}`;
            if (!wrongKindSeen.has(key)) {
              wrongKindSeen.add(key);
              const expected =
                identifier === 'ServerEvents'
                  ? 'server_scripts'
                  : 'startup_scripts or client_scripts';
              report(
                'warning',
                'kubevs/wrong-event-kind',
                `${identifier} is usually used in ${expected}.`,
                tokenStart,
                identifier.length,
              );
            }
          }
        }
        canStartRegex = expressionPrefixKeywords.has(identifier);
        continue;
      }

      if (isDigit(character) || (character === '.' && isDigit(source[i + 1]))) {
        i += 1;
        while (i < source.length && /[\w.]/u.test(source[i] ?? '')) i += 1;
        canStartRegex = false;
        continue;
      }

      if (character === '(') lineHasCallParen.add(locate(i).line);
      if (character === ')' || character === ']' || character === '.') canStartRegex = false;
      else if ((character === '+' || character === '-') && source[i + 1] === character) {
        canStartRegex = false;
        i += 1;
      } else canStartRegex = true;
      i += 1;
    }
    return i;
  };

  const scanTemplate = (start: number): number => {
    let i = start + 1;
    while (i < source.length) {
      if (source[i] === '\\') {
        i += 2;
        continue;
      }
      if (source[i] === '`') return i + 1;
      if (source[i] === '$' && source[i + 1] === '{') {
        const braceOffset = i + 1;
        braces.push(braceOffset);
        i = scanCode(i + 2, true);
        continue;
      }
      i += 1;
    }
    return i;
  };

  const incompleteEvents: Array<{ offset: number; line: number }> = [];
  scanCode(0);

  for (const event of incompleteEvents) {
    if (!lineHasCallParen.has(event.line)) {
      report(
        'warning',
        'kubevs/incomplete-event',
        incompleteMessage,
        event.offset,
        'ServerEvents'.length,
      );
    }
  }

  if (braces.length > 0) {
    const offset = source.length;
    const count = braces.length;
    report(
      'error',
      'kubevs/unbalanced-brace',
      `${count} closing brace${count === 1 ? '' : 's'} missing.`,
      offset,
    );
  }

  return issues;
}
