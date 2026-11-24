import { mergeIncomingCaption, computePrefixOverlapRatio } from '../src/domain/merger';
import { buildNormalizer } from '../src/domain/normalizer';
import { CorrectionRule, TranscriptUtterance } from '../src/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✓ ${msg}`);
}

console.log('--- Testing Normalizer ---');
const rules: CorrectionRule[] = [
  {
    id: '1',
    pattern: 'kopa belt',
    replacement: 'Copperbelt',
    isRegex: false,
    caseSensitive: false,
    createdAt: new Date().toISOString()
  },
  {
    id: '2',
    pattern: 'meet vault',
    replacement: 'MeetVault',
    isRegex: false,
    caseSensitive: false,
    createdAt: new Date().toISOString()
  }
];

const normalizer = buildNormalizer(rules);
assert(
  normalizer('Welcome to kopa belt and use meet vault') === 'Welcome to Copperbelt and use MeetVault',
  'Normalizer substitutes case-insensitive phrase correctly'
);

console.log('\n--- Testing LCP Prefix Overlap ---');
const ratio1 = computePrefixOverlapRatio('Hello world', 'Hello world today');
assert(ratio1 === 1.0, 'Full prefix extension gives 1.0 overlap');

const ratio2 = computePrefixOverlapRatio('Good morning everyone', 'Good morning team');
assert(ratio2 >= 0.5, 'Partial phrase match gives >= 0.5 overlap');

console.log('\n--- Testing Sliding-Window Merger ---');
let utterances: TranscriptUtterance[] = [];

// 1. Initial partial caption
const step1 = mergeIncomingCaption(utterances, 'Alice', 'We are planning', 1000, normalizer);
utterances = step1.updatedList;
assert(utterances.length === 1, 'First utterance created');
assert(utterances[0].rawText === 'We are planning', 'Utterance has initial text');

// 2. Incremental extension by same speaker
const step2 = mergeIncomingCaption(utterances, 'Alice', 'We are planning the project for kopa belt', 2500, normalizer);
utterances = step2.updatedList;
assert(utterances.length === 1, 'Utterance updated in-place without duplicate row');
assert(utterances[0].cleanText === 'We are planning the project for Copperbelt', 'Clean text normalized');
assert(utterances[0].endTimeMs === 2500, 'End timestamp updated');

// 3. New speaker arrives
const step3 = mergeIncomingCaption(utterances, 'Bob', 'Sounds great to me', 3500, normalizer);
utterances = step3.updatedList;
assert(utterances.length === 2, 'New utterance created for Bob');
assert(utterances[0].isFinal === true, 'Alice utterance marked final');
assert(utterances[1].speaker === 'Bob', 'Bob is active speaker');

console.log('\nAll domain unit tests passed successfully!');
