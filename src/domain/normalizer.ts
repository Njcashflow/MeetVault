import { CorrectionRule } from '../types';

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds a side-effect-free normalization function from an array of correction rules.
 */
export function buildNormalizer(rules: CorrectionRule[]): (text: string) => string {
  const compiled = rules.map((rule) => {
    const source = rule.isRegex ? rule.pattern : `\\b${escapeRegExp(rule.pattern)}\\b`;
    const flags = rule.caseSensitive ? 'g' : 'gi';
    return { regex: new RegExp(source, flags), replacement: rule.replacement };
  });

  return (text: string): string => {
    return compiled.reduce((acc, { regex, replacement }) => acc.replace(regex, replacement), text);
  };
}
