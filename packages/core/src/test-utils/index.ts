/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export * from './mock-tool.js';
// Note: mock-message-bus.js is NOT exported here because it imports vitest
// which fails at runtime. Import it directly in test files:
// import { createMockMessageBus } from '@google/gemini-cli-core/src/test-utils/mock-message-bus.js';
