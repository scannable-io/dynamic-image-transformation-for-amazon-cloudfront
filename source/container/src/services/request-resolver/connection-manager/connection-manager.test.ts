// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ConnectionManager } from './connection-manager';
import { S3Client } from '@aws-sdk/client-s3';
import { ImageProcessingRequest } from '../../../types/image-processing-request';
import { UrlValidator } from '../../../utils/url-validator';
import { S3UrlHelper } from '../../../utils/s3-url-helper';

jest.mock('@aws-sdk/client-s3');
jest.mock('../../../utils/get-options', () => ({ getOptions: () => ({}) }));
jest.mock('../../../utils/url-validator');
jest.mock('../../../utils/s3-url-helper');

const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('ConnectionManager', () => {
  let connectionManager: ConnectionManager;
  let mockImageRequest: ImageProcessingRequest;
  let mockS3Send: jest.Mock;

  beforeEach(() => {
    mockS3Send = jest.fn();
    (S3Client as jest.Mock).mockImplementation(() => ({ send: mockS3Send }));
    connectionManager = new ConnectionManager();
    mockImageRequest = {} as ImageProcessingRequest;
    jest.clearAllMocks();
  });

  describe('validateOriginUrl', () => {
    beforeEach(() => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(false);
      (UrlValidator.validate as jest.Mock).mockImplementation(() => {});
    });

    it('should validate valid HTTPS URL', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' })
      });

      await connectionManager.validateOriginUrl('https://example.com/image.jpg', mockImageRequest);
      
      expect(UrlValidator.validate).toHaveBeenCalledWith('https://example.com/image.jpg');
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg', {
        method: 'HEAD',
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: {}
      });
    });

    it('should populate sourceImageContentType in imageRequest', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/png' })
      });

      await connectionManager.validateOriginUrl('https://example.com/image.png', mockImageRequest);
      expect(mockImageRequest.sourceImageContentType).toBe('image/png');
    });

    it('should reject unsupported protocol with UNSUPPORTED_PROTOCOL error code', async () => {
      (UrlValidator.validate as jest.Mock).mockImplementation(() => {
        throw new Error('Unsupported protocol');
      });

      await expect(connectionManager.validateOriginUrl('ftp://example.com/image.jpg', mockImageRequest))
        .rejects.toMatchObject({
          title: 'URL validation failed',
          errorType: 'UNSUPPORTED_PROTOCOL',
          statusCode: 400
        });
    });

    it('should reject non-image content types', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' })
      });

      await expect(connectionManager.validateOriginUrl('https://example.com/file', mockImageRequest))
        .rejects.toMatchObject({
          title: 'Invalid content type',
          errorType: 'INVALID_FORMAT',
          statusCode: 400
        });
    });

    it('should accept image content type with charset', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg; charset=utf-8' })
      });

      await connectionManager.validateOriginUrl('https://example.com/image.jpg', mockImageRequest);
      expect(mockImageRequest.sourceImageContentType).toBe('image/jpeg; charset=utf-8');
    });

    it('should pass clientHeaders to fetch', async () => {
      mockImageRequest.clientHeaders = { 'User-Agent': 'test-agent' };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' })
      });

      await connectionManager.validateOriginUrl('https://example.com/image.jpg', mockImageRequest);
      
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/image.jpg', {
        method: 'HEAD',
        redirect: 'error',
        signal: expect.any(AbortSignal),
        headers: { 'User-Agent': 'test-agent' }
      });
    });

    it('should validate S3 URLs with client headers', async () => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(true);
      (S3UrlHelper.parseS3Url as jest.Mock).mockReturnValue({ bucket: 'test-bucket', key: 'test-key.jpg' });

      mockS3Send.mockResolvedValue({ ContentType: 'image/jpeg' });

      await connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/key.jpg', mockImageRequest);
      
      expect(S3UrlHelper.parseS3Url).toHaveBeenCalledWith('https://bucket.s3.amazonaws.com/key.jpg');
      expect(mockS3Send).toHaveBeenCalled();
      expect(mockImageRequest.sourceImageContentType).toBe('image/jpeg');
    });

    it('should handle invalid S3 URL format', async () => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(true);
      (S3UrlHelper.parseS3Url as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid S3 URL format');
      });

      await expect(connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/invalid', mockImageRequest))
        .rejects.toMatchObject({
          title: 'Invalid S3 URL format',
          errorType: 'INVALID_URL',
          statusCode: 400
        });
    });

    it('should reject with INVALID_URL for non-protocol URL errors', async () => {
      (UrlValidator.validate as jest.Mock).mockImplementation(() => {
        throw new Error('Invalid URL format');
      });

      await expect(connectionManager.validateOriginUrl('not-a-url', mockImageRequest))
        .rejects.toMatchObject({
          title: 'URL validation failed',
          errorType: 'INVALID_URL',
          statusCode: 400
        });
    });

    it('should store preflight timing when timings object exists', async () => {
      mockImageRequest.timings = { requestResolution: {} } as any;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'image/jpeg' })
      });

      await connectionManager.validateOriginUrl('https://example.com/image.jpg', mockImageRequest);
      
      expect(mockImageRequest.timings?.requestResolution?.preflightValidationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('S3 error handling', () => {
    beforeEach(() => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(true);
      (S3UrlHelper.parseS3Url as jest.Mock).mockReturnValue({ bucket: 'bucket', key: 'key.jpg' });
      (UrlValidator.validate as jest.Mock).mockImplementation(() => {});
    });

    it('should handle S3 404 Not Found', async () => {
      mockS3Send.mockRejectedValue({ $metadata: { httpStatusCode: 404 } });

      await expect(connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/key.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'RESOURCE_NOT_FOUND', statusCode: 404 });
    });

    it('should handle S3 403 Access Denied', async () => {
      mockS3Send.mockRejectedValue({ $metadata: { httpStatusCode: 403 } });

      await expect(connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/key.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'ACCESS_DENIED', statusCode: 403 });
    });

    it('should handle generic S3 error as BAD_GATEWAY', async () => {
      mockS3Send.mockRejectedValue(new Error('Unknown S3 error'));

      await expect(connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/key.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'BAD_GATEWAY', statusCode: 502 });
    });

    it('should map x-amz-* and if-* headers to S3 command', async () => {
      mockImageRequest.clientHeaders = { 'x-amz-request-payer': 'requester', 'if-match': 'etag123', 'user-agent': 'test' };
      (S3UrlHelper.mapHeaderToS3Property as jest.Mock).mockImplementation((h) => h === 'x-amz-request-payer' ? 'RequestPayer' : 'IfMatch');
      mockS3Send.mockResolvedValue({ ContentType: 'image/jpeg' });

      await connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/key.jpg', mockImageRequest);
      
      expect(S3UrlHelper.mapHeaderToS3Property).toHaveBeenCalledWith('x-amz-request-payer');
      expect(S3UrlHelper.mapHeaderToS3Property).toHaveBeenCalledWith('if-match');
    });
  });

  describe('HTTP error handling', () => {
    beforeEach(() => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(false);
      (UrlValidator.validate as jest.Mock).mockImplementation(() => {});
    });

    it('should handle HTTP 404 Not Found', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      await expect(connectionManager.validateOriginUrl('https://example.com/missing.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'RESOURCE_NOT_FOUND', statusCode: 404 });
    });

    it('should handle HTTP 403 Access Denied', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 403 });

      await expect(connectionManager.validateOriginUrl('https://example.com/forbidden.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'ACCESS_DENIED', statusCode: 403 });
    });

    it('should handle HTTP 5xx as BAD_GATEWAY', async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 503 });

      await expect(connectionManager.validateOriginUrl('https://example.com/error.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'BAD_GATEWAY', statusCode: 502 });
    });

    it('should handle AbortError as REQUEST_TIMEOUT', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValue(abortError);

      await expect(connectionManager.validateOriginUrl('https://example.com/slow.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'REQUEST_TIMEOUT', statusCode: 408 });
    });

    it('should handle ENOTFOUND as HOST_NOT_FOUND', async () => {
      const error = new Error('fetch failed');
      (error as any).cause = { code: 'ENOTFOUND' };
      mockFetch.mockRejectedValue(error);

      await expect(connectionManager.validateOriginUrl('https://nonexistent.com/image.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'HOST_NOT_FOUND', statusCode: 404 });
    });

    it('should handle TLS certificate errors as ACCESS_DENIED', async () => {
      const error = new Error('certificate error');
      (error as any).cause = { code: 'CERT_HAS_EXPIRED' };
      mockFetch.mockRejectedValue(error);

      await expect(connectionManager.validateOriginUrl('https://badcert.com/image.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'ACCESS_DENIED', statusCode: 403 });
    });

    it('should handle generic fetch error as BAD_GATEWAY', async () => {
      mockFetch.mockRejectedValue(new Error('Unknown error'));

      await expect(connectionManager.validateOriginUrl('https://example.com/image.jpg', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'BAD_GATEWAY', statusCode: 502 });
    });
  });

  describe('Content-Type validation', () => {
    beforeEach(() => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(false);
      (UrlValidator.validate as jest.Mock).mockImplementation(() => {});
    });

    it('should reject missing content-type', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({})
      });

      await expect(connectionManager.validateOriginUrl('https://example.com/file', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'INVALID_FORMAT', statusCode: 400 });
    });

    it('should reject undefined content-type from S3', async () => {
      (S3UrlHelper.isS3Url as jest.Mock).mockReturnValue(true);
      (S3UrlHelper.parseS3Url as jest.Mock).mockReturnValue({ bucket: 'bucket', key: 'key' });
      mockS3Send.mockResolvedValue({ ContentType: undefined });

      await expect(connectionManager.validateOriginUrl('https://bucket.s3.amazonaws.com/key', mockImageRequest))
        .rejects.toMatchObject({ errorType: 'INVALID_FORMAT', statusCode: 400 });
    });
  });
});
