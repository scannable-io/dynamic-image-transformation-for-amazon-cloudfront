// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { EditApplicator } from './edit-applicator';
import { ImageEdits } from '../interfaces';
import { ImageFitTypes } from '../enums';
import { ImageProcessingError } from '../types';
import { SharpUtils } from '../utils/sharp-utils';

jest.mock('../utils/sharp-utils');

const createMockSharp = (metadata = { width: 800, height: 600, format: 'jpeg', pages: 1 }) => {
  const mock: any = {
    metadata: jest.fn().mockResolvedValue(metadata),
    resize: jest.fn().mockReturnThis(),
    rotate: jest.fn().mockReturnThis(),
    sharpen: jest.fn().mockReturnThis(),
    toFormat: jest.fn().mockReturnThis(),
    flip: jest.fn().mockReturnThis(),
    flop: jest.fn().mockReturnThis(),
    grayscale: jest.fn().mockReturnThis(),
    extract: jest.fn().mockReturnThis(),
  };
  return mock;
};

const mockOriginFetcher = { fetchImage: jest.fn() };

describe('EditApplicator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SharpUtils.shouldSkipForAnimation as jest.Mock).mockReturnValue(false);
    (SharpUtils.isAllowedTransformation as jest.Mock).mockReturnValue(true);
  });

  describe('applyEdits', () => {
    it('Should apply basic edits via default case', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { flip: true };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.flip).toHaveBeenCalledWith(true);
    });

    it('Should handle rotate with numeric value', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { rotate: 90 };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.rotate).toHaveBeenCalledWith(90);
    });

    it('Should handle rotate with null string value', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { rotate: 'null' };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.rotate).toHaveBeenCalledWith(null);
    });

    it('Should skip operations for animations when appropriate', async () => {
      const mockImage = createMockSharp({ width: 800, height: 600, format: 'gif', pages: 5 });
      (SharpUtils.shouldSkipForAnimation as jest.Mock).mockReturnValue(true);
      const edits: ImageEdits = { flip: true };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.flip).not.toHaveBeenCalled();
    });

    it('Should defer resize when extract present', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { resize: { width: 100 }, extract: { left: 0, top: 0, width: 50, height: 50 } };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      // Resize should be called once at the end (deferred)
      expect(mockImage.resize).toHaveBeenCalledTimes(1);
      expect(mockImage.resize).toHaveBeenCalledWith(edits.resize);
    });

    it('Should wrap non-ImageProcessingError in ImageProcessingError', async () => {
      const mockImage = createMockSharp();
      mockImage.metadata.mockRejectedValue(new Error('Sharp failed'));

      await expect(EditApplicator.applyEdits(mockImage, {}, mockOriginFetcher as any))
        .rejects.toThrow(ImageProcessingError);
    });

    it('Should rethrow ImageProcessingError as-is', async () => {
      const mockImage = createMockSharp();
      const originalError = new ImageProcessingError(400, 'TestError', 'Test message');
      mockImage.metadata.mockRejectedValue(originalError);

      await expect(EditApplicator.applyEdits(mockImage, {}, mockOriginFetcher as any))
        .rejects.toBe(originalError);
    });
  });

  describe('applyResize (via applyEdits)', () => {
    it('Should set default fit=INSIDE when resize undefined', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = {};

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(edits.resize).toEqual({ fit: ImageFitTypes.INSIDE });
    });

    it('Should apply resize with explicit width/height', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { resize: { width: 200, height: 150 } };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.resize).toHaveBeenCalledWith({ width: 200, height: 150 });
    });

    it('Should calculate dimensions from ratio using provided width/height', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { resize: { width: 100, height: 100, ratio: 0.5 } };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(edits.resize.width).toBe(50);
      expect(edits.resize.height).toBe(50);
      expect(edits.resize.ratio).toBeUndefined();
    });

    it('Should calculate dimensions from ratio using image metadata', async () => {
      const mockImage = createMockSharp({ width: 800, height: 600, format: 'jpeg', pages: 1 });
      const edits: ImageEdits = { resize: { ratio: 0.5 } };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(edits.resize.width).toBe(400);
      expect(edits.resize.height).toBe(300);
      expect(edits.resize.fit).toBe(ImageFitTypes.INSIDE);
    });
  });

  describe('applySharpen (via applyEdits)', () => {
    it('Should call sharpen with undefined when value is true', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { sharpen: true };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.sharpen).toHaveBeenCalledWith(undefined);
    });

    it('Should call sharpen with explicit params when object provided', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { sharpen: { sigma: 2, m1: 0.5 } };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.sharpen).toHaveBeenCalledWith({ sigma: 2, m1: 0.5 });
    });
  });

  describe('applyFormat (via applyEdits)', () => {
    it('Should use toFormat from edits when provided', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { toFormat: 'png' };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.toFormat).toHaveBeenCalledWith('png', {});
    });

    it('Should fallback to metadata format when toFormat not provided', async () => {
      const mockImage = createMockSharp({ width: 800, height: 600, format: 'webp', pages: 1 });
      const edits: ImageEdits = {};

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.toFormat).toHaveBeenCalledWith('webp', {});
    });

    it('Should apply quality option when provided', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { toFormat: 'jpeg', quality: 80 };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.toFormat).toHaveBeenCalledWith('jpeg', { quality: 80 });
    });

    it('Should add compression=av1 for heif format', async () => {
      const mockImage = createMockSharp();
      const edits: ImageEdits = { toFormat: 'heif' };

      await EditApplicator.applyEdits(mockImage, edits, mockOriginFetcher as any);

      expect(mockImage.toFormat).toHaveBeenCalledWith('heif', { compression: 'av1' });
    });
  });

  describe('calcOverlaySizeOption', () => {
    it('Should calculate percentage-based position (positive)', () => {
      const result = EditApplicator.calcOverlaySizeOption('50p', 1000, 100);
      expect(result).toBe(500);
    });

    it('Should calculate percentage-based position (negative)', () => {
      const result = EditApplicator.calcOverlaySizeOption('-10p', 1000, 100);
      expect(result).toBe(800); // floor(1000 + (1000 * -10) / 100) - 100 = 900 - 100
    });

    it('Should calculate absolute position (positive)', () => {
      const result = EditApplicator.calcOverlaySizeOption(200, 1000, 100);
      expect(result).toBe(200);
    });

    it('Should calculate absolute position (negative)', () => {
      const result = EditApplicator.calcOverlaySizeOption(-50, 1000, 100);
      expect(result).toBe(850); // 1000 + (-50) - 100
    });
  });

  describe('getCropArea', () => {
    const getCropArea = (EditApplicator as any).getCropArea.bind(EditApplicator);

    it('Should calculate crop area from bounding box', () => {
      const boundingBox = { left: 0.25, top: 0.25, width: 0.5, height: 0.5 };
      const boxSize = { width: 400, height: 400 };

      const result = getCropArea(boundingBox, 0, boxSize);

      expect(result).toEqual({ left: 100, top: 100, width: 200, height: 200 });
    });

    it('Should clamp values to image boundaries', () => {
      const boundingBox = { left: -0.1, top: -0.1, width: 1.2, height: 1.2 };
      const boxSize = { width: 100, height: 100 };

      const result = getCropArea(boundingBox, 0, boxSize);

      expect(result.left).toBe(0);
      expect(result.top).toBe(0);
      expect(result.width).toBeLessThanOrEqual(100);
      expect(result.height).toBeLessThanOrEqual(100);
    });

    it('Should apply padding correctly', () => {
      const boundingBox = { left: 0.25, top: 0.25, width: 0.5, height: 0.5 };
      const boxSize = { width: 400, height: 400 };

      const result = getCropArea(boundingBox, 10, boxSize);

      expect(result.left).toBe(90);
      expect(result.top).toBe(90);
      expect(result.width).toBe(220);
      expect(result.height).toBe(220);
    });
  });

  describe('normalizeSource', () => {
    const normalizeSource = (EditApplicator as any).normalizeSource.bind(EditApplicator);

    it('Should strip http:// and add https://', () => {
      const result = normalizeSource('http://example.com/image.jpg');
      expect(result).toBe('https://example.com/image.jpg');
    });

    it('Should strip https:// and add https://', () => {
      const result = normalizeSource('https://example.com/image.jpg');
      expect(result).toBe('https://example.com/image.jpg');
    });

    it('Should handle source without protocol', () => {
      const result = normalizeSource('example.com/image.jpg');
      expect(result).toBe('https://example.com/image.jpg');
    });
  });
});
