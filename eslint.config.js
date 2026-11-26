const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = defineConfig(
  // landing/ is the public website: its own package, built and checked on its own (see landing/README.md).
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.superpowers/**', '.tmp/**', 'landing/**'] },
  tseslint.configs.recommended,
  { files: ['src/renderer/**/*.{ts,tsx}'], ...reactHooks.configs.flat.recommended },
  // CommonJS files (this config, the status line wrapper) legitimately use require().
  { files: ['**/*.{js,cjs}'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
);
