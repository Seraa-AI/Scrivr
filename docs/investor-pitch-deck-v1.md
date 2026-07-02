# Scrivr Investor Pitch Deck — V1

Prepared June 24, 2026

This draft is written for a short angel or pre-seed conversation. Keep the main
deck to 10–12 minutes. Text under **On slide** should appear on the slide. Text
under **Speaker notes** is what to say, not what to display.

---

## Slide 1 — Cover

### On slide

# Scrivr

## The document engine for AI-native software

Open-source infrastructure for building editable, collaborative, export-ready
document products.

**Raising $50,000**

### Visual

Use one strong screenshot of Scrivr displaying a polished multipage document.
Avoid a collage. Place the product screenshot on the right and the title on the
left.

### Speaker notes

AI products are becoming document products. They generate contracts, reports,
proposals, policies, and research, but generation is only the first step. Those
documents still need to be edited, reviewed, collaborated on, and exported.
Scrivr provides the document infrastructure required to do that.

---

## Slide 2 — Problem

### On slide

# AI can generate a document.

## It cannot deliver the document workflow.

- Generated output still needs editing and formatting
- Business documents require review, comments, and tracked changes
- Pagination and export must remain reliable
- Building this infrastructure internally can take years

### Visual

Show a simple progression:

`AI output → Edit → Review → Collaborate → Export`

Visually emphasize the gap between AI output and a finished business document.

### Speaker notes

Most AI teams begin with a prompt and a text response. As their product matures,
customers ask for a real document experience. Teams then discover that rich
text editing is only a small part of the problem. They also need layout,
pagination, tables, images, collaboration, review workflows, and high-fidelity
export.

---

## Slide 3 — Existing choices

### On slide

# Today, teams choose between three bad options

| Choice | Tradeoff |
| --- | --- |
| Build internally | Years of specialized engineering |
| Use a DOM editor | Fast start, difficult document fidelity |
| Embed an office suite | Limited control and weak product integration |

## Document infrastructure becomes a product bottleneck.

### Visual

Use three columns with one icon and one short tradeoff per option. Do not place
competitor logos on this slide.

### Speaker notes

General-purpose web editors are good at flowing text through a webpage. They
were not designed to provide deterministic pages and office-grade document
behavior. Office-suite embeds offer more functionality but make it difficult
for a company to own the user experience, data model, and AI workflow.

---

## Slide 4 — Solution

### On slide

# Scrivr gives developers the document layer

- Canvas-rendered, paginated editing
- Custom layout and line-breaking engine
- React and headless APIs
- Real-time collaboration
- AI suggestions and tracked changes
- PDF, DOCX, and Markdown export

## Install the engine. Build the product around it.

### Visual

Use a product screenshot with six small callouts pointing to visible features.
Keep the callouts short.

### Speaker notes

Scrivr is an embeddable framework, not another standalone word processor.
Product teams keep control of their application, interface, data, and AI model.
Scrivr handles the difficult document primitives underneath.

---

## Slide 5 — Product demonstration

### On slide

# From AI draft to finished document

1. Generate structured content
2. Edit it in a real paginated document
3. Review AI suggestions inline
4. Collaborate and track changes
5. Export the final result

### Visual

This should ideally be a live demonstration. For a PDF deck, use three frames:

1. Generated draft
2. Inline AI review or tracked changes
3. Finished exported document

### Speaker notes

The demonstration should take no more than ninety seconds. Start with an
existing document rather than typing from scratch. Show one AI suggestion, one
layout capability, and one export. The purpose is to demonstrate an integrated
workflow, not every toolbar feature.

---

## Slide 6 — Why now

### On slide

# AI is moving from answers to artifacts

Contracts. Reports. Proposals. Policies. Research.

## Every AI company producing business documents needs:

**Generation + Editing + Review + Collaboration + Delivery**

### Visual

Use five clean document thumbnails representing the listed document types.
Connect them to one shared Scrivr engine underneath.

### Speaker notes

The first generation of AI products focused on chat. The next generation must
produce persistent business artifacts that people can trust, revise, approve,
and send. Each company should not have to rebuild a document engine before it
can serve that workflow.

---

## Slide 7 — Beachhead customer

### On slide

# Starting with developer-led AI companies

Teams building:

- Contract and legal workflows
- Research and report generation
- Proposals and sales documents
- Compliance and policy products

## They need differentiated workflows without building an editor from scratch.

### Visual

Use four customer categories around a central Scrivr block. Avoid describing
the target as every company that uses documents.

### Speaker notes

The initial customer is a small or mid-sized AI software company with developers
and a document-heavy workflow. These teams feel the problem early, can integrate
an SDK, and value control over their product experience. The initial sales
motion is founder-led and design-partner driven.

---

## Slide 8 — Early traction

### On slide

# Early developer demand without a team or sales operation

## 3,155

`@scrivr/core` downloads since launch

## 1,071

`@scrivr/core` downloads in the latest 30-day npm window

**Launched April 6, 2026 · Current version 1.0.13**

### Visual

Use two large numbers and a simple weekly download chart. Label this
**developer interest**, not customers or active users.

### Speaker notes

Scrivr was first published on npm on April 6, 2026. The core package recorded
3,155 downloads through June 22, including 1,071 in the latest thirty-day
window. npm downloads include automated and repeat installs, so this is not
presented as a user count. It is early evidence that developers are discovering
and evaluating the product.

### Data source

- https://api.npmjs.org/downloads/point/last-month/%40scrivr%2Fcore
- https://api.npmjs.org/downloads/point/last-year/%40scrivr%2Fcore
- https://registry.npmjs.org/%40scrivr%2Fcore

---

## Slide 9 — Technology and defensibility

### On slide

# The difficult layer is the engine

`ProseMirror model`

↓

`Custom layout and pagination`

↓

`Document fragments and coordinates`

↓

`Virtualized canvas rendering`

## Scrivr controls layout instead of inheriting browser layout.

### Visual

Use the architecture pipeline above. Add three small labels:

- Deterministic pages
- Extensible document objects
- Long-document performance

### Speaker notes

Scrivr uses ProseMirror for the document model, but layout and rendering are
custom. The engine measures text, breaks lines, paginates content, places
objects, and paints virtualized canvas tiles. This creates a technical base that
becomes more valuable as document features and compatibility improve.

Do not claim that canvas alone is the moat. The defensibility comes from the
accumulated layout behavior, document compatibility, extension ecosystem, test
corpus, and production integrations.

---

## Slide 10 — Business model

### On slide

# Open-source distribution, commercial infrastructure

### Free

- Core editor framework
- React integration
- Community adoption

### Paid

- Commercial and enterprise SDK capabilities
- Hosted real-time collaboration
- Advanced AI review workflows
- Compliance, deployment, and support
- Usage-based document processing

## Developers adopt. Companies pay to operate at production scale.

### Visual

Use a two-layer diagram: open-source adoption feeding paid production services.

### Speaker notes

The open-source engine reduces adoption friction and creates developer trust.
Revenue will come from the capabilities companies need when moving from
prototype to production. The immediate objective is not to build every possible
paid service. It is to discover which production pain is strongest through
design partnerships.

---

## Slide 11 — Founder and execution

### On slide

# Built by one technical founder

- Designed and implemented the document engine
- Shipped seven versioned npm packages
- Built layout, rendering, collaboration, AI review, and export systems
- Reached early developer distribution without paid acquisition

## Capital-efficient execution on a technically difficult product.

### Visual

Use a founder photo, name, role, and two or three relevant background facts.
Replace this placeholder copy with specific professional credentials before
presenting.

### Speaker notes

Be direct about being a solo founder. The product demonstrates ability to ship,
but the company currently has key-person and execution risk. The purpose of this
round is to create enough focused runway to convert the technical foundation
into customer evidence and a repeatable business.

---

## Slide 12 — The raise

### On slide

# Raising $50,000

## Six months to prove commercial demand

- Recruit 10 design partners
- Convert 3–5 into paying customers
- Improve DOCX interoperability and editing quality
- Reach 5,000 monthly core-package downloads
- Define a repeatable commercial offering

### Use of funds

- **60%** founder runway
- **20%** infrastructure and product tooling
- **10%** developer distribution
- **10%** legal and operations

### Speaker notes

The round is intentionally small and milestone-driven. The target is not merely
to continue building features. It is to establish who pays, what they pay for,
and whether open-source distribution can produce a repeatable customer
pipeline. Raise on a standard SAFE, subject to appropriate legal advice.

---

## Slide 13 — Closing

### On slide

# AI companies should build their workflow,

# not rebuild the document engine.

## Scrivr can become the document layer behind AI-native business software.

**[Founder name]**  
**[Email] · [Website] · [GitHub]**

### Visual

Return to the strongest product screenshot from the cover. Keep the closing
slide visually simple.

### Speaker notes

Scrivr has the technical foundation and early developer interest. This round
funds the transition from a promising open-source engine to a commercially
validated infrastructure company.

---

# Optional appendix

Do not present these slides unless the investor asks about the topic.

## Appendix A — Product architecture

- Model: ProseMirror
- Layout: custom line breaking, pagination, tables, and positioned objects
- Rendering: virtualized HTML canvas tiles
- Collaboration: Yjs and Hocuspocus
- Integrations: React and headless server APIs
- Output: PDF, DOCX, and Markdown

## Appendix B — Competitive framing

| Category | Strength | Scrivr differentiation |
| --- | --- | --- |
| DOM editor frameworks | Mature editing ecosystems | Scrivr owns pagination and visual layout |
| Office-suite embeds | Broad office functionality | Scrivr offers product and workflow control |
| Internal development | Fully customized | Scrivr reduces time and specialist engineering |
| Static generation tools | Strong document output | Scrivr adds interactive editing and review |

Avoid broad claims such as "no competitors." The credible argument is that
Scrivr combines embeddability, controlled layout, and AI-native review.

## Appendix C — Risks and answers

### Why will companies not build this themselves?

Some large companies will. Scrivr targets teams for which document
infrastructure is necessary but not their core product differentiation.

### Why canvas?

It gives the engine direct control over measurement, placement, pagination,
overlays, and rendering. It also creates accessibility, input, and compatibility
work that Scrivr must continue addressing.

### Are npm downloads users?

No. They are a signal of package activity and developer interest. Commercial
validation requires design partners, active integrations, retention, and
revenue.

### Why can a solo founder execute?

The existing product demonstrates deep technical execution. The next milestone
must demonstrate customer development and commercial focus. Future hiring or a
commercial co-founder should follow evidence of the strongest bottleneck.

---

# Build recommendations

## Best tool for the first version

Use **Canva or Google Slides** for the fundraising deck. Both make it fast to
adjust the narrative after investor feedback. Use the codebase for screenshots
and diagrams, but do not build the first deck as a web application.

Recommended workflow:

1. Build the 13-slide version in Canva.
2. Export a PDF for sending.
3. Keep a presentation version with the product demo linked or embedded.
4. Track investor feedback and revise the source deck weekly.

## Visual system

- Format: 16:9
- Background: off-white or near-black
- Accent: use one color already associated with Scrivr
- Type: one sans-serif family with two weights
- Titles: 36–48 pt
- Body text: at least 22–24 pt
- Maximum: one claim and three to five supporting points per slide
- Prefer product evidence over stock illustrations
- Use the same page margins and alignment throughout

## Temporary wordmark

Do not delay the deck to commission a logo. Use **Scrivr** as a text-only
wordmark:

- Typeface: Inter, Manrope, or Geist
- Weight: 650–700
- Letter spacing: slightly tight
- Case: `Scrivr`, not all caps
- Color: near-black on light backgrounds or white on dark backgrounds
- Optional accent: color only the final `r`, or add a small square cursor after
  the name

Use the wordmark consistently in the top-left corner. Do not add a generic pen,
document, sparkle, or AI icon. The product screenshot should carry more visual
weight than the brand mark.

## Assets still needed

- Consistent Scrivr text wordmark
- Strong editor screenshot
- Ninety-second product demo
- Founder photo and concise biography
- Weekly npm download chart
- Website, contact, and GitHub links
- Any genuine user comments, integrations, or design-partner conversations

## Claims to avoid

- Calling downloads active users
- Claiming product-market fit
- Claiming a proven business model
- Presenting roadmap features as currently shipped
- Using an inflated top-down market-size number without a credible customer and
  pricing model
