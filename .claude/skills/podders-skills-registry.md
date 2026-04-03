# Podders Skills Registry

Tracks project-local skills created and maintained by evolve.
Updated automatically when skills are created or modified.

## Active Skills

| Skill | Path | Created | Last Updated | Purpose |
|-------|------|---------|-------------|---------|
| podders-audit | .claude/skills/podders-audit/ | Cycle 95 | Cycle 100 | Audit specific module for bug patterns |
| podders-migration | .claude/skills/podders-migration/ | Cycle 95 | Cycle 95 | Create new DB migrations following conventions |
| podders-source | .claude/skills/podders-source/ | Cycle 95 | Cycle 95 | Scaffold new ingest source adapter |
| podders-fix | .claude/skills/podders-fix/ | Cycle 95 | Cycle 95 | Fix a specific finding from research queue |

## Skill Evolution Log

- **Cycle 95**: Initial creation of 4 project-local skills (audit, migration, source, fix)
- **Cycle 100**: Updated podders-audit with 8 new bug patterns from cycles 95-100 (claim-before-process, livelock on retry, batch length mismatch, HTML double-encoding, SQL interpolation, HTTP status regex, ULID stale detection, engagement sentinel -1)

## Planned Skills (create when pattern emerges)

- **podders-test**: Write regression tests for a specific module/finding — create after 3+ test-writing cycles show stable patterns
- **podders-pipeline**: Trace a specific pipeline path end-to-end — create after system-level audits establish stable patterns
- **podders-prompt**: Audit/improve LLM prompts for a specific stage — create when prompt engineering becomes a recurring task
- **podders-deploy**: Deployment checklist and validation — create when deployment automation is needed

## Hook Evolution Log

- **Cycle 95**: Documented existing post-commit hook (queue/lessons reconciliation)
