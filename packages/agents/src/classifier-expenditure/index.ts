export { makeExpenditureClassifier, _setExpenditureClassifierForTests } from './factory.js';
export { HaikuExpenditureClassifier } from './haiku.js';
export { StubExpenditureClassifier } from './stub.js';
export { EXPENDITURE_CONFIDENCE_THRESHOLDS } from './thresholds.js';
export * from './types.js';
// Side-effect import: registers `classify-expenditure@1.0.0` in the prompt
// registry on package import so consumers don't have to remember to import
// the prompt module themselves.
import './prompts/classify-expenditure@1.0.0.js';
