import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/**', 'coverage/**', 'storage/**', 'apify_storage/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.strict,
    {
        files: ['**/*.ts'],
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
        },
    },
);
