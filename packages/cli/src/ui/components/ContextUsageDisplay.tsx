/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { theme } from '../semantic-colors.js';
import { tokenLimit } from '@google/gemini-cli-core';

const PROGRESS_BAR_WIDTH = 20;
const FILLED_CHAR = '█';
const EMPTY_CHAR = '░';

export const ContextUsageDisplay = ({
  promptTokenCount,
  model,
  terminalWidth,
}: {
  promptTokenCount: number;
  model: string;
  terminalWidth: number;
}) => {
  const limit = tokenLimit(model);
  const percentage = Math.min(promptTokenCount / limit, 1); // Cap at 100%
  const percentageUsed = (percentage * 100).toFixed(0);

  // Determine color based on usage level
  const getColor = (pct: number): string => {
    if (pct < 0.5) return theme.status.success; // Green: < 50%
    if (pct < 0.75) return theme.status.warning; // Yellow: 50-75%
    return theme.status.error; // Red: > 75%
  };

  const color = getColor(percentage);

  // Calculate filled and empty portions
  const filledWidth = Math.round(percentage * PROGRESS_BAR_WIDTH);
  const emptyWidth = PROGRESS_BAR_WIDTH - filledWidth;

  const filledBar = FILLED_CHAR.repeat(filledWidth);
  const emptyBar = EMPTY_CHAR.repeat(emptyWidth);

  // Compact mode for narrow terminals
  if (terminalWidth < 80) {
    return <Text color={color}>{percentageUsed}%</Text>;
  }

  // Standard mode with progress bar
  return (
    <Box flexDirection="row" alignItems="center">
      <Text color={theme.text.secondary}>[</Text>
      <Text color={color}>{filledBar}</Text>
      <Text color={theme.ui.dark}>{emptyBar}</Text>
      <Text color={theme.text.secondary}>] </Text>
      <Text color={color}>{percentageUsed}%</Text>
    </Box>
  );
};
