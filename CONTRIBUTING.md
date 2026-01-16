# Contributing to Clyp

Thank you for your interest in contributing to Clyp! We welcome contributions from the community.

## How to Contribute

### Reporting Bugs

1. Check if the bug has already been reported in [Issues](https://github.com/yourusername/clyp/issues)
2. If not, create a new issue with:
   - Clear title and description
   - Steps to reproduce
   - Expected vs actual behavior
   - System information (OS, version)
   - Screenshots if applicable

### Suggesting Features

1. Check [Discussions](https://github.com/yourusername/clyp/discussions) for similar ideas
2. Create a new discussion in the "Ideas" category
3. Describe the feature and its benefits
4. Provide examples or mockups if possible

### Pull Requests

1. Fork the repository
2. Create a new branch: `git checkout -b feature/your-feature-name`
3. Make your changes following our coding standards
4. Test thoroughly on your platform
5. Commit with clear messages: `git commit -m "Add: feature description"`
6. Push to your fork: `git push origin feature/your-feature-name`
7. Open a Pull Request with:
   - Description of changes
   - Related issue numbers
   - Testing performed
   - Screenshots/videos if UI changes

## Development Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/clyp.git
cd clyp

# Install dependencies
npm install

# Run in development
npm run dev
```

## Coding Standards

### JavaScript
- Use ES6+ features
- Follow existing code style
- Add comments for complex logic
- Use meaningful variable names

### File Organization
- Main process code in `app/main/`
- Renderer process code in `app/renderer/`
- Shared utilities in `app/shared/`

### Commit Messages
- Use present tense: "Add feature" not "Added feature"
- Use imperative mood: "Move cursor to..." not "Moves cursor to..."
- Prefix with type: `Add:`, `Fix:`, `Update:`, `Refactor:`, `Docs:`

## Testing

Before submitting:
1. Test on your platform (macOS/Windows/Linux)
2. Check for memory leaks
3. Test keyboard shortcuts
4. Verify clipboard capture works
5. Test settings persistence

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Focus on what is best for the project

## Questions?

Feel free to ask in [Discussions](https://github.com/yourusername/clyp/discussions) or reach out to the maintainers.

Thank you for contributing! 🎉
