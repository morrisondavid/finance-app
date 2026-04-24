/**
 * `renderTemplate` — the public surface. Reads the correct `.hbs`
 * file, parses the YAML frontmatter for `subject:`, interpolates
 * both subject and body against the {@link TemplateContext}, resolves
 * recipients, and returns a {@link TemplateResult}.
 *
 * File resolution delegates to `resolveTemplatePath` from the clients
 * domain, which returns `[override, shared]` in preference order.
 * The first candidate that exists on disk wins. Missing files raise
 * {@link TemplateMissing}.
 *
 * Routes call this from the `leave-preview` endpoint today and will
 * call it again from 2.3's send adaptor; no code path here does I/O
 * beyond the single `fs.readFileSync` — there are no DB queries, no
 * network calls, no registry mutation.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveTemplatePath } from '../clients/queries.js';
import { resolveRecipients } from './resolve-recipients.js';
import { interpolate } from './interpolate.js';
import { TemplateMissing, TemplateContextInvalid } from './errors.js';
import {
  TemplateContextSchema,
  type TemplateContext,
  type TemplateKind,
  type TemplateResult,
} from './schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// `server/domain/templates/render.ts` → repo root is four levels up.
const DEFAULT_REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export interface RenderTemplateInput {
  kind: TemplateKind;
  context: TemplateContext;
  /** Repo root (defaults to the derived one). Tests override this. */
  repoRoot?: string;
  /**
   * Optional injection: a `(relativePath) => string | null` resolver.
   * When provided, bypasses the filesystem entirely — unit tests use
   * this to render a template without committing a file. `null`
   * indicates "no such template", treated as {@link TemplateMissing}.
   */
  readFile?: (relativePath: string) => string | null;
}

interface ParsedTemplate {
  subject: string;
  body: string;
}

/**
 * Parse YAML-ish frontmatter — we only support a leading `---\n`
 * fence with `key: value` lines until a closing `---\n`. That is
 * enough for the templates we ship (a single `subject:` line) and
 * keeps the zero-dependency promise. Anything richer goes to a real
 * YAML parser when a template genuinely needs it.
 */
function parseFrontmatter(raw: string): ParsedTemplate {
  if (!raw.startsWith('---')) {
    throw new TemplateContextInvalid(
      'template file is missing its `---` frontmatter fence',
    );
  }
  const afterOpenFence = raw.slice(3);
  const newlineAfter = afterOpenFence.indexOf('\n');
  if (newlineAfter === -1) {
    throw new TemplateContextInvalid('malformed frontmatter (no newline after opening fence)');
  }
  const rest = afterOpenFence.slice(newlineAfter + 1);
  const closeFenceIdx = rest.indexOf('\n---');
  if (closeFenceIdx === -1) {
    throw new TemplateContextInvalid('malformed frontmatter (no closing `---` fence)');
  }
  const frontmatter = rest.slice(0, closeFenceIdx);
  const afterCloseFence = rest.slice(closeFenceIdx + 4);
  // Strip a single leading newline from the body if present.
  const body = afterCloseFence.startsWith('\n') ? afterCloseFence.slice(1) : afterCloseFence;

  let subject = '';
  for (const line of frontmatter.split('\n')) {
    const match = /^subject\s*:\s*(.*?)\s*$/.exec(line);
    if (match) {
      subject = match[1];
      // Remove surrounding matching quotes if the author wrapped them.
      if ((subject.startsWith('"') && subject.endsWith('"'))
        || (subject.startsWith("'") && subject.endsWith("'"))) {
        subject = subject.slice(1, -1);
      }
      break;
    }
  }
  if (subject.length === 0) {
    throw new TemplateContextInvalid('template frontmatter has no `subject:` field');
  }
  return { subject, body };
}

function readTemplateFile(
  kind: TemplateKind,
  clientId: string,
  repoRoot: string,
  readFile?: (relativePath: string) => string | null,
): string {
  const candidates = resolveTemplatePath(clientId, kind);
  for (const candidate of candidates) {
    if (readFile !== undefined) {
      const content = readFile(candidate);
      if (content !== null) return content;
      continue;
    }
    const absolute = path.resolve(repoRoot, candidate);
    if (fs.existsSync(absolute)) {
      return fs.readFileSync(absolute, 'utf8');
    }
  }
  throw new TemplateMissing(kind, clientId, candidates);
}

export function renderTemplate(input: RenderTemplateInput): TemplateResult {
  const { kind, context, repoRoot = DEFAULT_REPO_ROOT, readFile } = input;
  const parsed = TemplateContextSchema.safeParse(context);
  if (!parsed.success) {
    throw new TemplateContextInvalid(
      parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  const recipients = resolveRecipients(kind, context.client);
  const raw = readTemplateFile(kind, context.client.id, repoRoot, readFile);
  const { subject, body } = parseFrontmatter(raw);
  return {
    subject: interpolate(subject, context),
    body: interpolate(body, context),
    recipients: {
      to: [...recipients.to],
      cc: [...recipients.cc],
    },
  };
}
