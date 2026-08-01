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

export function analyzeKubeJs(source: string): readonly StaticIssue[] {
  const issues: StaticIssue[] = [];
  const lines = source.split(/\r?\n/u);
  let braceBalance = 0;

  lines.forEach((line, index) => {
    const evalIndex = line.search(/\beval\s*\(/u);
    if (evalIndex >= 0) {
      issues.push({
        severity: 'error',
        message: 'Avoid eval(): KubeVS cannot safely analyze or generate arbitrary code.',
        line: index,
        startCharacter: evalIndex,
        endCharacter: evalIndex + 4,
        code: 'kubevs/no-eval',
      });
    }

    const eventIndex = line.indexOf('ServerEvents.');
    if (eventIndex >= 0 && !line.includes('(')) {
      issues.push({
        severity: 'warning',
        message: 'This KubeJS event declaration appears incomplete.',
        line: index,
        startCharacter: eventIndex,
        endCharacter: eventIndex + 'ServerEvents'.length,
        code: 'kubevs/incomplete-event',
      });
    }

    for (const character of stripStringsAndComments(line)) {
      if (character === '{') braceBalance += 1;
      if (character === '}') braceBalance -= 1;
    }
    if (braceBalance < 0) {
      issues.push({
        severity: 'error',
        message: 'Unexpected closing brace.',
        line: index,
        startCharacter: Math.max(0, line.lastIndexOf('}')),
        endCharacter: Math.max(1, line.lastIndexOf('}') + 1),
        code: 'kubevs/unbalanced-brace',
      });
      braceBalance = 0;
    }
  });

  if (braceBalance > 0) {
    const lastLine = Math.max(0, lines.length - 1);
    issues.push({
      severity: 'error',
      message: `${braceBalance} closing brace${braceBalance === 1 ? '' : 's'} missing.`,
      line: lastLine,
      startCharacter: lines[lastLine]?.length ?? 0,
      endCharacter: (lines[lastLine]?.length ?? 0) + 1,
      code: 'kubevs/unbalanced-brace',
    });
  }

  return issues;
}

function stripStringsAndComments(line: string): string {
  return line
    .replace(/\/\/.*$/u, '')
    .replace(/'(?:\\.|[^'\\])*'/gu, '')
    .replace(/"(?:\\.|[^"\\])*"/gu, '')
    .replace(/`(?:\\.|[^`\\])*`/gu, '');
}
