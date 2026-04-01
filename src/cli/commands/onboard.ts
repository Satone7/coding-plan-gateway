import * as p from '@clack/prompts';
import color from 'picocolors';
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
        { value: 'aliases', label: 'Configure Model Aliases' },
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
      case 'aliases':
        await manageAliases(config);
        break;
      case 'save':
        try {
          configSchema.parse(config);
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
    })
  }, {
    onCancel: () => {
      p.cancel('Operation cancelled.');
      return false;
    }
  });

  if (!group || Object.keys(group).length === 0) return null;

  return {
    id,
    name: group.name as string,
    baseUrl: group.baseUrl as string,
    apiKey: group.apiKey as string,
    models: (group.models as string).split(',').map(m => m.trim()).filter(Boolean),
    quota: {
      limit: parseInt(group.quotaLimit as string),
      period: group.quotaPeriod as 'daily' | 'monthly' | 'total'
    },
    status: existing?.status || 'active'
  };
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

async function manageAliases(config: Config) {
  config.modelAliases = config.modelAliases || {};
  let back = false;
  
  while (!back) {
    const modelAliases = config.modelAliases || {};
    const aliasKeys = Object.keys(modelAliases);
    const options = aliasKeys.map(alias => ({
      value: `edit:${alias}`,
      label: `${alias} → ${modelAliases[alias]}`
    }));
    
    options.push({ value: 'add', label: color.green('+ Add New Alias') });
    options.push({ value: 'back', label: '← Back to Main Menu' });

    const action = await p.select({
      message: 'Manage Model Aliases',
      options,
    });

    if (p.isCancel(action)) return;

    if (action === 'back') {
      back = true;
    } else if (action === 'add') {
      const group = await p.group({
        alias: () => p.text({
          message: 'Alias Name (e.g. gpt-4)',
          validate: v => (!v || v.length === 0) ? 'Alias name is required' : undefined
        }),
        canonical: () => p.text({
          message: 'Canonical Model Name (e.g. gpt-4-turbo)',
          validate: v => (!v || v.length === 0) ? 'Canonical name is required' : undefined
        })
      });

      if (group) {
        config.modelAliases = config.modelAliases || {};
        config.modelAliases[group.alias as string] = group.canonical as string;
        p.log.success(`Added alias: ${group.alias as string} → ${group.canonical as string}`);
      }
    } else if (typeof action === 'string' && action.startsWith('edit:')) {
      const parts = action.split(':');
      if (!parts[1]) continue;
      const alias = parts[1];
      const editAction = await p.select({
        message: `Edit Alias: ${alias}`,
        options: [
          { value: 'update', label: 'Update target model' },
          { value: 'delete', label: color.red('Delete alias') },
          { value: 'back', label: 'Cancel' }
        ]
      });

      if (p.isCancel(editAction)) continue;

      if (editAction === 'delete') {
        if (config.modelAliases) {
          delete config.modelAliases[alias];
          p.log.success('Alias deleted.');
        }
      } else if (editAction === 'update') {
        const canonical = await p.text({
          message: `New canonical model for ${alias}`,
          initialValue: config.modelAliases ? config.modelAliases[alias] : ''
        });
        if (!p.isCancel(canonical) && canonical) {
          config.modelAliases = config.modelAliases || {};
          config.modelAliases[alias] = canonical as string;
          p.log.success('Alias updated.');
        }
      }
    }
  }
}
