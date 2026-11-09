# Secure Agent Runtime: Project Brief

> **Note:** This is a separate project idea, considered alongside Stillwatch, and it is not part of the Stillwatch build.
> It relates to Stillwatch's later stages: optional blocking and lower-level monitoring.

Nov 2, 2026

## Summary

Build a secure runtime for AI agents on Linux, not a new operating system.
It runs each task in an isolated environment, with authority that expires when the task ends or the agent dies.

The core rule is simple: a dead agent can leave information behind, but never authority.
A new agent can read approved traces, but it needs a fresh grant to act.

The bottom line: a working demo is realistic for one strong engineer.
A sellable product is much harder, because well-funded companies already cover much of this space.
Treat the first phase as a serious learning project with a clear test for whether it should become a company.

## Goal

The goal is to stop agent work from continuing without valid authorization.
The first target user is a developer or small team running coding agents unattended.

The first version must prove four things:

- Each task runs in its own isolated environment.
- Permissions are narrow, temporary, and tied to one task.
- A dead agent's access ends automatically.
- A successor can use leftover work, but can't finish a sensitive step without a new grant.

These are out of scope for now: a custom kernel, a custom Linux distribution, a new AI model, a new agent framework, consumer desktop software, and agents that control native Mac apps.

## The commitment

Expect 6 to 9 months part-time to reach a credible demo, and years of focused work if this becomes a company.
These are planning estimates, not sourced figures, and they assume one experienced engineer using AI coding tools.

| Stage | Time | Likely cash cost | What you are signing up for |
| --- | --- | --- | --- |
| Learning and setup | 1 to 2 months part-time | $0 to $100 a month | Linux, virtualization, networking, and security basics |
| Working demo | 3 to 6 months part-time | $50 to $300 a month | Building, testing, and breaking the core runtime |
| Early adopters | 6 to 12 more months | $200 to $2,000 a month | User interviews, support, documentation, and security fixes |
| Company | Multi-year, full-time | Depends on funding | Hiring, sales, audits, on-call duty, and security response |

The hardest part may not be the code.
A security product makes a promise, so every serious bug becomes your responsibility.
Customers will also expect a security audit and a plan for handling vulnerabilities.

Assume you will need a co-founder or specialist if this becomes a company.
One person can build the demo, but enterprise security sales usually require trust, audits, and support capacity.

## Prerequisites

You need solid programming skills and a Linux machine with hardware virtualization.
You can learn the systems and security topics during the project, but not from zero programming experience.

**Skills**

- Comfort with the Linux command line, processes, permissions, and file systems
- Basic networking: DNS, HTTP, proxies, firewalls, and virtual network interfaces
- One systems language, ideally Rust or Go
- Git, automated testing, and debugging
- Basic threat modeling, meaning a habit of asking how each part could be abused

**Setup**

- A Linux host with `/dev/kvm` access, which [Firecracker requires](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
- VS Code connected to that machine over Remote SSH
- A private Git repository
- API access for one existing coding agent
- A separate test account with no real secrets

Cloud hosting needs care.
Firecracker's guide says AWS EC2 only supports KVM on `.metal` instances, which can be expensive.
A dedicated server or spare Linux PC may be cheaper for development.

On a Mac, Firecracker won't run directly.
Develop on a remote Linux machine first, then consider a Mac version after the core design works.

## Stack and glossary

Use proven open-source parts for isolation and monitoring, and spend your effort on the supervisor.
It is the only part of the stack that is really yours.

| Term | What it means | Purpose here | Build or reuse |
| --- | --- | --- | --- |
| Linux | The host operating system | Runs everything and provides security features | Reuse |
| KVM | Hardware virtualization built into Linux | Lets the machine run isolated virtual machines | Reuse |
| Firecracker | A lightweight virtual machine monitor | Runs each agent in its own microVM | Reuse |
| MicroVM | A small virtual machine with its own kernel | Keeps a compromised agent away from the host | Reuse |
| Jailer | Firecracker's process sandbox | Hardens the Firecracker process in production | Reuse |
| Landlock | A Linux feature that limits file access | Adds a second layer of file restrictions | Reuse |
| seccomp | A Linux filter for system calls | Blocks kernel operations an agent doesn't need | Reuse |
| eBPF | Safe programs that run inside the Linux kernel | Observes low-level system activity | Reuse |
| Tetragon | An eBPF-based security tool | Detects and can block risky behavior | Reuse |
| Network proxy | A gateway for outbound traffic | Enforces allowed destinations and limits data theft | Reuse and configure |
| Credential broker | A service that holds real secrets | Issues short-lived access or makes calls for the agent | Build |
| Grant | A permission tied to a task | Defines what an agent may do | Build |
| Lease | A grant that needs regular renewal | Ends access when an agent stops responding | Build |
| Supervisor | The small trusted control service | Checks grants, leases, handoffs, and policy | Build |
| Snapshot | A saved copy of a file system state | Makes changes reviewable and reversible | Reuse and integrate |
| Trace | Anything an agent leaves behind | Gives successors context, but never authority | Build the rules |
| Taint tracking | Marking untrusted data as it moves | Flags actions influenced by risky inputs | Build later |
| Audit log | A tamper-resistant activity record | Explains what happened and why it was allowed | Build |
| Review agent | A restricted AI reviewer | Examines flagged events and can only freeze or deny | Build later |

I recommend Rust for the supervisor if you already know it, or Go if you want to move faster.
Avoid large frameworks in the trusted layer, because every dependency adds risk.

## High-level execution

Build the core on Linux first, prove the dead-agent demo, then test whether anyone wants it.
Each phase ends with a gate, so you can stop or change direction before committing more time.

| Phase | Timing | Work | Gate |
| --- | --- | --- | --- |
| 1: Foundation | Months 1 to 2 | Set up the Linux host and learn the core tools, then build a command that runs one agent in one disposable microVM | A task runs and leaves nothing behind on the host |
| 2: Authority | Months 3 to 4 | Build the supervisor, grants, and leases, then add the credential broker and network proxy | A killed agent loses access when its lease expires |
| 3: Proof | Months 5 to 6 | Build the kill-and-respawn demo and a written threat model, then attack your own system with poisoned notes and hooks | A successor cannot finish the sensitive step without a grant |
| 4: Validation | Months 7 to 9 | Interview teams running agents, publish the core as open source, and support early users on real workflows | Five teams use it on real work, and one would miss it if it went |
| 5: Product | Month 10 onward | Add monitoring, the review agent, a dashboard, and an external audit, and consider a Mac app only after the Linux core proves useful | Continue, pivot, or stop, based on real usage and demand |

Phase 3 is the key milestone, because it proves the idea that makes this project different.
If a gate fails, fix the issue or stop before moving on.

## Competitive landscape

The market is crowded and moving quickly, so a general agent sandbox isn't a good wedge.
The opening is narrower: authority over time, across agents, handoffs, and leftover work.

| Layer | Who is there | What they cover | Implication |
| --- | --- | --- | --- |
| Agent sandbox platforms | [E2B, Daytona, Modal, and many others](https://blog.logrocket.com/comparing-ai-agent-sandbox-platforms-e2b-modal-daytona-and-more/) | Isolated environments for agent-run code | Reuse the idea, and don't compete on speed or price |
| Local microVM sandboxes | [Docker Sandboxes](https://aident.ai/blog/run-claude-code-codex-docker-sandbox) | MicroVMs, a host-side proxy, and host-held credentials | Very close to the isolation layer you planned |
| Built-in agent sandboxes | [Claude Code](https://code.claude.com/docs/en/sandboxing) | Operating-system limits on shell commands | Shows vendors will build more of this themselves |
| Agent identity | [Cyera with Oasis, and Okta with Permiso](https://www.startuphub.ai/ai-news/ai-news/2026/agentic-ai-governance-five-deals-week-july-2026) | Agent credentials, permissions, and governance | Large buyers are paying for this layer |
| Runtime platforms | [Nvidia and Microsoft, among others](https://wetheflywheel.com/en/guides/ai-agent-security-vendors-2026/) | Monitoring and controls around running agents | Platform owners want this as a built-in feature |

The recent deal activity cuts both ways.
Cyera agreed to pay about $1 billion for Oasis, and Okta agreed to pay about $200 million for Permiso, which shows demand.
It also means you would face strong, funded competitors.

The best position is probably a small open-source authority layer that works with existing sandboxes.
You would avoid rebuilding isolation and could focus on grants, leases, trace rules, and audit records.
Check this assumption early by trying to run the supervisor on top of Docker Sandboxes or E2B.

## Why this could succeed

The problem is real, and sandboxing alone doesn't fully solve it.
In July 2026, [Pillar Security disclosed seven escapes and bypasses across four coding agents](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-sandbox-escapes-20260722-c/).
None broke the sandbox itself.
They exploited files that trusted components outside the sandbox later read, ran, or scanned.

That pattern is close to your dead-agent problem: something left behind later gains power it should never have had.
It gives this project a specific story, rather than yet another sandbox.

- **Clear demo:** kill an agent, start a successor, and show that the sensitive step stays blocked.
- **Strong primitives:** Linux, Firecracker, and Tetragon already handle much of the hard low-level work.
- **Growing demand:** agent security is attracting serious budgets and acquisitions.
- **Neutral position:** some teams may want one control layer across several models and clouds, rather than relying on one vendor.
  This still needs testing with real buyers.
- **Open source path:** a small, inspectable runtime can earn developer trust and adoption.

## Why this could fail

The biggest risk is that this becomes a feature rather than a product.
Sandbox companies, agent vendors, or platform owners could add grants and leases before you find a market.

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Bundled by larger players | Buyers may prefer a built-in feature | Stay focused on cross-agent authority and audit |
| Laundered instructions | A valid agent can still follow a poisoned note | Check each sensitive action against the grant's purpose |
| Scope too broad | Trying to build an OS can consume years | Keep the first release to one agent and one workflow |
| Sensitive actions outside your control | Agents may use tools you don't mediate | Route credentials and external actions through the broker |
| Trusted host tools | Tools outside the VM may run agent-written files | Review outputs, and keep hooks and CI files behind a gate |
| Approval fatigue | People stop reading prompts | Use reversible workspaces and approve only high-impact actions |
| Bugs in the supervisor | One flaw could undermine the whole system | Keep it small, test it heavily, and get an external audit |
| Taint tracking limits | Influence through a model is hard to trace | Treat it as a signal, not a guarantee |
| Performance and compatibility | Isolation can slow or break normal tools | Measure real workflows and offer clear exceptions |
| No clear buyer | Developers like tools, but budgets may sit elsewhere | Run customer interviews before building a company |
| Burnout | Security products demand constant maintenance | Set decision gates and allow yourself to stop |

Also assume the product can't make prompt injection disappear.
Its job is to limit the damage, make authority explicit, and leave a clear record.

## What can come out of this

The most likely good outcome is a respected open-source project and rare systems security experience.
A venture-scale company is possible, but it shouldn't be the plan you depend on.
These are judgment calls, not statistical predictions.

| Outcome | Likelihood | What you get |
| --- | --- | --- |
| Deep technical skill and a strong portfolio | High, if you finish the demo | Real experience in Linux, isolation, and agent security |
| Open-source tool with a small community | Moderate | Reputation, feedback, and possible contributors |
| Paid pilots or consulting | Lower | Revenue and proof of a real customer problem |
| Funded startup | Low | Team, capital, and much greater pressure |
| Acquisition | Low | Possible if the product and team become strategically useful |
| Project stops after the demo | Fairly likely | You still keep the skills, code, and findings |

A realistic success test for the first year is simple: at least five teams try it on real work, and at least one would be upset if it disappeared.

## Sources

Time, cost, and likelihood figures are planning judgments, not sourced data.
Market details are as of the pages below and may change quickly.

- [Firecracker getting started guide](https://github.com/firecracker-microvm/firecracker/blob/main/docs/getting-started.md)
- [Claude Code sandboxing documentation](https://code.claude.com/docs/en/sandboxing)
- [Cloud Security Alliance: The Trust Handoff Flaw](https://labs.cloudsecurityalliance.org/research/csa-research-note-ai-coding-agent-sandbox-escapes-20260722-c/)
- [Aident: Running coding agents in Docker Sandboxes](https://aident.ai/blog/run-claude-code-codex-docker-sandbox)
- [LogRocket: Comparing AI agent sandbox platforms](https://blog.logrocket.com/comparing-ai-agent-sandbox-platforms-e2b-modal-daytona-and-more/)
- [We The Flywheel: AI agent security vendors 2026](https://wetheflywheel.com/en/guides/ai-agent-security-vendors-2026/)
- [StartupHub.ai: AI agent governance deals](https://www.startuphub.ai/ai-news/ai-news/2026/agentic-ai-governance-five-deals-week-july-2026)
