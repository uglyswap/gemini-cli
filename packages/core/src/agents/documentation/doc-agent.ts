/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * DocAgent - Enhanced Documentation Generator
 *
 * Generates comprehensive documentation including:
 * 1. JSDoc/TSDoc comments
 * 2. README generation
 * 3. API documentation
 * 4. Architecture diagrams (Mermaid)
 * 5. Change logs
 * 6. Migration guides
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { TechContextDocument } from '../analyzer/analyzer-agent.js';

/**
 * Documentation types that can be generated
 */
export type DocType =
  | 'jsdoc'
  | 'readme'
  | 'api'
  | 'architecture'
  | 'changelog'
  | 'migration'
  | 'contributing'
  | 'usage';

/**
 * Generated documentation item
 */
export interface GeneratedDoc {
  /** Document type */
  type: DocType;
  /** File path (if file-based) */
  filePath?: string;
  /** Generated content */
  content: string;
  /** Related source files */
  sourceFiles: string[];
  /** Timestamp */
  generatedAt: Date;
}

/**
 * Function/method documentation
 */
export interface FunctionDoc {
  /** Function name */
  name: string;
  /** Description */
  description: string;
  /** Parameters */
  params: ParameterDoc[];
  /** Return type and description */
  returns?: {
    type: string;
    description: string;
  };
  /** Thrown exceptions */
  throws?: Array<{
    type: string;
    description: string;
  }>;
  /** Usage examples */
  examples: string[];
  /** Since version */
  since?: string;
  /** Deprecation info */
  deprecated?: string;
}

/**
 * Parameter documentation
 */
export interface ParameterDoc {
  /** Parameter name */
  name: string;
  /** Type */
  type: string;
  /** Description */
  description: string;
  /** Whether optional */
  optional: boolean;
  /** Default value */
  defaultValue?: string;
}

/**
 * API endpoint documentation
 */
export interface APIEndpointDoc {
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path */
  path: string;
  /** Description */
  description: string;
  /** Request body schema */
  requestBody?: SchemaDoc;
  /** Response schema */
  response?: SchemaDoc;
  /** Query parameters */
  queryParams?: ParameterDoc[];
  /** Path parameters */
  pathParams?: ParameterDoc[];
  /** Required headers */
  headers?: ParameterDoc[];
  /** Example request */
  exampleRequest?: string;
  /** Example response */
  exampleResponse?: string;
}

/**
 * Schema documentation (for API bodies)
 */
export interface SchemaDoc {
  /** Schema name */
  name: string;
  /** Type (object, array, string, etc.) */
  type: string;
  /** Properties for objects */
  properties?: Record<
    string,
    {
      type: string;
      description: string;
      required: boolean;
    }
  >;
  /** Example value */
  example?: unknown;
}

/**
 * Architecture component
 */
export interface ArchitectureComponent {
  /** Component name */
  name: string;
  /** Component type */
  type:
    | 'service'
    | 'controller'
    | 'repository'
    | 'util'
    | 'model'
    | 'view'
    | 'other';
  /** Description */
  description: string;
  /** Dependencies */
  dependencies: string[];
  /** File path */
  filePath: string;
}

/**
 * Changelog entry
 */
export interface ChangelogEntry {
  /** Version */
  version: string;
  /** Release date */
  date: Date;
  /** Changes by category */
  changes: {
    added: string[];
    changed: string[];
    deprecated: string[];
    removed: string[];
    fixed: string[];
    security: string[];
  };
}

/**
 * DocAgent configuration
 */
export interface DocAgentConfig {
  /** Project name */
  projectName: string;
  /** Output directory for generated docs */
  outputDir: string;
  /** Template style */
  style: 'minimal' | 'standard' | 'detailed';
  /** Include examples */
  includeExamples: boolean;
  /** Generate Mermaid diagrams */
  generateDiagrams: boolean;
  /** Languages for code examples */
  codeLanguages: string[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: DocAgentConfig = {
  projectName: 'Project',
  outputDir: './docs',
  style: 'standard',
  includeExamples: true,
  generateDiagrams: true,
  codeLanguages: ['typescript', 'javascript'],
};

/**
 * DocAgent class for enhanced documentation generation
 */
export class DocAgent {
  private readonly config: DocAgentConfig;

  constructor(config: Partial<DocAgentConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Generate comprehensive documentation for a project
   */
  async generateProjectDocs(
    projectRoot: string,
    techContext?: TechContextDocument,
  ): Promise<GeneratedDoc[]> {
    const docs: GeneratedDoc[] = [];

    // Generate README
    const readme = await this.generateReadme(projectRoot, techContext);
    docs.push(readme);

    // Generate CONTRIBUTING.md
    const contributing = this.generateContributing(projectRoot);
    docs.push(contributing);

    // Generate architecture diagram
    if (this.config.generateDiagrams) {
      const arch = await this.generateArchitectureDiagram(projectRoot);
      if (arch) docs.push(arch);
    }

    return docs;
  }

  /**
   * Generate README.md
   */
  async generateReadme(
    projectRoot: string,
    techContext?: TechContextDocument,
  ): Promise<GeneratedDoc> {
    const lines: string[] = [];

    // Title
    lines.push(`# ${this.config.projectName}`);
    lines.push('');

    // Badges (placeholder)
    lines.push(
      '[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)',
    );
    lines.push('');

    // Description
    lines.push('## Description');
    lines.push('');
    lines.push('<!-- Add your project description here -->');
    lines.push('');

    // Tech stack (if context available)
    if (techContext) {
      lines.push('## Tech Stack');
      lines.push('');
      for (const fw of techContext.frameworks) {
        lines.push(
          `- **${fw.name}**${fw.version ? ` (${fw.version})` : ''} - ${fw.category}`,
        );
      }
      lines.push('');
    }

    // Installation
    lines.push('## Installation');
    lines.push('');
    lines.push('```bash');
    lines.push('# Clone the repository');
    lines.push(
      `git clone https://github.com/username/${this.config.projectName.toLowerCase()}.git`,
    );
    lines.push('');
    lines.push('# Install dependencies');
    lines.push('npm install');
    lines.push('```');
    lines.push('');

    // Usage
    lines.push('## Usage');
    lines.push('');
    lines.push('```bash');
    lines.push('# Development');
    lines.push('npm run dev');
    lines.push('');
    lines.push('# Build');
    lines.push('npm run build');
    lines.push('');
    lines.push('# Test');
    lines.push('npm test');
    lines.push('```');
    lines.push('');

    // Project Structure
    if (techContext) {
      lines.push('## Project Structure');
      lines.push('');
      lines.push('```');
      for (const srcDir of techContext.structure.srcDirs) {
        lines.push(`${srcDir}/          # Source code`);
      }
      for (const testDir of techContext.structure.testDirs) {
        lines.push(`${testDir}/         # Tests`);
      }
      lines.push('```');
      lines.push('');
    }

    // Contributing
    lines.push('## Contributing');
    lines.push('');
    lines.push('See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.');
    lines.push('');

    // License
    lines.push('## License');
    lines.push('');
    lines.push(
      'This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.',
    );
    lines.push('');

    return {
      type: 'readme',
      filePath: path.join(projectRoot, 'README.md'),
      content: lines.join('\n'),
      sourceFiles: [],
      generatedAt: new Date(),
    };
  }

  /**
   * Generate CONTRIBUTING.md
   */
  generateContributing(projectRoot: string): GeneratedDoc {
    const lines: string[] = [];

    lines.push('# Contributing');
    lines.push('');
    lines.push('Thank you for your interest in contributing!');
    lines.push('');

    lines.push('## Getting Started');
    lines.push('');
    lines.push('1. Fork the repository');
    lines.push('2. Clone your fork');
    lines.push('3. Create a new branch for your feature');
    lines.push('4. Make your changes');
    lines.push('5. Submit a pull request');
    lines.push('');

    lines.push('## Development Setup');
    lines.push('');
    lines.push('```bash');
    lines.push('npm install');
    lines.push('npm run dev');
    lines.push('```');
    lines.push('');

    lines.push('## Code Style');
    lines.push('');
    lines.push('- Follow the existing code style');
    lines.push('- Use TypeScript for all new code');
    lines.push('- Write tests for new features');
    lines.push('- Keep functions small and focused');
    lines.push('');

    lines.push('## Commit Messages');
    lines.push('');
    lines.push('Use conventional commits:');
    lines.push('');
    lines.push('- `feat:` New feature');
    lines.push('- `fix:` Bug fix');
    lines.push('- `docs:` Documentation');
    lines.push('- `style:` Formatting');
    lines.push('- `refactor:` Code refactoring');
    lines.push('- `test:` Adding tests');
    lines.push('- `chore:` Maintenance');
    lines.push('');

    lines.push('## Pull Request Process');
    lines.push('');
    lines.push('1. Ensure all tests pass');
    lines.push('2. Update documentation if needed');
    lines.push('3. Request review from maintainers');
    lines.push('4. Address review feedback');
    lines.push('');

    return {
      type: 'contributing',
      filePath: path.join(projectRoot, 'CONTRIBUTING.md'),
      content: lines.join('\n'),
      sourceFiles: [],
      generatedAt: new Date(),
    };
  }

  /**
   * Generate architecture diagram in Mermaid format
   */
  async generateArchitectureDiagram(
    projectRoot: string,
  ): Promise<GeneratedDoc | null> {
    const components = await this.detectComponents(projectRoot);

    if (components.length === 0) return null;

    const lines: string[] = [];

    lines.push('# Architecture');
    lines.push('');
    lines.push('```mermaid');
    lines.push('graph TD');
    lines.push('');

    // Group components by type
    const byType = new Map<string, ArchitectureComponent[]>();
    for (const comp of components) {
      const list = byType.get(comp.type) || [];
      list.push(comp);
      byType.set(comp.type, list);
    }

    // Add subgraphs for each type
    for (const [type, comps] of byType) {
      lines.push(`    subgraph ${type.toUpperCase()}`);
      for (const comp of comps) {
        const id = comp.name.replace(/[^a-zA-Z0-9]/g, '_');
        lines.push(`        ${id}["${comp.name}"]`);
      }
      lines.push('    end');
      lines.push('');
    }

    // Add dependencies
    for (const comp of components) {
      const fromId = comp.name.replace(/[^a-zA-Z0-9]/g, '_');
      for (const dep of comp.dependencies) {
        const toId = dep.replace(/[^a-zA-Z0-9]/g, '_');
        lines.push(`    ${fromId} --> ${toId}`);
      }
    }

    lines.push('```');
    lines.push('');

    // Component descriptions
    lines.push('## Components');
    lines.push('');

    for (const comp of components) {
      lines.push(`### ${comp.name}`);
      lines.push('');
      lines.push(`- **Type**: ${comp.type}`);
      lines.push(`- **File**: \`${comp.filePath}\``);
      if (comp.dependencies.length > 0) {
        lines.push(`- **Dependencies**: ${comp.dependencies.join(', ')}`);
      }
      lines.push('');
    }

    return {
      type: 'architecture',
      filePath: path.join(projectRoot, 'docs', 'ARCHITECTURE.md'),
      content: lines.join('\n'),
      sourceFiles: components.map((c) => c.filePath),
      generatedAt: new Date(),
    };
  }

  /**
   * Generate JSDoc for a function
   */
  generateJSDoc(funcDoc: FunctionDoc): string {
    const lines: string[] = [];

    lines.push('/**');
    lines.push(` * ${funcDoc.description}`);

    if (funcDoc.since) {
      lines.push(` * @since ${funcDoc.since}`);
    }

    if (funcDoc.deprecated) {
      lines.push(` * @deprecated ${funcDoc.deprecated}`);
    }

    lines.push(' *');

    // Parameters
    for (const param of funcDoc.params) {
      const optional = param.optional ? '[' : '';
      const optionalEnd = param.optional ? ']' : '';
      const defaultVal = param.defaultValue ? `=${param.defaultValue}` : '';
      lines.push(
        ` * @param {${param.type}} ${optional}${param.name}${defaultVal}${optionalEnd} - ${param.description}`,
      );
    }

    // Returns
    if (funcDoc.returns) {
      lines.push(
        ` * @returns {${funcDoc.returns.type}} ${funcDoc.returns.description}`,
      );
    }

    // Throws
    if (funcDoc.throws) {
      for (const t of funcDoc.throws) {
        lines.push(` * @throws {${t.type}} ${t.description}`);
      }
    }

    // Examples
    if (this.config.includeExamples && funcDoc.examples.length > 0) {
      lines.push(' *');
      lines.push(' * @example');
      for (const example of funcDoc.examples) {
        for (const line of example.split('\n')) {
          lines.push(` * ${line}`);
        }
      }
    }

    lines.push(' */');

    return lines.join('\n');
  }

  /**
   * Generate API documentation
   */
  generateAPIDoc(endpoints: APIEndpointDoc[]): GeneratedDoc {
    const lines: string[] = [];

    lines.push('# API Documentation');
    lines.push('');

    // Table of contents
    lines.push('## Endpoints');
    lines.push('');
    lines.push('| Method | Path | Description |');
    lines.push('|--------|------|-------------|');
    for (const ep of endpoints) {
      lines.push(`| ${ep.method} | ${ep.path} | ${ep.description} |`);
    }
    lines.push('');

    // Detailed documentation
    for (const ep of endpoints) {
      lines.push(`## ${ep.method} ${ep.path}`);
      lines.push('');
      lines.push(ep.description);
      lines.push('');

      // Path parameters
      if (ep.pathParams && ep.pathParams.length > 0) {
        lines.push('### Path Parameters');
        lines.push('');
        lines.push('| Name | Type | Description |');
        lines.push('|------|------|-------------|');
        for (const param of ep.pathParams) {
          lines.push(
            `| ${param.name} | ${param.type} | ${param.description} |`,
          );
        }
        lines.push('');
      }

      // Query parameters
      if (ep.queryParams && ep.queryParams.length > 0) {
        lines.push('### Query Parameters');
        lines.push('');
        lines.push('| Name | Type | Required | Description |');
        lines.push('|------|------|----------|-------------|');
        for (const param of ep.queryParams) {
          lines.push(
            `| ${param.name} | ${param.type} | ${param.optional ? 'No' : 'Yes'} | ${param.description} |`,
          );
        }
        lines.push('');
      }

      // Request body
      if (ep.requestBody) {
        lines.push('### Request Body');
        lines.push('');
        lines.push(`Type: \`${ep.requestBody.type}\``);
        lines.push('');
        if (ep.requestBody.properties) {
          lines.push('| Property | Type | Required | Description |');
          lines.push('|----------|------|----------|-------------|');
          for (const [name, prop] of Object.entries(
            ep.requestBody.properties,
          )) {
            lines.push(
              `| ${name} | ${prop.type} | ${prop.required ? 'Yes' : 'No'} | ${prop.description} |`,
            );
          }
          lines.push('');
        }
      }

      // Example request
      if (ep.exampleRequest) {
        lines.push('### Example Request');
        lines.push('');
        lines.push('```json');
        lines.push(ep.exampleRequest);
        lines.push('```');
        lines.push('');
      }

      // Example response
      if (ep.exampleResponse) {
        lines.push('### Example Response');
        lines.push('');
        lines.push('```json');
        lines.push(ep.exampleResponse);
        lines.push('```');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return {
      type: 'api',
      content: lines.join('\n'),
      sourceFiles: [],
      generatedAt: new Date(),
    };
  }

  /**
   * Generate changelog from entries
   */
  generateChangelog(entries: ChangelogEntry[]): GeneratedDoc {
    const lines: string[] = [];

    lines.push('# Changelog');
    lines.push('');
    lines.push(
      'All notable changes to this project will be documented in this file.',
    );
    lines.push('');
    lines.push(
      'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),',
    );
    lines.push(
      'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).',
    );
    lines.push('');

    for (const entry of entries) {
      lines.push(
        `## [${entry.version}] - ${entry.date.toISOString().split('T')[0]}`,
      );
      lines.push('');

      const categories: Array<[keyof typeof entry.changes, string]> = [
        ['added', 'Added'],
        ['changed', 'Changed'],
        ['deprecated', 'Deprecated'],
        ['removed', 'Removed'],
        ['fixed', 'Fixed'],
        ['security', 'Security'],
      ];

      for (const [key, label] of categories) {
        const items = entry.changes[key];
        if (items.length > 0) {
          lines.push(`### ${label}`);
          lines.push('');
          for (const item of items) {
            lines.push(`- ${item}`);
          }
          lines.push('');
        }
      }
    }

    return {
      type: 'changelog',
      content: lines.join('\n'),
      sourceFiles: [],
      generatedAt: new Date(),
    };
  }

  /**
   * Detect architectural components from source files
   */
  private async detectComponents(
    projectRoot: string,
  ): Promise<ArchitectureComponent[]> {
    const components: ArchitectureComponent[] = [];
    const srcDir = path.join(projectRoot, 'src');

    if (!fs.existsSync(srcDir)) return components;

    const files = await this.collectFiles(srcDir);

    for (const file of files) {
      const component = await this.analyzeComponent(file);
      if (component) {
        components.push(component);
      }
    }

    return components;
  }

  /**
   * Analyze a file to detect component type
   */
  private async analyzeComponent(
    filePath: string,
  ): Promise<ArchitectureComponent | null> {
    const fileName = path.basename(filePath, path.extname(filePath));
    let content: string;

    try {
      content = await fs.promises.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }

    // Detect component type from naming and content
    let type: ArchitectureComponent['type'] = 'other';

    if (
      fileName.includes('service') ||
      fileName.includes('Service') ||
      (content.includes('class') && content.includes('Service'))
    ) {
      type = 'service';
    } else if (
      fileName.includes('controller') ||
      fileName.includes('Controller') ||
      content.includes('Controller')
    ) {
      type = 'controller';
    } else if (
      fileName.includes('repository') ||
      fileName.includes('Repository') ||
      content.includes('Repository')
    ) {
      type = 'repository';
    } else if (
      fileName.includes('util') ||
      fileName.includes('helper') ||
      fileName.includes('utils')
    ) {
      type = 'util';
    } else if (
      fileName.includes('model') ||
      fileName.includes('entity') ||
      (content.includes('interface') && !content.includes('class'))
    ) {
      type = 'model';
    }

    // Extract dependencies from imports
    const dependencies: string[] = [];
    const importMatches = content.matchAll(
      /import\s+.*?from\s+['"]([^'"]+)['"]/g,
    );
    for (const match of importMatches) {
      const importPath = match[1];
      if (importPath.startsWith('.')) {
        const depName = path.basename(importPath).replace(/\.[^.]+$/, '');
        if (depName !== fileName) {
          dependencies.push(depName);
        }
      }
    }

    return {
      name: fileName,
      type,
      description: '', // Would need content analysis
      dependencies: [...new Set(dependencies)],
      filePath,
    };
  }

  /**
   * Collect TypeScript/JavaScript files
   */
  private async collectFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    const excludeDirs = ['node_modules', 'dist', 'build', '__tests__'];

    const walk = async (currentDir: string): Promise<void> => {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(currentDir, {
          withFileTypes: true,
        });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);

        if (entry.isDirectory()) {
          if (!excludeDirs.includes(entry.name)) {
            await walk(fullPath);
          }
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name);
          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            if (
              !entry.name.includes('.test.') &&
              !entry.name.includes('.spec.')
            ) {
              files.push(fullPath);
            }
          }
        }
      }
    };

    await walk(dir);
    return files;
  }

  /**
   * Write generated documentation to disk
   */
  async writeDocs(docs: GeneratedDoc[]): Promise<void> {
    for (const doc of docs) {
      if (doc.filePath) {
        const dir = path.dirname(doc.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        await fs.promises.writeFile(doc.filePath, doc.content);
      }
    }
  }
}

/**
 * Create a DocAgent with custom configuration
 */
export function createDocAgent(config?: Partial<DocAgentConfig>): DocAgent {
  return new DocAgent(config);
}
