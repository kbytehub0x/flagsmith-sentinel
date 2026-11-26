import fs from 'fs';
import path from 'path';

export interface FlagUsage {
  flagName: string;
  filePath: string;
  lineNumber: number;
  snippet: string;
  patternType: 'if-else' | 'ternary' | 'method-call';
}

export interface RefactorDiff {
  filePath: string;
  flagName: string;
  originalContent: string;
  refactoredContent: string;
  linesRemoved: number;
  linesAdded: number;
  diffSummary: string;
}

export class RefactorEngine {
  /**
   * Scans a directory recursively for Flagsmith feature flag invocations
   */
  scanDirectory(dirPath: string): FlagUsage[] {
    const usages: FlagUsage[] = [];
    if (!fs.existsSync(dirPath)) return usages;

    const walk = (currentPath: string) => {
      const entries = fs.readdirSync(currentPath, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentPath, entry.name);
        if (entry.isDirectory()) {
          if (!['node_modules', '.git', 'dist'].includes(entry.name)) {
            walk(fullPath);
          }
        } else if (/\.(js|ts|jsx|tsx|py)$/.test(entry.name)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const fileUsages = this.scanFileContent(content, fullPath);
          usages.push(...fileUsages);
        }
      }
    };

    walk(dirPath);
    return usages;
  }

  scanFileContent(content: string, filePath: string): FlagUsage[] {
    const usages: FlagUsage[] = [];
    const lines = content.split('\n');

    const flagRegex = /(?:flagsmith|flags)\.(?:hasFeature|isFeatureEnabled)\(\s*['"]([a-zA-Z0-9_\-]+)['"]\s*\)/g;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let match;
      while ((match = flagRegex.exec(line)) !== null) {
        const flagName = match[1];
        const isTernary = line.includes('?') && line.includes(':');
        const isIf = line.includes('if');

        usages.push({
          flagName,
          filePath,
          lineNumber: i + 1,
          snippet: line.trim(),
          patternType: isTernary ? 'ternary' : isIf ? 'if-else' : 'method-call',
        });
      }
    }

    return usages;
  }

  /**
   * Helper to find matching closing brace using balanced brace counter
   */
  private findMatchingBrace(text: string, openBraceIndex: number): number {
    let depth = 0;
    for (let i = openBraceIndex; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  /**
   * Safely refactors a file removing the flag wrapper and retaining the desired branch
   */
  refactorFile(
    filePath: string,
    flagName: string,
    keepBranch: 'ENABLED' | 'DISABLED'
  ): RefactorDiff | null {
    if (!fs.existsSync(filePath)) return null;

    const originalContent = fs.readFileSync(filePath, 'utf-8');
    let refactored = originalContent;

    // 1. AST / Balanced-Brace parser for if-else statements
    const ifTarget = new RegExp(
      `if\\s*\\(\\s*(?:flagsmith|flags)\\.(?:hasFeature|isFeatureEnabled)\\(\\s*['"]${flagName}['"]\\s*\\)\\s*\\)\\s*\\{`,
      'g'
    );

    let match: RegExpExecArray | null;
    while ((match = ifTarget.exec(refactored)) !== null) {
      const ifStartIndex = match.index;
      const openBraceIndex = ifStartIndex + match[0].length - 1;
      const ifEndIndex = this.findMatchingBrace(refactored, openBraceIndex);
      if (ifEndIndex === -1) break;

      const ifBody = refactored.substring(openBraceIndex + 1, ifEndIndex);

      // Check if there is an else block following
      const postIfText = refactored.substring(ifEndIndex + 1);
      const elseMatch = /^\s*else\s*\{/.exec(postIfText);

      let totalEndIndex = ifEndIndex + 1;
      let elseBody = '';

      if (elseMatch) {
        const elseOpenBraceIndex = ifEndIndex + 1 + elseMatch.index + elseMatch[0].length - 1;
        const elseEndIndex = this.findMatchingBrace(refactored, elseOpenBraceIndex);
        if (elseEndIndex !== -1) {
          elseBody = refactored.substring(elseOpenBraceIndex + 1, elseEndIndex);
          totalEndIndex = elseEndIndex + 1;
        }
      }

      const replacement = keepBranch === 'ENABLED' ? ifBody : elseBody;
      refactored =
        refactored.substring(0, ifStartIndex) +
        replacement.trim() +
        refactored.substring(totalEndIndex);

      // Reset regex index for safety
      ifTarget.lastIndex = 0;
    }

    // 2. Pattern 2: Single-line ternary operations
    // flagsmith.hasFeature('flag') ? <ComponentA /> : <ComponentB />
    const ternaryRegex = new RegExp(
      `(?:flagsmith|flags)\\.(?:hasFeature|isFeatureEnabled)\\(\\s*['"]${flagName}['"]\\s*\\)\\s*\\?\\s*([^:\\n]+)\\s*:\\s*([^;\\n]+)`,
      'g'
    );

    refactored = refactored.replace(ternaryRegex, (_, trueExpr, falseExpr) => {
      return keepBranch === 'ENABLED' ? trueExpr.trim() : falseExpr.trim();
    });

    // 3. Clean up flagsmith import if no flags remain in file
    const remainingFlags = this.scanFileContent(refactored, filePath);
    if (remainingFlags.length === 0) {
      refactored = refactored.replace(/^import\s+.*(?:flagsmith|useFlags).*;\r?\n?/gm, '');
    }

    if (refactored === originalContent) {
      return null;
    }

    const origLines = originalContent.split('\n').length;
    const newLines = refactored.split('\n').length;

    const diff: RefactorDiff = {
      filePath,
      flagName,
      originalContent,
      refactoredContent: refactored,
      linesRemoved: Math.max(0, origLines - newLines),
      linesAdded: Math.max(0, newLines - origLines),
      diffSummary: `Refactored '${flagName}': Kept ${keepBranch} branch, simplified ${origLines} -> ${newLines} lines.`,
    };

    return diff;
  }

  /**
   * Applies the refactor directly to disk
   */
  applyRefactor(filePath: string, newContent: string): void {
    fs.writeFileSync(filePath, newContent, 'utf-8');
  }
}

export const refactorEngine = new RefactorEngine();
