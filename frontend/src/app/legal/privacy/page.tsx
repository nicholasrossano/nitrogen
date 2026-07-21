import type { Metadata } from 'next';
import { LegalPageShell } from '@/components/legal/LegalPageShell';

export const metadata: Metadata = {
  title: 'Privacy Policy — Nitrogen AI',
};

const LAST_UPDATED = '2026-07-21';

/**
 * Mirrors the canonical copy in /PRIVACY.md at the repo root. Keep both in sync —
 * the markdown file is the GitHub-visible source, this page is the in-app / public link target.
 */
export default function PrivacyPage() {
  return (
    <LegalPageShell title="Privacy Policy" lastUpdated={LAST_UPDATED}>
      <p>
        This Privacy Policy describes how we collect, use, and share information when you use the hosted Nitrogen AI
        product at <code>app.the-nitrogen.ai</code> and related subdomains (the &quot;Service&quot;). It does not
        apply to self-hosted deployments of the open-source codebase, where you are the data controller — see
        docs/self-hosting.md and docs/data-isolation.md on{' '}
        <a href="https://github.com/nicholasrossano/nitrogen" target="_blank" rel="noopener noreferrer">
          GitHub
        </a>{' '}
        for how the software itself handles data.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li>
          <strong>Account information:</strong> email address, authentication identifiers (via Firebase
          Authentication), and workspace/organization details.
        </li>
        <li>
          <strong>Content you provide:</strong> project descriptions, uploaded documents and evidence, chat
          messages, assessment inputs, comments, and other content you create in the product (&quot;Your
          Content&quot;).
        </li>
        <li>
          <strong>Usage data:</strong> feature usage, AI generation/credit consumption, error logs, and similar
          operational telemetry used to run and improve the Service.
        </li>
        <li>
          <strong>Billing data:</strong> subscription tier and payment metadata processed by our payment processor
          (Stripe); we do not store full payment card numbers ourselves.
        </li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>
          To provide the Service: process your content, run AI-assisted assessments, generate documents, and
          maintain your account.
        </li>
        <li>
          To send relevant excerpts of Your Content to third-party AI model providers (e.g. OpenAI) as needed to
          generate assessments, chat responses, and other AI-assisted output.
        </li>
        <li>To operate, secure, debug, and improve the Service.</li>
        <li>To communicate with you about your account, billing, and material product changes.</li>
        <li>We do not sell Your Content or personal data to third parties.</li>
      </ul>

      <h2>3. Third-party processors</h2>
      <p>
        We rely on infrastructure and service providers to operate the Service, including (non-exhaustive): OpenAI
        or other configured LLM providers (AI generation), Firebase (authentication), a PostgreSQL host such as Neon
        (database), Stripe (billing), and hosting/CDN providers (e.g. Vercel, Railway). Each processes data only as
        needed to provide their respective function to us, under their own data-processing terms.
      </p>

      <h2>4. Data retention</h2>
      <p>
        We retain Your Content and account data for as long as your account is active, or as needed to provide the
        Service. You can delete individual projects, files, or your entire account (including personal workspace,
        chat history, and billing records) from Settings. Deletion is generally permanent and cannot be undone.
      </p>

      <h2>5. Data isolation between workspaces</h2>
      <p>
        Company and team workspace data is scoped to members of that workspace; personal chat and personal
        workspace content is private to your account unless you explicitly promote it to a shared project.
      </p>

      <h2>6. Security</h2>
      <p>
        We use industry-standard measures (encryption in transit, access controls, and routine security scanning) to
        protect data, but no system is perfectly secure. Report suspected vulnerabilities per SECURITY.md on GitHub.
      </p>

      <h2>7. Your rights</h2>
      <p>
        Depending on your jurisdiction, you may have rights to access, correct, export, or delete your personal
        data. You can exercise most of these directly in Settings, or contact us at the address below for anything
        not self-service.
      </p>

      <h2>8. Children&apos;s privacy</h2>
      <p>The Service is not directed to individuals under 18 and we do not knowingly collect data from them.</p>

      <h2>9. International transfers</h2>
      <p>
        Depending on where our infrastructure providers operate, your data may be processed in countries other than
        your own. We rely on our processors&apos; standard safeguards for cross-border transfers.
      </p>

      <h2>10. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. We&apos;ll post the updated version here with a new &quot;Last
        updated&quot; date.
      </p>

      <h2>11. Contact</h2>
      <p>
        Questions about this Privacy Policy or your data:{' '}
        <a href="mailto:nicholas.rossano@gmail.com">nicholas.rossano@gmail.com</a>.
      </p>
    </LegalPageShell>
  );
}
