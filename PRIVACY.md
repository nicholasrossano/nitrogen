# Privacy Policy

**Last updated:** 2026-07-21

> **Template notice:** This is a standard SaaS privacy policy template drafted to cover Nitrogen AI's hosted product. It has not been reviewed by an attorney. Have qualified counsel review and adapt this — especially the third-party processor list and any jurisdiction-specific rights (GDPR, CCPA, etc.) — before relying on it.

This Privacy Policy describes how we collect, use, and share information when you use the hosted Nitrogen AI product at `app.the-nitrogen.ai` and related subdomains (the "Service"). It does not apply to self-hosted deployments of the open-source codebase, where you are the data controller — see [docs/self-hosting.md](docs/self-hosting.md) and [docs/data-isolation.md](docs/data-isolation.md) for how the software itself handles data.

## 1. What we collect

- **Account information:** email address, authentication identifiers (via Firebase Authentication), and workspace/organization details.
- **Content you provide:** project descriptions, uploaded documents and evidence, chat messages, assessment inputs, comments, and other content you create in the product ("Your Content").
- **Usage data:** feature usage, AI generation/credit consumption, error logs, and similar operational telemetry used to run and improve the Service.
- **Billing data:** subscription tier and payment metadata processed by our payment processor (Stripe); we do not store full payment card numbers ourselves.

## 2. How we use it

- To provide the Service: process your content, run AI-assisted assessments, generate documents, and maintain your account.
- To send relevant excerpts of Your Content to third-party AI model providers (e.g. OpenAI) as needed to generate assessments, chat responses, and other AI-assisted output.
- To operate, secure, debug, and improve the Service.
- To communicate with you about your account, billing, and material product changes.
- We do not sell Your Content or personal data to third parties.

## 3. Third-party processors

We rely on infrastructure and service providers to operate the Service, including (non-exhaustive): OpenAI or other configured LLM providers (AI generation), Firebase (authentication), a PostgreSQL host such as Neon (database), Stripe (billing), and hosting/CDN providers (e.g. Vercel, Railway). Each processes data only as needed to provide their respective function to us, under their own data-processing terms.

## 4. Data retention

We retain Your Content and account data for as long as your account is active, or as needed to provide the Service. You can delete individual projects, files, or your entire account (including personal workspace, chat history, and billing records) from Settings. Deletion is generally permanent and cannot be undone.

## 5. Data isolation between workspaces

Company and team workspace data is scoped to members of that workspace; personal chat and personal workspace content is private to your account unless you explicitly promote it to a shared project. See [docs/data-isolation.md](docs/data-isolation.md) for the underlying technical boundaries.

## 6. Security

We use industry-standard measures (encryption in transit, access controls, and routine security scanning — see [SECURITY.md](SECURITY.md)) to protect data, but no system is perfectly secure. Report suspected vulnerabilities per [SECURITY.md](SECURITY.md).

## 7. Your rights

Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal data. You can exercise most of these directly in Settings, or contact us at the address below for anything not self-service.

## 8. Children's privacy

The Service is not directed to individuals under 18 and we do not knowingly collect data from them.

## 9. International transfers

Depending on where our infrastructure providers operate, your data may be processed in countries other than your own. We rely on our processors' standard safeguards for cross-border transfers.

## 10. Changes to this policy

We may update this policy from time to time. We'll post the updated version here with a new "Last updated" date.

## 11. Contact

Questions about this Privacy Policy or your data: **nicholas.rossano@gmail.com**.

See also: [Terms of Service](TERMS.md), [SECURITY.md](SECURITY.md), [docs/data-isolation.md](docs/data-isolation.md).
