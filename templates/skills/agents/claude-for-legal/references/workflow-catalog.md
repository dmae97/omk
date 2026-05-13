# Claude for Legal workflow catalog

Use this catalog to map a legal request to a conservative workflow. Source basis: Anthropic `claude-for-legal` repository, compacted for OMK use.

## Practice areas

| Lane | Use for | Typical outputs |
| --- | --- | --- |
| Commercial legal | Vendor/customer agreements, NDAs, SaaS terms, amendments, renewal/cancel-by review, escalation routing | Issue list, fallback positions, redline memo, renewal register, stakeholder summary |
| Privacy legal | DSARs, DPAs, PIAs/DPIAs, processing triage, privacy policy drift, privacy regulatory gaps | DSAR timeline, DPA issue matrix, PIA draft, triage decision, policy-gap tracker |
| Product legal | Launch review, marketing claims, quick product-risk questions, feature risk assessment | Launch risk memo, claims substantiation table, go/no-go gate, counsel questions |
| Corporate legal | M&A diligence, board consents/minutes, disclosure schedules, closing checklists, entity compliance, integration | Diligence table, material-contract schedule, consent draft, closing tracker, entity register |
| Employment legal | Hiring, terminations, worker classification, wage/hour, leave tracking, investigations, policies, international expansion | Jurisdiction checklist, risk flags, investigation plan/memo, policy draft, counsel handoff |
| Regulatory legal | New rules/guidance, feed monitoring, policy diff, comments, gap tracking | Regulatory digest, policy-diff memo, comment tracker, gap remediation plan |
| AI governance legal | AI use-case triage, AI impact assessment, vendor AI terms, AI inventory/policy drift | Use-case tiering, AIA draft, vendor risk table, inventory update, governance gaps |
| IP legal | Trademark clearance, cease-and-desist, DMCA, OSS review, FTO triage, infringement triage, IP clauses, portfolio | Knockout screen, takedown/counter-notice draft, OSS obligations table, claim/portfolio tracker |
| Litigation legal | Claim charts, chronologies, demand letters, subpoenas, deposition prep, privilege logs, holds, matter intake/status | Cited chronology, demand draft, subpoena plan, depo outline, privilege log flags, hold checklist |
| Legal clinic | Client intake, deadline tracking, memos, plain-language client letters, semester handoff, supervised review | Intake memo, deadline sheet, research roadmap, client letter, handoff memo |
| Law student | Case briefs, outlines, IRAC practice, Socratic drill, cold-call prep, study plans, bar prep | Study plan, practice questions, feedback rubric, case brief, outline scaffold |
| Legal builder / skill QA | Evaluate/install legal skills or legal workflow templates | Security/quality review, allowlist decision, installation plan, update notes |

## Intake checklist by lane

- **Contracts/commercial**: side represented, contract type, counterparty, business goal, playbook positions, must-have terms, fallback authority, governing law, renewal/cancel deadline.
- **Privacy/AI/product/regulatory**: product/process facts, data categories, jurisdictions, user groups, vendors, policy commitments, regulator/source set, launch/deadline date.
- **Corporate/M&A**: transaction stage, buyer/seller side, materiality threshold, data-room scope, entity jurisdictions, closing conditions, board/stockholder approvals.
- **Employment**: worker location, employer entity, employee/contractor status, protected leave/complaint facts, policy history, timing, decision-maker, local counsel involvement.
- **IP**: mark/work/invention details, goods/services, jurisdictions, dates of first use/publication, license/dependency context, accused product/content, enforcement posture.
- **Litigation**: forum, parties, claims/defenses, deadlines, procedural posture, evidence corpus, privilege status, settlement posture, outside counsel role.
- **Clinic/student**: supervision level, course/clinic rules, jurisdiction, client-facing vs internal, grading/learning objective, sources allowed.

## Deliverable patterns

- **Triage memo**: facts, assumptions, issue list, risk labels, source-backed analysis, missing facts, recommended counsel decision.
- **Review table**: clause/document/source, issue, risk, rationale, proposed revision or action, owner, deadline, citation.
- **Research roadmap**: question presented, governing jurisdiction, primary sources to pull, search terms, verification plan, expected deliverable.
- **Draft communication**: purpose, audience, tone, legal caveats, bracketed attorney-review placeholders, send gate.
- **Tracker**: item, source, date found, owner, due date, status, risk, evidence link, next action.
