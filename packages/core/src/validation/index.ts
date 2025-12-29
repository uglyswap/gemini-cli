/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// Export from diff-validator
export {
  DiffValidator,
  createDiffValidator,
  type DiffValidationResult,
  type FileValidationResult,
  type ValidationIssue,
  type FileMetrics,
  type DiffValidatorConfig,
} from './diff-validator.js';

// Export from validation-pipeline (without ValidationIssue to avoid conflict)
export {
  ValidationPipeline,
  createValidationPipeline,
  quickValidate,
  type PipelineResult,
  type PipelineIssue,
  type PipelineConfig,
  type ValidationStepResult,
} from './validation-pipeline.js';
