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

A study of models monitoring their own actions, with code review among its cases, measured the same effect: a model rates an action as more correct and less risky when the action appears as its own earlier turn than when the same action is handed to it as new material to judge. The effect was strongest when the model really had produced the action. Merely telling the model that it wrote something did not cause it. For NorthStar this supports two choices at once: the reviewer should not be the writer's model, and the diff should reach it as material in a fresh run, never as a continuation of the writer's session.

- https://arxiv.org/abs/2603.04582

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

## 10. The reviewer is measured before it is trusted

**Decision.** `northstar calibrate` replays commits a person already accepted through the reviewer and reports how many it would have blocked. Nothing about the reviewer's strictness is assumed. Its blocks are not filtered or outvoted yet, because no measurement says they need to be.

**Evidence.** Three results point the same way.

A study had five models judge whether code met its written requirement, on more than 1,400 paired correct and buggy solutions. The models rejected correct code often, and the richer the prompt the worse it got: with GPT-4o on one benchmark the false rejection rate went from 26% for a bare verdict to 73% when the model also had to explain and propose a fix. What repaired it was running code. When the proposed fix and the original were both put through tests, average false rejection on that benchmark fell from about 55% to about 16%.

- https://arxiv.org/abs/2603.00539

A benchmark of 1,000 hand-checked pull requests, half of them clean, found that automated review tools were held back mainly by false alarms. The best-scoring setup reached about 17% precision. Nearly half of a sample of false alarms came from the tool not understanding the surrounding code, and another third from over-reacting to a change or from vague feedback. Merging five independent reviews raised that setup's score by about 23%, with little gained beyond five.

- https://arxiv.org/abs/2509.01494

A benchmark of review agents on 1,800 real bugs found the best agent caught about 72% of them, and that agents did up to 25.5% worse on private company code than on open source. Its authors advise against trusting a general score and recommend measuring review agents on the repo they will work in, with a person keeping the final say on changes that matter.

- https://arxiv.org/abs/2610.13668

**What this means for our reviewer.** Our review brief asks for an explanation and a suggested fix with every finding, which is the prompt shape that raised false rejection in the first study. That study used small single-function tasks and partly older models, so it may not carry over. It is a risk to measure, not a reason to change the brief blind. The pipeline already does the part that worked in that study: by the time the reviewer sees a change, the gates have run the tests.

**How we will test it.** Run `northstar calibrate` on each benchmark repo and read every block. If more than about one accepted commit in five is blocked for reasons a person rejects, try in this order: a brief that asks for the verdict first and the explanation only for blocks, then two independent reviews with a block needing both.

## 11. The loop is short and stops when the writer repeats itself

**Decision.** A run gets three attempts by default. The writer starts each attempt as a fresh run that sees the current files and only the latest failure, not the history of earlier attempts. If an attempt produces exactly the change the last one did, the run stops there and goes to a person.

**Evidence.** A study of repair loops across three frontier models and four benchmarks found that the gain is front-loaded, with 53% of all improvement coming from the first repair attempt. It also found that failing runs get stuck: between 38% and 49% of the runs that never recovered produced the same wrong program for all ten attempts. Giving the model the full history of its attempts did not help, and on the hardest benchmark it cost 7.5 points.

- https://icml.cc/virtual/2026/82772

A separate experiment ran code through repeated rounds of model "improvement" with no person in between, and counted 37.6% more critical vulnerabilities after five rounds. More rounds are not free quality. Every attempt can also add problems, which is why each attempt goes through every check again and why the cap is low.

- https://arxiv.org/abs/2506.11022

**How we will test it.** The benchmark records attempts per task. Look at how many passes come on attempt one, two, and three, and how many runs end on a repeated change. If almost nothing passes on attempt three, lower the default to two.

