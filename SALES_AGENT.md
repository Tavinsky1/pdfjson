# PDF → JSON API · Sales Agent Playbook

> **Internal document.** Everything you need to pitch, qualify, close, and onboard a customer.

---

## 1. The One-Liner

> "You `POST` a PDF, you get back clean JSON. No GUI, no setup, one API key."

Use this in every first message, every cold email subject line, every HN comment.

---

## 2. Who Buys This (ICP — Ideal Customer Profile)

Target these three personas in this exact order. They convert fastest at the top.

### 🥇 Persona A — The Indie Dev / Micro-SaaS Builder
| | |
|---|---|
| **Who** | Solo developer building an invoicing, expense, accounting, or document tool |
| **Where to find them** | r/SaaS · r/webdev · r/indiegaming · IndieHackers · HN Show HN |
| **Their pain** | They hit PDF parsing and spend 3 days before giving up or duct-taping PyPDF2 |
| **Trigger phrase** | *"I need to extract data from PDFs that users upload"* |
| **Willingness to pay** | High — they understand API pricing immediately |
| **Price point** | Starter ($19/mo) or Pro ($49/mo) |
| **Close rate** | High — they sign up same day, no sales call needed |

### 🥈 Persona B — The Freelance Developer
| | |
|---|---|
| **Who** | Freelancer building client projects involving document processing |
| **Where to find them** | Upwork · Toptal communities · freelancer Slack groups · Twitter/X |
| **Their pain** | Client asks for invoice/receipt parsing, they're billing hourly and don't want to build infra |
| **Trigger phrase** | *"My client needs to upload invoices and have the data go into their system"* |
| **Willingness to pay** | Medium-High — they pass the cost to the client, so it's invisible to them |
| **Price point** | Pro ($49/mo) per client project |
| **Close rate** | Medium — needs one follow-up |

### 🥉 Persona C — The Small Business / Ops Person
| | |
|---|---|
| **Who** | Small business owner or ops manager processing 50–500 invoices/receipts a month manually |
| **Where to find them** | LinkedIn · local business Facebook groups · Zapier/Make community |
| **Their pain** | Their accountant charges per invoice entry, or they're doing it by hand |
| **Trigger phrase** | *"We process a lot of invoices and it takes forever"* |
| **Willingness to pay** | Medium — needs ROI explanation (see Section 5) |
| **Price point** | Starter ($19/mo) |
| **Close rate** | Lower — needs education, but great for word-of-mouth |

---

## 3. Competition & Positioning

| Competitor | Their price | Their problem | Our angle |
|---|---|---|---|
| **Docparser** | $29–$149/mo | Requires GUI zone-drawing per template. Breaks when format changes. | *Zero setup. No templates. Works on any PDF.* |
| **Parseur** | $39–$600/mo | Same GUI problem. Expensive at scale. | *Flat pricing. No per-page fees.* |
| **AWS Textract** | Pay-per-page ($0.015–$0.065/page) | Complex setup. AWS knowledge required. Expensive for many small docs. | *One endpoint. One key. Predictable monthly bill.* |
| **Adobe PDF Extract** | $0.10/page after free tier | Very expensive. Enterprise-focused. | *For developers. No sales call. Works in 5 minutes.* |
| **LlamaParse / Unstructured** | Usage-based, complex | Designed for AI pipelines, not simple field extraction | *Returns structured JSON fields, not raw markdown blobs.* |

**Our positioning statement (memorise this):**
> "Every other PDF parser either makes you draw zones in a GUI, or charges per page and breaks your budget. We give you a single REST endpoint, flat monthly pricing, and structured JSON back — no setup, no surprises."

---

## 4. The Demo Script (5-minute live demo)

Run this in order. Takes 5 minutes. Works every time.

```bash
# Step 1 — Create a key (30 seconds)
curl -X POST https://pdfapi.dev/keys \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@example.com"}'

# → They see their key: pdfa_xxxxxxxxxxxx

# Step 2 — Parse an invoice PDF (90 seconds)
curl -X POST https://pdfapi.dev/parse \
  -H "Authorization: Bearer pdfa_xxxxxxxxxxxx" \
  -F "file=@invoice.pdf"

# → They see clean JSON: vendor, total, line items, dates
```

**What to say while it runs:**
> "Notice — no config, no template, no zone-drawing. You just got a key and called one endpoint. That JSON is ready to insert directly into your database."

**Questions to ask after the demo:**
1. *"What format are the PDFs you're processing — invoices, receipts, contracts?"*
2. *"How many PDFs would you estimate per month?"*
3. *"What happens to the data after you extract it — where does it go?"*

---

## 5. Objection Handling

### "I can build this myself with PyPDF2 / pdfminer"
> "Totally. Most developers try that first. The problem is: PyPDF2 can't handle scanned PDFs, breaks on non-standard layouts, and gives you a wall of text — not structured fields. You still have to write all the parsing logic yourself. We've already solved that. What's your hourly rate? If this takes you 4 days, that's already 8 months of our Starter plan."

### "What about data privacy? I don't want my invoices in your system."
> "Fair concern. PDFs are processed in memory and never stored — we only save the extracted JSON result and a job record. We don't train on your data. For enterprise needs, we can discuss a self-hosted option (it's open source)."

### "Why not just use ChatGPT / Claude directly?"
> "You can, but then you're writing prompt engineering, handling JSON validation, managing retries, tracking usage per user, and building auth — that's the whole product we've already built. We're the layer between your app and the AI."

### "Is $19/month worth it for 500 parses?"
> "At $19/month, that's $0.038 per PDF. If your accountant charges $2 per manual invoice entry, you break even after 10 invoices. The other 490 are pure profit for you."

### "What if I need more than 20,000 parses?"
> "Email us at hi@pdfapi.dev. We do custom Scale pricing — typically a flat fee or volume discount. Most high-volume customers get a better per-parse rate than our public tiers."

### "What happens if it gets the extraction wrong?"
> "The response includes the raw extracted text alongside the structured fields, so you can always fall back or display it to the user for correction. Accuracy on standard invoices and receipts is very high. For highly non-standard formats, accuracy improves significantly on the Pro tier which uses a stronger AI model."

### "I'm already using [competitor]. Why switch?"
> "What's your current cost per 1,000 parses? And do you have to update templates when your suppliers change their invoice format?" 
> *(If they answer yes to templates: "We don't use templates at all. AI understands any layout.")*

---

## 6. Pricing Page Copy

```
Free      $0/mo   50 parses/mo    Get started with no credit card
Starter  $19/mo  500 parses/mo   For indie developers and small projects
Pro      $49/mo  3,000 parses/mo  For growing tools and freelance projects
Scale   $149/mo  20,000 parses/mo For production applications

All plans include:
✓ invoice, receipt, and generic document extraction
✓ JSON output with vendor, buyer, line items, totals, dates
✓ File upload OR URL input
✓ Usage dashboard
✓ Email support (Starter+)

No per-page fees. No templates to configure. Cancel anytime.
```

---

## 7. Cold Outreach Templates

### Reddit (r/SaaS / r/webdev / r/IndieHackers)

**Comment on threads about PDF parsing problems:**
> "If you're still fighting this — I built a dead-simple API for this exact problem. POST a PDF, get back structured JSON (vendor, invoice number, line items, total, dates). No zone-drawing, no templates. Free tier to try. [pdfapi.dev]"

**Show HN post:**
> **Show HN: PDF → clean JSON in one API call, no templates or config**
>
> I kept running into the same problem building tools: a user uploads a PDF invoice or receipt, and you need the data in your database. Every existing solution either requires you to draw zones in a GUI (which breaks when the format changes) or returns raw text (which you still have to parse yourself).
>
> So I built pdfapi.dev: POST a file, get back a JSON object with vendor, invoice number, line items, tax, total, dates — structured and ready to insert.
>
> Free tier: 50 parses/month, no credit card.
> Starter: $19/month for 500 parses.
>
> Happy to answer questions about how the extraction works.

---

### Cold Email (Developer / Freelancer)

**Subject:** your PDF parsing problem

> Hey [name],
>
> Saw your project on [IndieHackers/GitHub/Twitter]. Looks like you're dealing with PDF invoice/receipt processing.
>
> I built something that might save you a few days: pdfapi.dev — one endpoint, POST a PDF, get structured JSON back. No templates, no zone-drawing, no PyPDF2 headaches.
>
> Free tier at [pdfapi.dev]. Takes 5 minutes to integrate.
>
> — Tav

**Subject:** re: your invoice processing question

> Hey [name],
>
> I saw your post about parsing PDFs. Happy to answer questions — but also: I built pdfapi.dev to solve exactly this.
>
> It literally takes: create a key (POST /keys) → parse a PDF (POST /parse with your file) → get JSON with vendor, lines, total, dates.
>
> Free 50 parses/month to try with no card. Link: pdfapi.dev
>
> — Tav

---

### Cold Email (Small Business / Ops)

**Subject:** cutting your invoice processing time

> Hi [name],
>
> If your team is manually entering invoices into [their software], there's a faster way.
>
> I built a tool called PDF API that reads an invoice PDF and outputs the vendor name, invoice number, line items, tax, and total automatically — in under 2 seconds.
>
> At $19/month for 500 invoices, that's $0.04 per invoice versus minutes of manual entry.
>
> Worth a quick look? pdfapi.dev — free to try, no card needed.
>
> — Tav

---

## 8. Launch Channels (Priority Order)

| Channel | Action | Expected result |
|---|---|---|
| **Hacker News — Show HN** | Post Monday 9am ET | 50–300 signups if it hits front page |
| **r/SaaS** | Post with real demo output screenshot | 20–80 signups |
| **r/webdev** | Post once a week, helping in comments | Slow burn, 5–20/week |
| **IndieHackers** | Product listing + milestone posts | 10–30 signups/month ongoing |
| **Twitter/X** | 3 tweets per week: demos, pain points, progress | Compounds over weeks |
| **Dev.to article** | "Parse any PDF to JSON in Python in 10 lines" | SEO + developer trust |
| **Product Hunt** | Launch after 50+ users (for social proof) | 100–500 signups day-of |
| **SEO** | Target: "pdf to json api", "parse invoice api", "extract pdf data python" | 3–6 month payoff |

---

## 9. First 10 Customers Playbook

1. **Day 1:** Post Show HN. Reply to every single comment personally.
2. **Day 2–3:** Post in r/SaaS, r/webdev, r/indiegaming. Engage comments.
3. **Week 1:** DM every person who stars/bookmarks the product on IndieHackers. Offer to help them integrate.
4. **Week 2:** Search Twitter for "pdf parsing developer", "extract invoice data python". Reply with the one-liner.
5. **Week 3:** Email the 5 biggest threads on HN about PDF parsing. Direct, short, link.
6. **First paying customer:** Email them personally. Ask what they're building. Ask if they know anyone else with the same problem. This is how you get customers 2–5.

---

## 10. Metrics to Track Weekly

| Metric | Target (Month 1) | Target (Month 3) |
|---|---|---|
| Free signups | 50 | 200 |
| Free → Paid conversion | 5% | 8% |
| Paying customers | 3 | 16 |
| MRR | $57 | $400 |
| Churn rate | < 20% | < 10% |
| Avg parses/customer/month | 150 | 400 |
| Support tickets/week | < 5 | < 10 |

---

## 11. What "Done" Looks Like for This Product

The goal is **not** to build a unicorn. The goal is:

- **$500 MRR** (≈ 26 Starter customers): covers all costs + pays for a beer every day
- **$2,000 MRR** (≈ 40 Pro customers): part-time income, can start automating marketing
- **$5,000 MRR** (≈ 100 customers mixed): acquisition target — tools like this sell for 3–5× ARR on [Acquire.com](https://acquire.com), meaning **$180,000–$300,000 exit**

Acquirers for a product like this: developer tooling companies, invoice/accounting SaaS companies (Freshbooks, Wave, Zoho), document AI startups needing a parser layer.

---

*Last updated: February 2026*
