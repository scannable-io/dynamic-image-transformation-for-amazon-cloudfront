// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { queryTypesMiddleware } from './query-types';

describe('queryTypesMiddleware', () => {
  const createMockReq = (url: string) => ({ url, query: {} as Record<string, any> });
  const mockRes = {};
  const mockNext = jest.fn();

  beforeEach(() => {
    mockNext.mockClear();
  });

  describe('middleware behavior', () => {
    it('Should call next() after parsing', () => {
      const req = createMockReq('/path?foo=bar');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(mockNext).toHaveBeenCalledTimes(1);
    });

    it('Should handle empty query string', () => {
      const req = createMockReq('/path');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({});
    });

    it('Should handle URL without query params', () => {
      const req = createMockReq('/path/to/image.jpg');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({});
    });
  });

  describe('type parsing via parseObject', () => {
    it('Should parse string values unchanged', () => {
      const req = createMockReq('/path?name=hello');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ name: 'hello' });
    });

    it('Should parse numeric strings to numbers', () => {
      const req = createMockReq('/path?width=100&height=200');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ width: 100, height: 200 });
    });

    it('Should parse float values', () => {
      const req = createMockReq('/path?ratio=1.5');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ ratio: 1.5 });
    });

    it('Should parse boolean true', () => {
      const req = createMockReq('/path?enabled=true');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ enabled: true });
    });

    it('Should parse boolean false', () => {
      const req = createMockReq('/path?enabled=false');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ enabled: false });
    });

    it('Should parse empty value as null', () => {
      const req = createMockReq('/path?empty=');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ empty: null });
    });

    it('Should parse mixed types', () => {
      const req = createMockReq('/path?str=hello&num=42&bool=true');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ str: 'hello', num: 42, bool: true });
    });
  });

  describe('array parsing', () => {
    it('Should parse comma-separated values as array', () => {
      const req = createMockReq('/path?items=a,b,c');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ items: ['a', 'b', 'c'] });
    });

    it('Should parse qs-style arrays', () => {
      const req = createMockReq('/path?items[0]=a&items[1]=b');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ items: ['a', 'b'] });
    });

    it('Should parse qs-style arrays with numeric values', () => {
      const req = createMockReq('/path?items[0]=1&items[1]=2&items[2]=3');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ items: [1, 2, 3] });
    });
  });

  describe('nested object parsing', () => {
    it('Should parse nested objects', () => {
      const req = createMockReq('/path?resize[width]=100&resize[height]=200');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ resize: { width: 100, height: 200 } });
    });

    it('Should parse deeply nested objects up to depth limit', () => {
      const req = createMockReq('/path?a[b][c]=value');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ a: { b: { c: 'value' } } });
    });
  });

  describe('edge cases', () => {
    it('Should handle special characters in values', () => {
      const req = createMockReq('/path?path=/images/test.jpg');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query.path).toBe('/images/test.jpg');
    });

    it('Should handle encoded special characters', () => {
      const req = createMockReq('/path?name=hello%20world');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query.name).toBe('hello world');
    });

    it('Should handle string with only comma', () => {
      const req = createMockReq('/path?val=a,b');
      queryTypesMiddleware()(req, mockRes, mockNext);
      expect(req.query).toEqual({ val: ['a', 'b'] });
    });
  });
});
