# Security Policy

## Reporting Security Issues

To report a security issue, please use [https://g.co/vulnz](https://g.co/vulnz).
We use g.co/vulnz for our intake, and do coordination and disclosure here on
GitHub (including using GitHub Security Advisory). The Google Security Team will
respond within 5 working days of your report on g.co/vulnz.

[GitHub Security Advisory]:
  https://github.com/google-gemini/gemini-cli/security/advisories

## Security Model

### Overview

Gemini CLI is a command-line interface that executes shell commands and manipulates files on behalf of users. This document outlines the security considerations, risks, and best practices for using and developing Gemini CLI.

### Trust Boundaries

1. **User Input**: All user input is treated as potentially untrusted. Commands and file paths provided by users are validated before execution.

2. **External APIs**: Communication with external APIs (Gemini API, MCP servers) uses TLS encryption. API keys and tokens are stored securely and never logged.

3. **File System**: File operations are restricted to the workspace directory by default. Operations outside the workspace require explicit user approval.

4. **Shell Execution**: Shell commands are executed in a sandboxed environment when available. Command injection is mitigated through proper escaping and validation.

### Sandboxing

Gemini CLI supports multiple sandboxing mechanisms to isolate command execution:

1. **macOS Seatbelt**: Uses `sandbox-exec` with restrictive profiles to limit file system and network access.

2. **Container Sandboxing**: Docker/Podman containers provide process isolation with:
   - Read-write access limited to project directory
   - Network restrictions configurable via proxy
   - Non-root user execution

3. **Sandbox Profiles**:
   - `permissive-open`: Allows most operations, restricts writes to project folder
   - `restrictive-closed`: Denies all operations by default
   - Custom profiles can be defined in `.gemini/sandbox-macos-<profile>.sb`

### Authentication

Gemini CLI supports multiple authentication methods:

1. **OAuth 2.0 (Login with Google)**: Recommended for interactive use. Tokens are stored securely in the system keychain when available.

2. **API Keys**: For non-interactive use. Store API keys in environment variables, never in code or configuration files.

3. **Application Default Credentials (ADC)**: For Google Cloud environments.

**Best Practices**:
- Never commit API keys or tokens to version control
- Use environment variables or secure secret management
- Rotate credentials regularly
- Use the minimum required scopes/permissions

### Data Protection

1. **Sensitive Data Handling**:
   - Passwords, API keys, and tokens are never logged
   - Environment variables are sanitized before logging
   - File contents are not sent to external services without user consent

2. **Session Data**:
   - Session files are stored locally with appropriate permissions
   - Expired sessions are automatically cleaned up
   - Session data can be encrypted at rest (configurable)

3. **Telemetry**:
   - Telemetry is opt-in and can be disabled
   - No personally identifiable information is collected
   - Command content is not included in telemetry

### Network Security

1. **TLS Requirements**:
   - All external API communication uses TLS 1.2 or higher
   - Certificate validation is enforced

2. **Proxy Support**:
   - HTTP/HTTPS proxy configuration is supported
   - Proxy can be configured for sandbox network isolation

3. **DNS Resolution**:
   - DNS resolution order is configurable (IPv4 preferred by default)

### Command Execution Security

1. **Command Validation**:
   - Commands are parsed and validated before execution
   - Dangerous commands require explicit user approval
   - Command allowlists can be configured

2. **Injection Prevention**:
   - Shell arguments are escaped using platform-specific methods
   - User input is never directly interpolated into commands
   - Temporary files use secure random names

3. **Resource Limits**:
   - Command execution has configurable timeouts
   - Memory usage is monitored and limited
   - Background process tracking prevents orphaned processes

### File System Security

1. **Path Validation**:
   - All file paths are resolved and validated
   - Symlink attacks are mitigated through canonical path resolution
   - Path traversal attempts are blocked

2. **Permission Model**:
   - File operations require explicit tool invocation approval
   - Workspace boundaries are enforced
   - Sensitive directories (e.g., `.git`, `.ssh`) have additional protections

3. **Temporary Files**:
   - Created with secure permissions (0600)
   - Cleaned up automatically after use
   - Located in system temp directory with random names

### Secure Development Guidelines

For contributors to Gemini CLI:

1. **Input Validation**:
   - Always validate and sanitize user input
   - Use Zod schemas for structured data validation
   - Never trust data from external sources

2. **Error Handling**:
   - Never expose sensitive information in error messages
   - Log errors securely without sensitive data
   - Handle all error cases explicitly

3. **Dependencies**:
   - Keep dependencies updated
   - Review security advisories regularly
   - Use lockfiles to ensure reproducible builds
   - Audit dependencies for known vulnerabilities

4. **Code Review**:
   - All changes require security-conscious code review
   - Security-sensitive changes require additional review
   - Use automated security scanning in CI/CD

5. **Testing**:
   - Include security test cases
   - Test with malicious inputs
   - Verify sandbox boundaries

### Known Limitations

1. **Sandbox Escape**: While sandboxing provides defense-in-depth, it should not be relied upon as the sole security mechanism. Sandbox escapes are possible.

2. **Social Engineering**: The CLI cannot prevent social engineering attacks where users are tricked into approving malicious commands.

3. **Local Attacks**: Security controls assume a trusted local environment. Users on shared systems should take additional precautions.

### Incident Response

If you discover a security vulnerability:

1. **Do NOT** disclose it publicly
2. Report it via [https://g.co/vulnz](https://g.co/vulnz)
3. Include:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

We will:
1. Acknowledge receipt within 5 business days
2. Investigate and validate the report
3. Develop and test a fix
4. Release the fix with appropriate disclosure
5. Credit the reporter (unless anonymity is requested)

## Version Support

| Version | Supported          |
| ------- | ------------------ |
| Latest  | :white_check_mark: |
| < Latest| :x:                |

We recommend always using the latest version of Gemini CLI to ensure you have the latest security fixes.

## Security Updates

Security updates are released as soon as possible after a vulnerability is confirmed. Subscribe to GitHub releases to be notified of security updates.
