/** The rule registry: exactly one implementation per rule id. */
import type { RuleId } from '@stillwatch/schema';
import type { RuleFn } from '../findings';
import { agentConfigChanged, monitorTampering } from './agent';
import {
  backgroundLeftRunning,
  interruptedWithChanges,
  packageNew,
  safetyBypass,
} from './behavior';
import { unattributedChange } from './evidence';
import { promptInjection } from './injection';
import { noteLoaded, noteWritten } from './memory';
import { newDomain } from './network';
import { ci, gitConfig, gitHook, scheduledTask, startupFile, taskRunner } from './persistence';
import { secretExfiltration, secretRead } from './secrets';

export const RULE_FUNCTIONS: Readonly<Record<RuleId, RuleFn>> = {
  'secret.read': secretRead,
  'secret.exfiltration': secretExfiltration,
  'persistence.git_hook': gitHook,
  'persistence.git_config': gitConfig,
  'persistence.ci': ci,
  'persistence.task_runner': taskRunner,
  'persistence.scheduled_task': scheduledTask,
  'persistence.startup_file': startupFile,
  'agent.config_changed': agentConfigChanged,
  'memory.note_written': noteWritten,
  'memory.note_loaded': noteLoaded,
  'session.interrupted_with_changes': interruptedWithChanges,
  'safety.bypass': safetyBypass,
  'package.new': packageNew,
  'prompt_injection.possible': promptInjection,
  'evidence.unattributed_change': unattributedChange,
  'network.new_domain': newDomain,
  'monitor.tampering': monitorTampering,
  'background.left_running': backgroundLeftRunning,
};
