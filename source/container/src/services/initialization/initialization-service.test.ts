// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0

import { InitializationService } from './initialization-service';
import { InitializationState } from './types';
import { CacheRegistry } from '../cache/cache-registry';

// Mock all cache classes
jest.mock('../cache/domain/policy-cache', () => ({
  PolicyCache: jest.fn().mockImplementation(() => ({ warmCache: jest.fn().mockResolvedValue(undefined) }))
}));
jest.mock('../cache/domain/origin-cache', () => ({
  OriginCache: jest.fn().mockImplementation(() => ({ warmCache: jest.fn().mockResolvedValue(undefined) }))
}));
jest.mock('../cache/domain/path-mapping-cache', () => ({
  PathMappingCache: jest.fn().mockImplementation(() => ({ warmCache: jest.fn().mockResolvedValue(undefined) }))
}));
jest.mock('../cache/domain/header-mapping-cache', () => ({
  HeaderMappingCache: jest.fn().mockImplementation(() => ({ warmCache: jest.fn().mockResolvedValue(undefined) }))
}));

// Mock CacheRegistry
const mockRegister = jest.fn();
jest.mock('../cache/cache-registry', () => ({
  CacheRegistry: {
    getInstance: jest.fn(() => ({ register: mockRegister }))
  }
}));

describe('InitializationService', () => {
  let state: InitializationState;
  let processExitSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    
    state = {
      status: 'UNKNOWN',
      completedCaches: [],
      startTime: new Date()
    };

    // Mock process.exit to prevent test termination
    processExitSpy = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    processExitSpy.mockRestore();
  });

  describe('initialize', () => {
    it('Should successfully initialize all caches and set state to HEALTHY', async () => {
      // Act
      const initPromise = InitializationService.initialize(state);
      await jest.runAllTimersAsync();
      await initPromise;

      // Assert
      expect(state.status).toBe('HEALTHY');
      expect(state.completedCaches).toEqual([
        'Policy Cache',
        'Origin Cache',
        'Path Mapping Cache',
        'Header Mapping Cache'
      ]);
      expect(state.completionTime).toBeDefined();
      expect(state.currentStep).toBeUndefined();
      expect(mockRegister).toHaveBeenCalledTimes(4);
    });

    it('Should set state to UNHEALTHY and exit when cache initialization fails after retries', async () => {
      // Arrange
      const { PolicyCache } = require('../cache/domain/policy-cache');
      PolicyCache.mockImplementation(() => ({
        warmCache: jest.fn().mockRejectedValue(new Error('Connection failed'))
      }));

      // Act
      const initPromise = InitializationService.initialize(state);
      await jest.runAllTimersAsync();
      await initPromise;

      // Assert
      expect(state.status).toBe('UNHEALTHY');
      expect(state.error).toBeDefined();
      expect(state.error?.message).toContain('Failed to initialize Policy Cache after 3 attempts');
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('Should succeed after retry when cache fails initially then succeeds', async () => {
      // Arrange
      const { PolicyCache } = require('../cache/domain/policy-cache');
      const warmCacheMock = jest.fn()
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(undefined);
      PolicyCache.mockImplementation(() => ({ warmCache: warmCacheMock }));

      // Act
      const initPromise = InitializationService.initialize(state);
      await jest.runAllTimersAsync();
      await initPromise;

      // Assert
      expect(state.status).toBe('HEALTHY');
      expect(warmCacheMock).toHaveBeenCalledTimes(2);
      expect(state.completedCaches).toContain('Policy Cache');
    });

    it('Should update currentStep during initialization', async () => {
      // Arrange
      const steps: string[] = [];
      const originalState = state;
      
      const { PolicyCache } = require('../cache/domain/policy-cache');
      PolicyCache.mockImplementation(() => ({
        warmCache: jest.fn().mockImplementation(async () => {
          steps.push(originalState.currentStep || '');
        })
      }));

      // Act
      const initPromise = InitializationService.initialize(state);
      await jest.runAllTimersAsync();
      await initPromise;

      // Assert
      expect(steps[0]).toBe('Initializing Policy Cache');
    });

    it('Should apply correct retry delays', async () => {
      // Arrange
      const { PolicyCache } = require('../cache/domain/policy-cache');
      PolicyCache.mockImplementation(() => ({
        warmCache: jest.fn().mockRejectedValue(new Error('Always fails'))
      }));

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

      // Act
      const initPromise = InitializationService.initialize(state);
      await jest.runAllTimersAsync();
      await initPromise;

      // Assert - verify retry delays (1000ms, 2000ms)
      const delays = setTimeoutSpy.mock.calls.map(call => call[1]);
      expect(delays).toContain(1000);
      expect(delays).toContain(2000);
    });
  });
});
