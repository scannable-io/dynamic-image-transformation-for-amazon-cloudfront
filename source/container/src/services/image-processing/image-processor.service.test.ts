// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { ImageProcessorService } from './image-processor.service';
import { ImageProcessingRequest } from '../../types/image-processing-request';
import { EditApplicator } from './transformation-engine/edit-applicator';
import { ErrorMapper } from './utils/error-mapping';
import { ImageProcessingError } from './types';
import sharp from 'sharp';

let TEST_JPEG_BUFFER: Buffer;
let TEST_GIF_BUFFER: Buffer;

beforeAll(async () => {
  // Generate valid test images using Sharp
  TEST_JPEG_BUFFER = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 255, g: 0, b: 0 } }
  }).jpeg().toBuffer();
  
  TEST_GIF_BUFFER = await sharp({
    create: { width: 100, height: 100, channels: 3, background: { r: 0, g: 0, b: 255 } }
  }).gif().toBuffer();
});

describe('ImageProcessorService', () => {
  let service: ImageProcessorService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = ImageProcessorService.getInstance();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = ImageProcessorService.getInstance();
      const instance2 = ImageProcessorService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('process', () => {
    it('should throw error for missing origin URL', async () => {
      const request: ImageProcessingRequest = {
        requestId: 'test-123',
        timestamp: Date.now(),
        origin: { url: '' },
        transformations: [],
        response: { headers: {} }
      };

      await expect(service.process(request)).rejects.toThrow();
    });

    it('should handle empty transformations array', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: mockBuffer,
        metadata: { size: mockBuffer.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-123',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [],
        response: { headers: {} }
      };

      const result = await service.process(request);
      expect(result).toBe(mockBuffer);
    });
  });

  describe('overlay size calculation', () => {
    it('should calculate percentage-based overlay size', () => {
      const result = EditApplicator.calcOverlaySizeOption('50p', 1000, 100);
      expect(result).toBe(500);
    });

    it('should calculate absolute overlay size', () => {
      const result = EditApplicator.calcOverlaySizeOption('200', 1000, 100);
      expect(result).toBe(200);
    });

    it('should handle negative values', () => {
      const result = EditApplicator.calcOverlaySizeOption('-50', 1000, 100);
      expect(result).toBe(850); // 1000 + (-50) - 100
    });

    it('should handle numeric input', () => {
      const result = EditApplicator.calcOverlaySizeOption(150, 1000, 100);
      expect(result).toBe(150);
    });

    it('should handle negative percentage values', () => {
      const result = EditApplicator.calcOverlaySizeOption('-25p', 1000, 100);
      expect(result).toBe(650); // floor(1000 + (1000 * -25) / 100) - 100 = 750 - 100
    });
  });

  describe('process request initialization', () => {
    it('should initialize timings object if missing', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: mockBuffer,
        metadata: { size: mockBuffer.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-123',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [],
        response: { headers: {} }
      };

      await service.process(request);
      expect(request.timings).toBeDefined();
      expect(request.timings.imageProcessing).toBeDefined();
    });

    it('should set sourceImageContentType on response for no-transform case', async () => {
      const mockBuffer = Buffer.from('fake-image-data');
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: mockBuffer,
        metadata: { size: mockBuffer.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-123',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [],
        sourceImageContentType: 'image/jpeg',
        response: { headers: {} }
      };

      await service.process(request);
      expect(request.response.contentType).toBe('image/jpeg');
    });
  });

  describe('full transformation pipeline', () => {
    it('should process image with transformations and set contentType from output', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_JPEG_BUFFER,
        metadata: { size: TEST_JPEG_BUFFER.length, format: 'jpeg' }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-pipeline',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [{ type: 'resize', value: { width: 1 }, source: 'url' }],
        response: { headers: {} }
      };

      const result = await service.process(request);
      
      expect(result).toBeInstanceOf(Buffer);
      expect(request.response.contentType).toMatch(/^image\//);
      expect(request.timings.imageProcessing.transformationApplicationMs).toBeGreaterThanOrEqual(0);
    });
  });

  describe('preventAutoUpscaling', () => {
    it('should filter out auto-resize transforms that would upscale', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_JPEG_BUFFER,
        metadata: { size: TEST_JPEG_BUFFER.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-upscale',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [
          { type: 'resize', value: { width: 5000 }, source: 'auto' }, // Should be filtered (upscale)
          { type: 'negate', value: true, source: 'url' } // Should remain
        ],
        response: { headers: {} }
      };

      await service.process(request);
      
      expect(request.transformations).toHaveLength(1);
      expect(request.transformations[0].type).toBe('negate');
    });

    it('should keep auto-resize transforms that do not upscale', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_JPEG_BUFFER,
        metadata: { size: TEST_JPEG_BUFFER.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-no-upscale',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [
          { type: 'resize', value: { width: 1 }, source: 'auto' } // 1x1 image, width=1 is not upscaling
        ],
        response: { headers: {} }
      };

      await service.process(request);
      
      expect(request.transformations).toHaveLength(1);
    });

    it('should not filter non-auto resize transforms', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_JPEG_BUFFER,
        metadata: { size: TEST_JPEG_BUFFER.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-url-resize',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [
          { type: 'resize', value: { width: 5000 }, source: 'url' } // URL source, should not be filtered
        ],
        response: { headers: {} }
      };

      await service.process(request);
      
      expect(request.transformations).toHaveLength(1);
    });
  });

  describe('instantiateSharpImage', () => {
    it('should apply stripExif when specified', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_JPEG_BUFFER,
        metadata: { size: TEST_JPEG_BUFFER.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-strip-exif',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [{ type: 'stripExif', value: true, source: 'url' }],
        response: { headers: {} }
      };

      const result = await service.process(request);
      expect(result).toBeInstanceOf(Buffer);
    });

    it('should apply stripIcc when specified', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_JPEG_BUFFER,
        metadata: { size: TEST_JPEG_BUFFER.length }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-strip-icc',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [{ type: 'stripIcc', value: true, source: 'url' }],
        response: { headers: {} }
      };

      const result = await service.process(request);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

  describe('error handling', () => {
    it('should wrap errors via ErrorMapper', async () => {
      const originalError = new Error('Fetch failed');
      jest.spyOn(service['originFetcher'], 'fetchImage').mockRejectedValue(originalError);
      jest.spyOn(ErrorMapper, 'mapError');

      const request: ImageProcessingRequest = {
        requestId: 'test-error',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [],
        response: { headers: {} }
      };

      await expect(service.process(request)).rejects.toThrow();
      expect(ErrorMapper.mapError).toHaveBeenCalledWith(originalError);
    });

    it('should pass through ImageProcessingError unchanged', async () => {
      const processingError = new ImageProcessingError(404, 'NotFound', 'Image not found');
      jest.spyOn(service['originFetcher'], 'fetchImage').mockRejectedValue(processingError);

      const request: ImageProcessingRequest = {
        requestId: 'test-processing-error',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.jpg' },
        transformations: [],
        response: { headers: {} }
      };

      await expect(service.process(request)).rejects.toThrow(processingError);
    });
  });

  describe('animated GIF handling', () => {
    it('should re-instantiate with animated=false for single-frame GIF', async () => {
      jest.spyOn(service['originFetcher'], 'fetchImage').mockResolvedValue({
        buffer: TEST_GIF_BUFFER,
        metadata: { size: TEST_GIF_BUFFER.length, format: 'gif' }
      });

      const request: ImageProcessingRequest = {
        requestId: 'test-single-frame-gif',
        timestamp: Date.now(),
        origin: { url: 'https://example.com/image.gif' },
        sourceImageContentType: 'image/gif',
        transformations: [{ type: 'resize', value: { width: 50 }, source: 'url' }],
        response: { headers: {} }
      };

      const result = await service.process(request);
      expect(result).toBeInstanceOf(Buffer);
    });
  });

});