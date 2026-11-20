# Design decisions and the evidence behind them

NorthStar's shape follows published findings where they exist. This file lists each decision, what it rests on, and how sure we can be. None of it has been confirmed on our own benchmark yet, so each entry ends with how we will test it.

The problem itself is well documented. A study of about 300,000 verified commits written by coding assistants found that 89.3% of the issues they introduced were code smells, not bugs or security holes, and that 22.7% of the tracked issues were still in the code at the latest revision (https://arxiv.org/abs/2603.28592). Maintainability is where generated code goes wrong, and it is what NorthStar checks.

## 1. The writer's brief is short

**Decision.** The writer gets the task, the plan if there is one, hand-written repo rules, relevant helpers, a few constraints, and done-when checks. Nothing else.

**Evidence.** OpenAI's prompting guide for its Codex models says the core principle is that less is more: many practices that once had to be prompted are built in, and over-prompting can reduce quality. Codex's best practices guide recommends four things in a prompt: the goal, the context, the constraints, and what done looks like.

- https://cookbook.openai.com/examples/gpt-5-codex_prompting_guide
- https://developers.openai.com/codex/learn/best-practices

**How we will test it.** Compare the lean brief with a longer one on the benchmark tasks, with Codex as the writer.

## 2. The writer gets hand-written rules, not the scanned overview

**Decision.** By default the writer sees only the `notes` a person wrote. The scanned conventions go to the planner and the reviewer. `writerConventions: "all"` switches this.

**Evidence.** A 2026 study from ETH Zurich evaluated repository context files such as AGENTS.md across several agents. Context files tended to lower task success compared with no file, and raised cost by more than 20% because agents explored and tested more without getting more right. Machine-written files did worst. Human-written files helped a little, and what set them apart was specific, non-obvious instructions such as which tool to use. The authors suggest keeping only minimal requirements.

- https://arxiv.org/abs/2602.11988

**Caveat.** The study measured whether tasks were solved, not whether the code was clean, and its context files were far longer than our five-line summary. The direction is clear enough to set the default. The size of the effect for us is unknown.

**How we will test it.** Run the benchmark with `writerConventions` set to `notes` and to `all`.

## 3. Relevant code is retrieved per task

**Decision.** Instead of describing the whole repo, NorthStar finds the helpers whose names relate to this task and lists only those.

**Evidence.** The same study found that agents with context files spent more steps exploring. A short, task-specific list aims to cut exploration, not add to it. Our own replay found the case this is for: two helpers copied into a second file in quant-harness, which a pointer to the originals would have prevented.

**How we will test it.** Count how often a suggested helper is imported in the result, and whether the duplication gate fires less with suggestions on.

## 4. A separate, skeptical reviewer from another vendor

**Decision.** The agent that wrote the code never grades it. The reviewer runs in a fresh context, read-only, with a brief that tells it to be skeptical and shows examples of what should block a merge.

**Evidence.** Anthropic's write-up on harness design reports that agents tend to praise their own mediocre work, that a separate evaluator is easier to tune toward skepticism than a generator is to critique itself, and that an untuned evaluator would find real issues and then talk itself into approving. Calibrating with examples reduced drift in its scores. They also note the evaluator earns its cost mainly on tasks the model cannot do reliably alone, which is the situation with a weaker writer.

- https://www.anthropic.com/engineering/harness-design-long-running-apps

**How we will test it.** Seed the benchmark with changes that contain known problems and measure how many each reviewer setup catches, and how often it blocks a clean change.

## 5. An optional planner, with done-when checks

**Decision.** A planner can read the repo first and write a short plan: files to change, code to reuse, tests to add, and the checks that prove the task is done. The writer follows it and the reviewer checks against it.

**Evidence.** The same Anthropic write-up kept its planner after dropping other scaffolding, because without it the builder under-scoped. It also had the builder and the evaluator agree up front on what done means and how it would be verified. Codex's best practices list skipping planning on complex tasks as a common mistake.

**Why it matters for a weaker writer.** Deciding what to build and writing it are different jobs. Giving the first to the stronger model leaves the weaker one with the part it is better at.

**How we will test it.** Run the benchmark with and without a planner and compare attempts per task, slop metrics, and cost.

## 6. The writer knows the checks and can run them

**Decision.** The brief lists the exact gate commands and the line budget. Under Claude Code the writer is allowed to run those commands and nothing broader. Under Codex the workspace sandbox already allows it.

**Evidence.** Codex's best practices name undocumented build and test commands as a common cause of poor results, because the agent cannot verify its own work. Exact commands are also the one kind of context the ETH study found useful.

**How we will test it.** Compare first-attempt gate pass rates with and without the commands in the brief.

## 7. Test quality is checked, and test-first is not prescribed

**Decision.** NorthStar does not tell the writer to follow test-driven development. It checks the tests a change adds, flags those that assert nothing or only that a value exists, and has the reviewer judge whether each test would fail if the behavior broke.

**Evidence.** A study of 86,156 test-file patches from agent-authored pull requests found that 80.2% carry weak or no explicit checks on results. Among newly created test files, the share with strong checks ranged from 18% for OpenAI Codex to 67% for Claude Code. So this matters most for exactly the writer NorthStar is being shaped around. A second study of generated unit tests found the same gap: tests that run but lack strong assertions.

On prescribing a workflow, the evidence points the other way. One study found that adding test-first instructions without targeted context raised regressions from 6.08% to 9.94%, worse than doing nothing, while surfacing the relevant tests cut them to 1.82%. Its authors conclude that supplying context works better than prescribing procedure. A separate study found large gains, 34 to 48 percentage points, when web app generation was given test-driven infrastructure. So tests as a feedback signal clearly help. What lacks support is prescribing the workflow by prompt alone.

- https://arxiv.org/abs/2606.18168
- https://arxiv.org/abs/2609.05978
- https://arxiv.org/abs/2603.17973
- https://arxiv.org/abs/2605.17242

**Caveat.** Our check sees only the crudest weakness. A test with a strong-looking assertion on the wrong thing passes it. Mutation testing would catch more, at a real cost in time.

**How we will test it.** Count weak tests per task for a raw Codex run against a pipeline run, and sample the reviewer's verdicts on the flagged ones.

## 8. Roles are separate processes, not subagents inside one CLI

**Decision.** Planner, writer, and reviewer are separate runs that NorthStar starts, each with its own context and permissions.

**Reasoning.** Both Codex and Claude Code can spawn their own subagents. Those live inside one vendor's tool, share its judgment, and cannot be a different vendor. Running roles as separate processes is what makes cross-vendor review possible and keeps the reviewer from seeing the writer's reasoning.

## 9. Checks decide, prompts only ask

**Decision.** Every rule that matters is enforced by a check that runs on the diff. The prompt states the rule so the writer can avoid the rejection, but the pipeline never trusts the writer to have followed it.

**Reasoning.** A weaker model follows instructions less reliably. A gate behaves the same whichever model wrote the code, and that is what lets the quality bar stay fixed while the writer changes.
