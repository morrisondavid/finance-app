/**
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';
import { mutateStatementsUploadBase64 } from './statements-upload-base64.js';

const executeMock = vi.fn();

vi.mock('../../ingestion/statement-disk-upload-batch.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../ingestion/statement-disk-upload-batch.js')>();
  return {
    ...actual,
    executeStatementDiskUpload: (...args: unknown[]) => executeMock(...args),
  };
});

describe('mutateStatementsUploadBase64 staging paths', () => {
  beforeEach(() => {
    executeMock.mockReset();
    executeMock.mockResolvedValue({ status: 200, body: { message: 'ok' } });
  });

  it('materialises decoded PDFs under statements/<account>/pdf/, not /tmp', async () => {
    const tinyPdf = Buffer.from('%PDF-1.4', 'utf8').toString('base64');
    await mutateStatementsUploadBase64({
      account: 'capital-on-tap',
      type: 'pdf',
      files: [{ filename: 'Statement-test.pdf', base64: tinyPdf }],
    });

    expect(executeMock).toHaveBeenCalledOnce();
    const opts = executeMock.mock.calls[0]?.[0] as {
      files: { path: string; originalname: string }[];
    };
    const filePath = opts.files[0]?.path ?? '';
    expect(filePath).toContain(`${path.sep}statements${path.sep}capital-on-tap${path.sep}pdf${path.sep}`);
    expect(filePath).not.toContain('/tmp/');
    expect(filePath).not.toContain('bank-stmt-upload-');
  });
});
