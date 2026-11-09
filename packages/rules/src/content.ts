/**
 * Content checks on text an agent wrote into a persistent file. These decide
 * whether a change is merely notable or can run code or steer a later session.
 */
import { baseName } from '@stillwatch/schema';

const RISKY_GIT_CONFIG_CONTENT =
  /\[\s*(?:filter|alias|credential|pager|include|includeif)\b|\b(?:fsmonitor|sshcommand|hookspath|pager|helper|textconv)\s*=|\bfilter\s*=/i;

/** Git config keys that make ordinary git commands run programs. */
export const RISKY_GIT_CONFIG_KEY =
  /^(?:filter\.|alias\.|credential\.|pager\.|include\.|includeif\.|core\.(?:fsmonitor|sshcommand|pager|hookspath|editor|askpass)|diff\..*\.textconv)/i;

/** Names what risky feature git config content sets, or null. */
export function gitConfigRisk(content: string): string | null {
  const match = RISKY_GIT_CONFIG_CONTENT.exec(content);
  return match ? match[0].replace(/[[\]=\s]/g, '').toLowerCase() : null;
}

const INSTALL_SCRIPT =
  /"(preinstall|install|postinstall|preprepare|prepare|postprepare|prepublish|prepublishOnly)"\s*:/;
const FOLDER_OPEN = /"runOn"\s*:\s*"folderOpen"/;
const DEVCONTAINER_COMMAND =
  /"(initializeCommand|onCreateCommand|updateContentCommand|postCreateCommand|postStartCommand|postAttachCommand)"\s*:/;

/**
 * Why a task-runner change runs code without anyone asking, or null.
 * `.envrc` always qualifies: direnv runs it on entering the directory.
 */
export function autoRunReason(path: string, content: string | null): string | null {
  const name = baseName(path);
  if (name === '.envrc') return 'direnv runs .envrc whenever a shell enters the directory';
  if (content === null) return null;
  if (name === 'package.json') {
    const m = INSTALL_SCRIPT.exec(content);
    if (m) return `the "${m[1] ?? ''}" script runs automatically on package install`;
  }
  if (name === 'tasks.json' && FOLDER_OPEN.test(content)) {
    return 'the task runs automatically when the folder is opened in the editor';
  }
  if (name === 'devcontainer.json' || name === '.devcontainer.json') {
    const m = DEVCONTAINER_COMMAND.exec(content);
    if (m) return `"${m[1] ?? ''}" runs automatically when the dev container is created or started`;
  }
  return null;
}

const SHELL_IN_NOTE =
  /```(?:sh|bash|zsh|shell|console)\b|^\s*\$ \S|\b(?:curl|wget|bash -c|sh -c|chmod|sudo|eval|npx|nc|base64 -d)\s/m;
const URL_IN_NOTE = /\b(?:https?|ftp):\/\/[^\s)>\]]+/i;

/** Content-only concerns about a memory note: shell commands or URLs aimed at a later session. */
export function noteContentConcerns(content: string): string[] {
  const out: string[] = [];
  if (SHELL_IN_NOTE.test(content)) out.push('shell commands');
  if (URL_IN_NOTE.test(content)) out.push('URLs');
  return out;
}
