import * as p from '@clack/prompts';
import color from 'picocolors';
import { copyFile, access } from 'fs/promises';
import { dirname, join, basename } from 'path';
import { loadConfig, saveConfig, createEmptyConfig, normalizePlanConfig, buildCustomProvidersMap, type NormalizedConfig, type NormalizedPlanConfig } from '@/config';
import { configSchema } from '@/config/schema';
import { BUILTIN_PROVIDERS, getBuiltinProvider } from '@/config/builtin-providers';
import { DEFAULT_REQUEST_TIMEOUT_SEC, LATEST_CONFIG_VERSION } from '@/config/defaults';
import type { CliContext } from '@/types/cli';
import type { Config, PlanConfig } from '@/config/schema';
import { createGatewayNotifier } from '@/services/gateway-notifier';

/** Compare two string arrays ignoring element order. */
function arraysEqualUnordered(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Strip preset-duplicated fields from a normalized plan for persisting. */
function cleanPlanForPersist(plan: NormalizedPlanConfig): PlanConfig {
  // No provider — keep all fields
  if (!plan.provider) {
    return plan as PlanConfig;
  }

  const preset = getBuiltinProvider(plan.provider);
  if (!preset) {
    const out = plan as PlanConfig;
    // dynamicModels plans fetch models at runtime — never persist an empty/outdated list
    if (out.dynamicModels) {
      out.models = undefined;
    }
    return out;
  }

  const result: PlanConfig = {
    id: plan.id,
    name: plan.name,
    provider: plan.provider,
    apiKey: plan.apiKey,
    enable: plan.enable,
    status: plan.status,
  };

  // Keep timeout only if it differs from default
  if (plan.timeout !== undefined && plan.timeout !== DEFAULT_REQUEST_TIMEOUT_SEC) {
    result.timeout = plan.timeout;
  }
  if (plan.expiresOn !== undefined) result.expiresOn = plan.expiresOn;
  if (plan.expiresAt !== undefined) result.expiresAt = plan.expiresAt;
  if (plan.weight !== undefined) result.weight = plan.weight;

  // Keep baseUrl only if it differs from preset
  if (plan.baseUrl !== preset.baseUrl) {
    result.baseUrl = plan.baseUrl;
  }

  if (plan.openaiBaseUrl && plan.openaiBaseUrl !== preset.openaiBaseUrl) {
    result.openaiBaseUrl = plan.openaiBaseUrl;
  }

  // Keep quota only if provider doesn't have usage API
  if (!preset.hasUsageApi && plan.quota) {
    result.quota = plan.quota;
  }

  // Always keep user-configured modelAliases
  if (plan.modelAliases) {
    result.modelAliases = plan.modelAliases;
  }

  // Persist dynamicModels flag and excludes so runtime model fetching survives Save&Exit
  if (plan.dynamicModels) {
    result.dynamicModels = true;
    if (plan.modelsExclude) result.modelsExclude = plan.modelsExclude;
  }

  return result;
}

/** Clean normalized config for persisting to disk. */
function cleanConfigForOnboard(config: NormalizedConfig): Config {
  return {
    version: LATEST_CONFIG_VERSION,
    plans: config.plans.map(cleanPlanForPersist),
    loadBalancing: config.loadBalancing,
    providers: config.providers,
  };
}

export async function handleOnboardCommand(context: CliContext): Promise<void> {
  p.intro(color.bgCyan(color.black(' CPG Onboard Wizard ')));

  // 1. Load config
  let config: NormalizedConfig;
  try {
    config = await loadConfig(context.configPath);
  } catch (error) {
    // If fails to load, use empty
    config = createEmptyConfig();
  }

  // 2. Main Menu Loop
  let exit = false;
  while (!exit) {
    const action = await p.select({
      message: 'Main Menu',
      options: [
        { value: 'plans', label: 'Manage Plans' },
        { value: 'lb', label: 'Configure Load Balancing' },
        { value: 'save', label: 'Save & Exit' },
        { value: 'cancel', label: 'Cancel (Discard changes)' },
      ],
    });

    if (p.isCancel(action)) {
      p.cancel('Operation cancelled.');
      return;
    }

    switch (action) {
      case 'plans':
        await managePlans(config);
        break;
      case 'lb':
        await manageLoadBalancing(config);
        break;
      case 'save':
        try {
          configSchema.parse(config);

          // Backup original config before saving
          try {
            await access(context.configPath); // Check if original file exists
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const fileName = basename(context.configPath);
            let backupDir = dirname(context.configPath);

            // Prefer /app/data for backups in production Docker container
            if (process.env.NODE_ENV === 'production') {
              try {
                await access('/app/data');
                backupDir = '/app/data';
              } catch {
                // Ignore if /app/data doesn't exist, use dirname(configPath)
              }
            }

            const backupPath = join(backupDir, `${fileName}.${timestamp}.bak`);
            await copyFile(context.configPath, backupPath);
            p.log.info(`Original configuration backed up to ${backupPath}`);
          } catch (e) {
            // Ignore if original config doesn't exist or backup fails
          }

          // Clean config before saving (remove preset-duplicated fields)
          const cleanedConfig = cleanConfigForOnboard(config);
          await saveConfig(context.configPath, cleanedConfig, 'yaml');
          p.log.success(`Configuration saved to ${context.configPath}`);

          // Notify running gateway to reload config
          try {
            const notifier = createGatewayNotifier({ gatewayUrl: context.gatewayUrl });
            if (await notifier.isGatewayRunning()) {
              const reloaded = await notifier.notifyConfigChanged();
              if (reloaded) {
                p.log.success('Gateway reloaded configuration successfully.');
              } else {
                p.log.warn('Gateway received reload request but reported failure.');
              }
            } else {
              p.log.warn('Gateway is not running — restart it to apply the new configuration.');
            }
          } catch {
            p.log.warn('Could not notify gateway — restart it to apply the new configuration.');
          }

          exit = true;
        } catch (error) {
          p.log.error(`Validation failed. Please fix the configuration before saving:\n${error}`);
        }
        break;
      case 'cancel':
        p.cancel('Changes discarded.');
        return;
    }
  }

  p.outro('Onboarding complete!');
}

async function managePlans(config: NormalizedConfig) {
  let back = false;
  while (!back) {
    const options = config.plans.map(plan => ({
      value: `edit:${plan.id}`,
      label: `Edit Plan: ${plan.name} (ID: ${plan.id})`
    }));
    
    options.push({ value: 'add', label: color.green('+ Add New Plan') });
    options.push({ value: 'back', label: '← Back to Main Menu' });

    const action = await p.select({
      message: 'Manage Plans',
      options,
    });

    if (p.isCancel(action)) return;

    if (action === 'back') {
      back = true;
    } else if (action === 'add') {
      const maxId = config.plans.reduce((max, plan) => {
        const id = typeof plan.id === 'number' ? plan.id : 0;
        return id > max ? id : max;
      }, 0);
      const newPlan = await promptPlanDetails(maxId + 1);
      if (newPlan) {
        config.plans.push(normalizePlanConfig(newPlan, buildCustomProvidersMap(config.providers)));
        p.log.success(`Plan ${newPlan.name} added.`);
      }
    } else if (typeof action === 'string' && action.startsWith('edit:')) {
      const parts = action.split(':');
      if (!parts[1]) continue;
      const planId = parseInt(parts[1], 10);
      const planIndex = config.plans.findIndex(p => p.id === planId);
      if (planIndex >= 0) {
        const plan = config.plans[planIndex];
        if (!plan) continue;
        const editAction = await p.select({
          message: `Edit Plan: ${plan.name}`,
          options: [
            { value: 'update', label: 'Update details' },
            { value: 'delete', label: color.red('Delete plan') },
            { value: 'back', label: 'Cancel' }
          ]
        });
        
        if (p.isCancel(editAction)) continue;
        
        if (editAction === 'delete') {
          const confirm = await p.confirm({
            message: `Are you sure you want to delete ${plan.name}?`
          });
          if (confirm && !p.isCancel(confirm)) {
            config.plans.splice(planIndex, 1);
            p.log.success('Plan deleted.');
          }
        } else if (editAction === 'update') {
          const updatedPlan = await promptPlanDetails(planId, plan);
          if (updatedPlan) {
            config.plans[planIndex] = normalizePlanConfig(updatedPlan, buildCustomProvidersMap(config.providers));
            p.log.success('Plan updated.');
          }
        }
      }
    }
  }
}

async function promptPlanDetails(id: number, existing?: NormalizedPlanConfig): Promise<PlanConfig | null> {
  // Phase 1: Provider preset selection
  const providerOptions = [
    { value: '', label: 'Custom (manual configuration)' },
    ...BUILTIN_PROVIDERS.map((preset) => ({
      value: preset.id,
      label: `${preset.name}  ${color.dim(preset.baseUrl)}`,
    })),
  ];

  const selectedProviderId = await p.select({
    message: 'Select Provider Preset',
    options: providerOptions,
    initialValue: existing?.provider ?? '',
  });

  if (p.isCancel(selectedProviderId)) return null;

  const selectedPreset = selectedProviderId ? getBuiltinProvider(selectedProviderId) : undefined;

  if (selectedPreset) {
    p.log.info(`Preset applied: ${selectedPreset.name} — skipping preset-provided fields.`);
  }

  // Phase 2: Build prompts dynamically — skip preset-provided fields
  const groupDef: Record<string, () => Promise<unknown>> = {
    name: () => p.text({
      message: 'Plan Name',
      initialValue: existing?.name || selectedPreset?.name || '',
      validate: value => (!value || value.length === 0) ? 'Name is required' : undefined
    }),
    apiKey: () => p.text({
      message: 'API Key',
      initialValue: existing?.apiKey || '',
      validate: value => (!value || value.length === 0) ? 'API Key is required' : undefined
    }),
    expiresAt: () => p.text({
      message: 'Expiration Date (ISO format e.g., 2026-12-31T23:59:59Z, optional)',
      initialValue: existing?.expiresAt || existing?.quota?.expiresAt || '',
      validate: value => {
        if (!value) return undefined;
        if (isNaN(new Date(value).getTime())) return 'Must be a valid ISO date';
        return undefined;
      }
    }),
    weight: () => p.text({
      message: 'Load Balancing Weight (1-100, optional)',
      initialValue: existing?.weight?.toString() || '',
      validate: value => value && (isNaN(parseInt(value)) || parseInt(value) < 1 || parseInt(value) > 100) ? 'Must be between 1 and 100' : undefined
    }),
    timeout: () => p.text({
      message: 'Request Timeout in seconds (default: 300)',
      initialValue: existing?.timeout?.toString() || '',
      validate: value => value && (isNaN(parseInt(value)) || parseInt(value) < 1) ? 'Must be a positive number' : undefined
    }),
    enable: () => p.confirm({
      message: 'Enable this plan?',
      initialValue: existing?.enable !== false
    }),
  };

  // Only prompt for preset-duplicated fields when no preset selected
  if (!selectedPreset) {
    groupDef.baseUrl = () => p.text({
      message: 'Anthropic Base URL (for /v1/messages)',
      initialValue: existing?.baseUrl || '',
    });
    groupDef.openaiBaseUrl = () => p.text({
      message: 'OpenAI Base URL (for /v1/chat/completions)',
      initialValue: existing?.openaiBaseUrl || '',
    });
    groupDef.models = () => p.text({
      message: 'Models (comma-separated)',
      initialValue: existing?.models.join(',') || '',
      validate: value => (!value || value.length === 0) ? 'At least one model is required' : undefined
    });
    groupDef.modelAliases = () => p.text({
      message: 'Model Aliases (comma-separated alias:canonical, optional)',
      initialValue: existing?.modelAliases
        ? Object.entries(existing.modelAliases).map(([k, v]) => `${k}:${v}`).join(',')
        : '',
      validate: value => {
        if (!value) return undefined;
        const pairs = value.split(',');
        for (const pair of pairs) {
          const colonIndex = pair.indexOf(':');
          if (colonIndex <= 0 || colonIndex === pair.length - 1) {
            return 'Invalid format. Use alias:canonical (neither can be empty)';
          }
        }
        return undefined;
      }
    });
  }

  // Quota fields: skip entirely for usage-API providers; always prompt for custom/non-usage presets
  const needsQuota = !selectedPreset || !selectedPreset.hasUsageApi;
  if (needsQuota) {
    groupDef.expiresOn = () => p.text({
      message: 'Expiration Day (1-31, optional, for monthly reset)',
      initialValue: existing?.expiresOn?.toString() || existing?.quota?.expiresOn?.toString() || '',
      validate: value => value && (isNaN(parseInt(value)) || parseInt(value) < 1 || parseInt(value) > 31) ? 'Must be between 1 and 31' : undefined
    });
    groupDef.quotaLimit = () => p.text({
      message: 'Quota Limit',
      initialValue: existing?.quota.limit.toString() || '100000',
      validate: value => (!value || isNaN(parseInt(value))) ? 'Must be a number' : undefined
    });
    groupDef.quotaPeriod = () => p.select({
      message: 'Quota Period',
      options: [
        { value: 'daily', label: 'Daily' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'total', label: 'Total' },
      ],
      initialValue: existing?.quota.period || 'monthly',
    });
  }

  const group = await p.group(groupDef, {
    onCancel: () => {
      p.cancel('Operation cancelled.');
      return false;
    }
  });

  if (!group || Object.keys(group).length === 0) return null;

  if (!selectedPreset && !(group.baseUrl as string)?.trim() && !(group.openaiBaseUrl as string)?.trim()) {
    p.log.error('At least one of Anthropic Base URL or OpenAI Base URL is required.');
    return null;
  }

  const legacyPeriod = group.quotaPeriod as string;
  const plan: PlanConfig = {
    id,
    name: group.name as string,
    provider: selectedProviderId || undefined,
    apiKey: group.apiKey as string,
    status: existing?.status || 'active',
    enable: group.enable as boolean,
  };

  // Only include preset-duplicated fields if they were prompted (no preset selected)
  if (!selectedPreset) {
    if ((group.baseUrl as string)?.trim()) {
      plan.baseUrl = (group.baseUrl as string).trim();
    }
    if ((group.openaiBaseUrl as string)?.trim()) {
      plan.openaiBaseUrl = (group.openaiBaseUrl as string).trim();
    }
    plan.models = (group.models as string).split(',').map(m => m.trim()).filter(Boolean);
    plan.modelAliases = parseModelAliases(group.modelAliases as string);
  }

  // Quota: include only if prompted (non-usage-API preset or custom)
  if (needsQuota && group.quotaLimit) {
    plan.quota = {
      limit: parseInt(group.quotaLimit as string),
      period: legacyPeriod === 'monthly'
        ? { type: 'monthly', expiresOn: group.expiresOn ? parseInt(group.expiresOn as string, 10) : undefined }
        : legacyPeriod === 'daily'
          ? { type: '5h', windowHours: 5, sliding: true as const }
          : { type: 'total' },
    };
  }

  if (group.expiresOn) {
    plan.expiresOn = parseInt(group.expiresOn as string, 10);
  }
  if (group.expiresAt) {
    plan.expiresAt = group.expiresAt as string;
  }
  if (group.weight) {
    plan.weight = parseInt(group.weight as string, 10);
  }
  if (group.timeout) {
    plan.timeout = parseInt(group.timeout as string, 10);
  }
  if (group.modelAliases) {
    plan.modelAliases = parseModelAliases(group.modelAliases as string);
  }

  return plan;
}

/** Parse "alias:canonical" comma-separated string into a Record. */
function parseModelAliases(value: string): Record<string, string> | undefined {
  if (!value) return undefined;
  const aliasesRecord: Record<string, string> = {};
  const pairs = value.split(',');
  for (const pair of pairs) {
    const colonIndex = pair.indexOf(':');
    if (colonIndex > 0) {
      const alias = pair.substring(0, colonIndex).trim();
      const canonical = pair.substring(colonIndex + 1).trim();
      if (alias && canonical) {
        aliasesRecord[alias] = canonical;
      }
    }
  }
  return Object.keys(aliasesRecord).length > 0 ? aliasesRecord : undefined;
}

async function manageLoadBalancing(config: Config) {
  config.loadBalancing = config.loadBalancing || {
    strategy: 'quota-priority',
    factorWeights: { expiration: 0.4, rpm: 0.4, quota: 0.2 }
  };

  const strategy = await p.select({
    message: 'Select Load Balancing Strategy',
    options: [
      { value: 'quota-priority', label: 'Quota Priority' },
      { value: 'round-robin', label: 'Round Robin' },
      { value: 'weighted-round-robin', label: 'Weighted Round Robin' },
      { value: 'random', label: 'Random' }
    ],
    initialValue: config.loadBalancing.strategy
  });

  if (p.isCancel(strategy)) return;
  config.loadBalancing.strategy = strategy as 'quota-priority' | 'round-robin' | 'weighted-round-robin' | 'random';

  if (strategy === 'quota-priority') {
    p.note('Configure factor weights (must sum to 1.0)');
    const weightsGroup = await p.group({
      expiration: () => p.text({
        message: 'Expiration Weight (0.0 - 1.0)',
        initialValue: config.loadBalancing!.factorWeights?.expiration?.toString() || '0.4'
      }),
      rpm: () => p.text({
        message: 'RPM Weight (0.0 - 1.0)',
        initialValue: config.loadBalancing!.factorWeights?.rpm?.toString() || '0.4'
      }),
      quota: () => p.text({
        message: 'Quota Weight (0.0 - 1.0)',
        initialValue: config.loadBalancing!.factorWeights?.quota?.toString() || '0.2'
      })
    }, {
      onCancel: () => { p.cancel('Operation cancelled.'); return false; }
    });

    if (weightsGroup) {
      config.loadBalancing.factorWeights = {
        expiration: parseFloat(weightsGroup.expiration as string),
        rpm: parseFloat(weightsGroup.rpm as string),
        quota: parseFloat(weightsGroup.quota as string)
      };
      p.log.success('Load balancing configuration updated.');
    }
  } else {
    p.log.success('Load balancing strategy updated.');
  }
}
