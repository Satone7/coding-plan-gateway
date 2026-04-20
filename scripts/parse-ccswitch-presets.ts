/**
 * Build-time parser for cc-switch provider presets.
 * Reads vendor/cc-switch/src/config/claudeProviderPresets.ts,
 * extracts provider data, applies mapping overrides,
 * and writes src/config/generated-providers.ts.
 */
import * as ts from 'typescript';
import * as fs from 'fs';
import * as path from 'path';
import { CC_SWITCH_MAPPING } from '../src/config/ccswitch-mapping';

const VENDOR_FILE = path.resolve(__dirname, '../vendor/cc-switch/src/config/claudeProviderPresets.ts');
const OUTPUT_FILE = path.resolve(__dirname, '../src/config/generated-providers.ts');

// --- AST helpers ---

function findArrayLiteral(sourceFile: ts.SourceFile, varName: string): ts.ArrayLiteralExpression | null {
  let result: ts.ArrayLiteralExpression | null = null;

  function walk(node: ts.Node) {
    if (result) return;
    if (ts.isVariableDeclaration(node)) {
      const name = node.name.getText(sourceFile);
      if (name === varName && node.initializer && ts.isArrayLiteralExpression(node.initializer)) {
        result = node.initializer;
        return;
      }
    }
    ts.forEachChild(node, walk);
  }

  ts.forEachChild(sourceFile, walk);
  return result;
}

function getStringProp(sourceFile: ts.SourceFile, obj: ts.ObjectLiteralExpression, propName: string): string | undefined {
  for (const prop of obj.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (prop.name.getText(sourceFile) !== propName) continue;
    const init = prop.initializer;
    if (ts.isStringLiteral(init)) return init.text;
    // Handle template literals (e.g., `${VAR}/path`) — treat as unusable
    if (ts.isNoSubstitutionTemplateLiteral(init)) return init.text;
    if (ts.isTemplateExpression(init)) return undefined; // has substitutions
  }
  return undefined;
}

function hasProperty(sourceFile: ts.SourceFile, obj: ts.ObjectLiteralExpression, propName: string): boolean {
  for (const prop of obj.properties) {
    if (ts.isPropertyAssignment(prop) && prop.name.getText(sourceFile) === propName) return true;
  }
  return false;
}

function getEnvValue(sourceFile: ts.SourceFile, preset: ts.ObjectLiteralExpression, envKey: string): string | undefined {
  for (const prop of preset.properties) {
    if (!ts.isPropertyAssignment(prop)) continue;
    if (prop.name.getText(sourceFile) !== 'settingsConfig') continue;
    if (!ts.isObjectLiteralExpression(prop.initializer)) continue;
    for (const sProp of prop.initializer.properties) {
      if (!ts.isPropertyAssignment(sProp)) continue;
      if (sProp.name.getText(sourceFile) !== 'env') continue;
      if (!ts.isObjectLiteralExpression(sProp.initializer)) continue;
      return getStringProp(sourceFile, sProp.initializer, envKey);
    }
  }
  return undefined;
}

// --- Data extraction ---

interface RawPreset {
  name: string;
  baseUrl: string | undefined;
  models: string[];
  category: string | undefined;
  apiFormat: string | undefined;
  hasTemplateValues: boolean;
}

const MODEL_ENV_KEYS = [
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
];

function extractPreset(sourceFile: ts.SourceFile, obj: ts.ObjectLiteralExpression): RawPreset | null {
  const name = getStringProp(sourceFile, obj, 'name');
  if (!name) return null;

  const baseUrl = getEnvValue(sourceFile, obj, 'ANTHROPIC_BASE_URL');

  const models: string[] = [];
  for (const key of MODEL_ENV_KEYS) {
    const val = getEnvValue(sourceFile, obj, key);
    if (val && !models.includes(val)) models.push(val);
  }

  const category = getStringProp(sourceFile, obj, 'category');
  const apiFormat = getStringProp(sourceFile, obj, 'apiFormat');
  const hasTemplateValues = hasProperty(sourceFile, obj, 'templateValues');

  return { name, baseUrl, models, category, apiFormat, hasTemplateValues };
}

// --- Slug generation ---

function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// --- Main ---

function main() {
  if (!fs.existsSync(VENDOR_FILE)) {
    console.error(`Error: cc-switch preset file not found at ${VENDOR_FILE}`);
    console.error('Make sure the git submodule is initialized: git submodule update --init');
    process.exit(1);
  }

  const sourceText = fs.readFileSync(VENDOR_FILE, 'utf-8');
  const sourceFile = ts.createSourceFile(
    'claudeProviderPresets.ts',
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const arrayLit = findArrayLiteral(sourceFile, 'providerPresets');
  if (!arrayLit) {
    console.error('Error: Could not find providerPresets array in cc-switch source');
    process.exit(1);
  }

  const { idOverrides, excludePresets, usageApiProviders, providerOverrides } = CC_SWITCH_MAPPING;
  const excludeSet = new Set(excludePresets);

  // Extract and filter presets
  const presets: Array<{
    id: string;
    name: string;
    baseUrl: string;
    models: string[];
    category?: string;
    apiFormat?: string;
    hasUsageApi: boolean;
  }> = [];

  for (const element of arrayLit.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue;

    const raw = extractPreset(sourceFile, element);
    if (!raw) continue;

    // Skip excluded presets
    if (excludeSet.has(raw.name)) {
      console.log(`  Skipping excluded preset: "${raw.name}"`);
      continue;
    }

    // Skip presets with template variables (e.g., ${ENDPOINT_ID})
    if (raw.hasTemplateValues) {
      console.log(`  Skipping template-variable preset: "${raw.name}"`);
      continue;
    }

    // Skip presets without baseUrl
    if (!raw.baseUrl) {
      console.log(`  Skipping preset without baseUrl: "${raw.name}"`);
      continue;
    }

    // Resolve provider ID
    const id = idOverrides[raw.name] ?? nameToSlug(raw.name);

    // Apply model overrides
    const override = providerOverrides[id];
    let models = [...raw.models];
    if (override?.excludeModels) {
      const exclude = new Set(override.excludeModels);
      models = models.filter((m) => !exclude.has(m));
    }
    if (override?.addModels) {
      for (const m of override.addModels) {
        if (!models.includes(m)) models.push(m);
      }
    }

    // Skip presets that end up with no models and no override additions
    // (they can still be used with custom models from config)

    const baseUrl = override?.baseUrl ?? raw.baseUrl;
    const hasUsageApi = usageApiProviders.includes(id);

    presets.push({
      id,
      name: raw.name,
      baseUrl,
      models,
      category: raw.category,
      apiFormat: raw.apiFormat,
      hasUsageApi,
    });

    console.log(`  ${id.padEnd(20)} ${raw.name.padEnd(25)} ${baseUrl}`);
  }

  // Generate output file
  const output = generateOutput(presets);
  fs.writeFileSync(OUTPUT_FILE, output, 'utf-8');
  console.log(`\nGenerated ${presets.length} providers -> ${path.relative(process.cwd(), OUTPUT_FILE)}`);
}

function generateOutput(presets: Array<{
  id: string;
  name: string;
  baseUrl: string;
  models: string[];
  category?: string;
  apiFormat?: string;
  hasUsageApi: boolean;
}>): string {
  const lines: string[] = [
    '/**',
    ' * AUTO-GENERATED FILE — DO NOT EDIT MANUALLY.',
    ' * Generated by scripts/parse-ccswitch-presets.ts from vendor/cc-switch.',
    ' */',
    '',
    `import type { ProviderPreset } from '@/types';`,
    '',
    'export const BUILTIN_PROVIDERS: readonly ProviderPreset[] = [',
  ];

  for (const p of presets) {
    const modelsStr = p.models.length > 0
      ? p.models.map((m) => `        '${m}'`).join(',\n') + ','
      : '';
    const optionalFields: string[] = [];
    if (p.category) optionalFields.push(`    category: '${p.category}',`);
    if (p.apiFormat) optionalFields.push(`    apiFormat: '${p.apiFormat}',`);

    lines.push('  {');
    lines.push(`    id: '${p.id}',`);
    lines.push(`    name: '${escapeStr(p.name)}',`);
    lines.push(`    baseUrl: '${escapeStr(p.baseUrl)}',`);
    lines.push(`    models: [`);
    lines.push(modelsStr);
    lines.push(`    ],`);
    lines.push(`    hasUsageApi: ${p.hasUsageApi},`);
    lines.push(...optionalFields);
    lines.push('  },');
  }

  lines.push('];');
  lines.push('');
  lines.push('/**');
  lines.push(' * Provider IDs for the built-in providers.');
  lines.push(' */');
  lines.push('export const BUILTIN_PROVIDER_IDS: readonly string[] = BUILTIN_PROVIDERS.map((p) => p.id);');
  lines.push('');
  lines.push('/**');
  lines.push(' * Look up a built-in provider by its ID.');
  lines.push(' */');
  lines.push('export function getBuiltinProvider(id: string): ProviderPreset | undefined {');
  lines.push('  return BUILTIN_PROVIDERS.find((p) => p.id === id);');
  lines.push('}');
  lines.push('');
  lines.push('/**');
  lines.push(' * Look up a built-in provider by its baseUrl (exact match, trailing-slash tolerant).');
  lines.push(' */');
  lines.push('export function getBuiltinProviderByBaseUrl(baseUrl: string): ProviderPreset | undefined {');
  lines.push("  const normalized = baseUrl.replace(/\\/+$/, '');");
  lines.push("  return BUILTIN_PROVIDERS.find((p) => p.baseUrl.replace(/\\/+$/, '') === normalized);");
  lines.push('}');
  lines.push('');

  return lines.join('\n');
}

function escapeStr(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

main();
