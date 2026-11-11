/** Metadata for every rule, one entry per RULE_IDS value. */
import type { RuleDefinition } from '@stillwatch/schema';

export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  {
    id: 'secret.read',
    title: 'Secret read',
    description:
      'The agent read a credential file or ran a command that prints credentials. Secrets in the agent context can leak through later tool calls.',
    defaultSeverity: 'medium',
    category: 'secrets',
  },
  {
    id: 'secret.exfiltration',
    title: 'Secret may have left the computer',
    description:
      'A secret appeared in a network-capable tool call, or a secret read was followed by contact with a new domain.',
    defaultSeverity: 'high',
    category: 'secrets',
  },
  {
    id: 'persistence.git_hook',
    title: 'Git hook changed',
    description:
      'A git hook was added or changed, or the hooks path was redirected. Git runs hooks automatically, so they keep running code after the session.',
    defaultSeverity: 'high',
    category: 'persistence',
  },
  {
    id: 'persistence.git_config',
    title: 'Git configuration changed',
    description:
      'Git configuration changed. Filters, aliases, fsmonitor, sshCommand, pagers, credential helpers, and hooksPath make ordinary git commands run programs.',
    defaultSeverity: 'high',
    category: 'persistence',
  },
  {
    id: 'persistence.ci',
    title: 'CI pipeline changed',
    description:
      'A CI pipeline definition changed. Pipelines run with repository secrets and deploy permissions.',
    defaultSeverity: 'high',
    category: 'persistence',
  },
  {
    id: 'persistence.task_runner',
    title: 'Task runner changed',
    description:
      'Package scripts, Makefiles, editor tasks, dev containers, or .envrc changed. Some run automatically on install or when a folder opens.',
    defaultSeverity: 'medium',
    category: 'persistence',
  },
  {
    id: 'persistence.scheduled_task',
    title: 'Scheduled task created',
    description:
      'A cron job, launchd agent, systemd unit, or similar was created or changed. It runs later without anyone starting it.',
    defaultSeverity: 'high',
    category: 'persistence',
  },
  {
    id: 'persistence.startup_file',
    title: 'Startup file changed',
    description:
      'A shell profile, SSH file, or interpreter startup file changed. These run on every new shell or grant access to the computer.',
    defaultSeverity: 'high',
    category: 'persistence',
  },
  {
    id: 'agent.config_changed',
    title: 'Agent configuration changed',
    description:
      'Claude Code settings, hooks, MCP servers, agents, commands, or skills changed. They shape what every later session can do.',
    defaultSeverity: 'high',
    category: 'persistence',
  },
  {
    id: 'memory.note_written',
    title: 'Memory note written',
    description:
      'The agent wrote a file that later sessions load as instructions or memory, such as CLAUDE.md.',
    defaultSeverity: 'low',
    category: 'memory',
  },
  {
    id: 'memory.note_loaded',
    title: 'Note from another session loaded',
    description:
      'This session loaded or read a memory note that an earlier session wrote, so that session can influence this one.',
    defaultSeverity: 'low',
    category: 'memory',
  },
  {
    id: 'session.interrupted_with_changes',
    title: 'Session interrupted with changes',
    description:
      'The session stopped mid-turn after changing files, so the changes may be half done.',
    defaultSeverity: 'medium',
    category: 'behavior',
  },
  {
    id: 'safety.bypass',
    title: 'Safety check bypassed',
    description:
      'The agent skipped a safety check: disabled the sandbox, verification, or hooks, piped network content into a shell, or used elevated privileges.',
    defaultSeverity: 'high',
    category: 'behavior',
  },
  {
    id: 'safety.destructive',
    title: 'Destructive command run',
    description:
      'The agent ran a command that destroys work or evidence: a force push, git reset --hard, a broad delete, wiping a disk, or clearing shell history.',
    defaultSeverity: 'medium',
    category: 'behavior',
  },
  {
    id: 'package.new',
    title: 'New package added',
    description:
      'The agent added a package or ran one with npx. New packages can run install scripts and stay in the project.',
    defaultSeverity: 'medium',
    category: 'behavior',
  },
  {
    id: 'prompt_injection.possible',
    title: 'Possible prompt injection',
    description:
      'Content the agent read contains instruction-like or hidden text aimed at an agent. It becomes high when a high-severity finding follows it.',
    defaultSeverity: 'medium',
    category: 'behavior',
  },
  {
    id: 'evidence.unattributed_change',
    title: 'Change with no recorded action',
    description:
      'Snapshots show a change that no tool call or command in the session explains. Another program may have made it, or an event was missed.',
    defaultSeverity: 'low',
    category: 'evidence',
  },
  {
    id: 'network.new_domain',
    title: 'New domain contacted',
    description:
      'The session contacted a domain not seen in earlier sessions, other than well-known registries and code hosts.',
    defaultSeverity: 'low',
    category: 'network',
  },
  {
    id: 'monitor.tampering',
    title: 'Stillwatch files touched',
    description:
      'The agent changed Stillwatch files, hooks, or processes. That can hide what a session did.',
    defaultSeverity: 'high',
    category: 'evidence',
  },
  {
    id: 'background.left_running',
    title: 'Background task left running',
    description:
      'A background task was still running when the agent last stopped, so it may keep acting after the session.',
    defaultSeverity: 'low',
    category: 'behavior',
  },
];
