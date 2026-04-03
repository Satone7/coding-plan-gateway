import * as p from '@clack/prompts';
import color from 'picocolors';
import { copyFile, access } from 'fs/promises';
import { dirname, join, basename } from 'path';
import { loadConfig, saveConfig, createEmptyConfig } from '@/config';
import { configSchema } from '@/config/schema';
import type { CliContext } from '@/types/cli';
import type { Config, PlanConfig } from '@/config/schema';

export async function handleOnboardCommand(context: CliContext): Promise<void> {
  p.intro(color.bgCyan(color.black(' CPG Onboard Wizard ')));

  // 1. Load config
  let config: Config;
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

          await saveConfig(context.configPath, config, 'yaml');
          p.log.success(`Configuration saved to ${context.configPath}`);
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

async function managePlans(config: Config) {
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
        config.plans.push(newPlan);
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
            config.plans[planIndex] = updatedPlan;
            p.log.success('Plan updated.');
          }
        }
      }
    }
  }
}

async function promptPlanDetails(id: number, existing?: PlanConfig): Promise<PlanConfig | null> {
  const group = await p.group({
    name: () => p.text({
      message: 'Plan Name',
      initialValue: existing?.name || '',
      validate: value => (!value || value.length === 0) ? 'Name is required' : undefined
    }),
    baseUrl: () => p.text({
      message: 'Base URL',
      initialValue: existing?.baseUrl || '',
      validate: value => (!value || value.length === 0) ? 'Base URL is required' : undefined
    }),
    apiKey: () => p.text({
      message: 'API Key',
      initialValue: existing?.apiKey || '',
      validate: value => (!value || value.length === 0) ? 'API Key is required' : undefined
    }),
    models: () => p.text({
      message: 'Models (comma-separated)',
      initialValue: existing?.models.join(',') || '',
      validate: value => (!value || value.length === 0) ? 'At least one model is required' : undefined
    }),
    modelAliases: () => p.text({
      message: 'Model Aliases (comma-separated alias:canonical, optional)',
      initialValue: existing?.modelAliases ? Object.entries(existing.modelAliases).map(([k, v]) => `${k}:${v}`).join(',') : '',
      validate: value => {
        if (!value) return undefined;
        const pairs = value.split(',');
        for (const pair of pairs) {
          if (!pair.includes(':')) {
            return 'Invalid format. Use alias:canonical';
          }
        }
        return undefined;
      }
    }),
    quotaLimit: () => p.text({
      message: 'Quota Limit',
      initialValue: existing?.quota.limit.toString() || '100000',
      validate: value => (!value || isNaN(parseInt(value))) ? 'Must be a number' : undefined
    }),
    quotaPeriod: () => p.select({
      message: 'Quota Period',
      options: [
        { value: 'daily', label: 'Daily' },
        { value: 'monthly', label: 'Monthly' },
        { value: 'total', label: 'Total' }
      ],
      initialValue: existing?.quota.period || 'monthly'
    }),
    expiresOn: () => p.text({
      message: 'Expiration Day (1-31, optional, for monthly reset)',
      initialValue: existing?.expiresOn?.toString() || existing?.quota?.expiresOn?.toString() || '',
      validate: value => value && (isNaN(parseInt(value)) || parseInt(value) < 1 || parseInt(value) > 31) ? 'Must be between 1 and 31' : undefined
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
      initialValue: existing?.enable !== false // default to true if not explicitly set to false
    })
  }, {
    onCancel: () => {
      p.cancel('Operation cancelled.');
      return false;
    }
  });

  if (!group || Object.keys(group).length === 0) return null;

  const plan: PlanConfig = {
    id,
    name: group.name as string,
    baseUrl: group.baseUrl as string,
    apiKey: group.apiKey as string,
    models: (group.models as string).split(',').map(m => m.trim()).filter(Boolean),
    quota: {
      limit: parseInt(group.quotaLimit as string),
      period: group.quotaPeriod as 'daily' | 'monthly' | 'total'
    },
    status: existing?.status || 'active',
    enable: group.enable as boolean
  };

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
    const aliasesValue = group.modelAliases as string;
    const aliasesRecord: Record<string, string> = {};
    const pairs = aliasesValue.split(',');
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
    if (Object.keys(aliasesRecord).length > 0) {
      plan.modelAliases = aliasesRecord;
    }
  }

  return plan;
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
