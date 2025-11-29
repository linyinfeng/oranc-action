import js from '@eslint/js';
import ts from 'typescript-eslint';
import tsParser from '@typescript-eslint/parser';
import github from 'eslint-plugin-github'
import prettierRecommended from 'eslint-plugin-prettier/recommended';

export default ts.config(
  js.configs.recommended,
  ts.configs.eslintRecommended,
  github.getFlatConfigs().recommended,
  ...github.getFlatConfigs().typescript,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
    },
  },
  { ignores: ['dist/', 'lib/', 'node_modules/'] },
  prettierRecommended,
);
